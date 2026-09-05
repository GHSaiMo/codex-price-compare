import { copyFile, mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { writeJsonAtomic } from "./fs-atomic.mjs";

import {
  classifyProduct,
  normalizeAcgProduct,
  normalizeDujiaoProduct,
  normalizeLdxpProduct,
  sortProductsForDisplay,
} from "./cleaning.mjs";
import {
  FallbackProxyContext,
  createHttpError,
  shouldProtectRefreshResult,
  shouldUseFallbackForError,
  systemLookupLooksPoisoned,
} from "./fallback-proxy.mjs";
import { fetchLdxpViaPlaywright } from "./ldxp-playwright.mjs";
import { updateWatchPriceHistory } from "./price-history.mjs";
import { processStockWatchNotifications, readStockWatch } from "./stock-watch.mjs";
import { queryLocalClassifier } from "./ai-classifier.mjs";

const root = new URL("../", import.meta.url);
const dataDir = new URL("data/", root);
const backupDir = new URL("backups/", dataDir);
const cooldownPath = new URL("refresh-cooldown.json", dataDir);
const ldxpSchedulerPath = new URL("ldxp-scheduler.json", dataDir);
const PRODUCTS_PATH = "data/products.json";
const META_PATH = "data/meta.json";
const STOCK_WATCH_PATH = "data/stock-watch.json";
const PRICE_HISTORY_PATH = "data/price-history.json";
const COOLDOWN_MS = 2 * 60 * 60 * 1000;
const BACKUP_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const LDXP_MAX_SOURCES_PER_RUN = 10;
const LDXP_DELAY_MIN_MS = 12 * 1000;
const LDXP_DELAY_MAX_MS = 25 * 1000;
const DEAD_SOURCE_STALE_MS = 14 * 24 * 60 * 60 * 1000;

export const DEFAULT_BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

export function isDomesticWafHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "wzyp.cn" || host.endsWith(".wzyp.cn") || host === "pay.ldxp.cn";
}

export async function prewarmLdxpSession(source, options = {}) {
  try {
    const response = await fetch(source.url, {
      method: "GET",
      headers: {
        "user-agent": DEFAULT_BROWSER_UA,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(options.timeoutMs || 10000),
    });
    const rawCookies = typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie")].filter(Boolean);
    const cookieHeader = rawCookies
      .map((c) => String(c).split(";")[0].trim())
      .filter(Boolean)
      .join("; ");
    return { cookie: cookieHeader };
  } catch {
    return { cookie: "" };
  }
}

const PERMANENT_SOURCE_FAILURE_PATTERNS = [
  /商家已被关闭/,
  /关闭交易/,
  /店铺不存在/,
  /商家不存在/,
  /店铺已关闭/,
];
const TRANSIENT_SOURCE_FAILURE_PATTERNS = [
  /同域名/,
  /冷却/,
  /WAF/i,
  /本轮跳过/,
  /HTTP 403\b/,
];
const DOMAIN_SKIP_ERROR_PATTERNS = [
  /HTTP 403\b/,
  /WAF/i,
  /blocked/i,
  /http_bot/i,
  /http_custom/i,
  /非 JSON/,
  /Playwright ldxp 采集失败/,
];

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, root), "utf8"));
}

async function readJsonOrNull(path) {
  try {
    return await readJson(path);
  } catch {
    return null;
  }
}

function compactTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

async function backupCurrentData(date = new Date()) {
  await mkdir(backupDir, { recursive: true });
  const stamp = compactTimestamp(date);
  const backups = {};
  for (const name of ["products", "meta"]) {
    try {
      const source = new URL(`data/${name}.json`, root);
      const filename = `${stamp}-${name}.json`;
      const target = new URL(filename, backupDir);
      await copyFile(source, target);
      backups[name] = `data/backups/${filename}`;
    } catch {
      // 首次刷新时可能还没有历史文件。
    }
  }
  await pruneExpiredBackups({ now: date });
  return backups;
}

export function parseBackupFilenameDate(filename) {
  const match = String(filename || "").match(/^(\d{4}-\d{2}-\d{2}T)(\d{2})-(\d{2})-(\d{2})-(\d{3}Z)-/);
  if (!match) return null;
  const date = new Date(`${match[1]}${match[2]}:${match[3]}:${match[4]}.${match[5]}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function pruneExpiredBackups({
  dir = backupDir,
  now = new Date(),
  retentionMs = BACKUP_RETENTION_MS,
} = {}) {
  const cutoff = now.getTime() - retentionMs;
  let names = [];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }

  const removed = [];
  for (const name of names) {
    const createdAt = parseBackupFilenameDate(name);
    if (!createdAt || createdAt.getTime() >= cutoff) continue;
    try {
      await unlink(new URL(name, dir));
      removed.push(name);
    } catch {
      // 单个过期备份删除失败时继续清理其余文件。
    }
  }
  return removed;
}

async function readCooldown() {
  try {
    const cooldown = JSON.parse(await readFile(cooldownPath, "utf8"));
    if (cooldown?.until && new Date(cooldown.until).getTime() > Date.now()) return cooldown;
  } catch {
    return null;
  }
  return null;
}

async function readLdxpSchedulerState() {
  try {
    const state = JSON.parse(await readFile(ldxpSchedulerPath, "utf8"));
    return {
      version: 1,
      coreRound: Number.isInteger(state?.coreRound) ? state.coreRound : 0,
      hostCursor: Number.isInteger(state?.hostCursor) ? state.hostCursor : 0,
      cursorByHost: state?.cursorByHost && typeof state.cursorByHost === "object" ? state.cursorByHost : {},
      cooldowns: state?.cooldowns && typeof state.cooldowns === "object" ? state.cooldowns : {},
      lastFailures: state?.lastFailures && typeof state.lastFailures === "object" ? state.lastFailures : {},
      lastSuccess: state?.lastSuccess && typeof state.lastSuccess === "object" ? state.lastSuccess : {},
      lastDisabledProbes: state?.lastDisabledProbes && typeof state.lastDisabledProbes === "object" ? state.lastDisabledProbes : {},
    };
  } catch {
    return { version: 1, coreRound: 0, hostCursor: 0, cursorByHost: {}, cooldowns: {}, lastFailures: {}, lastSuccess: {}, lastDisabledProbes: {} };
  }
}

async function writeLdxpSchedulerState(state) {
  await mkdir(dataDir, { recursive: true });
  await writeJsonAtomic(ldxpSchedulerPath, {
    version: 1,
    coreRound: state.coreRound ?? 0,
    hostCursor: state.hostCursor ?? 0,
    cursorByHost: state.cursorByHost || {},
    cooldowns: state.cooldowns || {},
    lastFailures: state.lastFailures || {},
    lastSuccess: state.lastSuccess || {},
    lastDisabledProbes: state.lastDisabledProbes || {},
  });
}

async function writeCooldown(reason, date = new Date()) {
  const cooldown = {
    reason,
    startedAt: date.toISOString(),
    until: new Date(date.getTime() + COOLDOWN_MS).toISOString(),
  };
  await writeJsonAtomic(cooldownPath, cooldown);
  return cooldown;
}

export function resolveLdxpFetchMode(env = process.env) {
  const mode = String(env.LDXP_FETCH_MODE || "").trim().toLowerCase();
  if (!mode && env.LDXP_PLAYWRIGHT_DISABLED === "1") return "fetch";
  if (!mode) return "playwright";
  if (mode === "playwright" || mode === "fetch") return mode;
  throw new Error("LDXP_FETCH_MODE 仅支持 playwright 或 fetch");
}

function numberFromEnv(value, fallback, { min = 0, integer = false } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return integer ? Math.round(parsed) : parsed;
}

export function resolveLdxpSchedulerConfig(env = process.env) {
  const maxSourcesPerRun = numberFromEnv(env.LDXP_MAX_SOURCES_PER_RUN, LDXP_MAX_SOURCES_PER_RUN, {
    min: 1,
    integer: true,
  });
  const domainCooldownHours = numberFromEnv(env.LDXP_DOMAIN_COOLDOWN_HOURS, 6, { min: 0 });
  const delayMinMs = numberFromEnv(env.LDXP_DELAY_MIN_MS, LDXP_DELAY_MIN_MS, { min: 0, integer: true });
  const delayMaxMs = numberFromEnv(env.LDXP_DELAY_MAX_MS, LDXP_DELAY_MAX_MS, { min: delayMinMs, integer: true });
  return {
    domainCooldownMs: domainCooldownHours * 60 * 60 * 1000,
    maxSourcesPerRun,
    delayMinMs,
    delayMaxMs,
  };
}

export function resolveDisabledSourceProbeIntervalMs(env = process.env) {
  const hours = numberFromEnv(env.DISABLED_SOURCE_PROBE_HOURS, 24, { min: 0 });
  return hours * 60 * 60 * 1000;
}

function sourceHost(source) {
  return new URL(source.url).host;
}

function activeCooldownForHost(state, host, now) {
  const cooldown = state.cooldowns?.[host];
  if (!cooldown?.until) return null;
  return new Date(cooldown.until).getTime() > now.getTime() ? cooldown : null;
}

function rotateSources(sources, cursor) {
  if (sources.length === 0) return [];
  const start = ((Number(cursor) || 0) % sources.length + sources.length) % sources.length;
  return [...sources.slice(start), ...sources.slice(0, start)];
}

export function buildLdxpRefreshPlan({
  sources,
  state = {},
  now = new Date(),
  maxSourcesPerRun = LDXP_MAX_SOURCES_PER_RUN,
} = {}) {
  const ldxpSources = sources.filter((source) => source.adapter === "ldxp");
  const coreSources = ldxpSources.filter((source) => source.core === true);
  const nonCoreSources = ldxpSources.filter((source) => source.core !== true);

  const skipped = [];
  const selected = [];
  const selectedIds = new Set();

  let nextCoreRound = 0;
  if (coreSources.length > 1) {
    const coreRound = Number(state.coreRound) || 0;
    const firstBatchSize = Math.ceil(coreSources.length / 2);
    const targetCoreSources = coreRound % 2 === 0
      ? coreSources.slice(0, firstBatchSize)
      : coreSources.slice(firstBatchSize);
    const restingCoreSources = coreRound % 2 === 0
      ? coreSources.slice(firstBatchSize)
      : coreSources.slice(0, firstBatchSize);

    for (const source of restingCoreSources) {
      skipped.push({ source, reason: "核心店铺隔轮轮休，保留旧数据" });
    }

    for (const source of targetCoreSources) {
      const host = sourceHost(source);
      const cooldown = activeCooldownForHost(state, host, now);
      if (cooldown) {
        skipped.push({ source, reason: `ldxp 域名 ${host} 冷却中，保留旧数据`, cooldown });
      } else if (selected.length < maxSourcesPerRun) {
        selected.push(source);
        selectedIds.add(source.id);
      } else {
        skipped.push({ source, reason: "ldxp 本轮未排到，保留旧数据" });
      }
    }
    nextCoreRound = (coreRound + 1) % 2;
  } else if (coreSources.length === 1) {
    const source = coreSources[0];
    const host = sourceHost(source);
    const cooldown = activeCooldownForHost(state, host, now);
    if (cooldown) {
      skipped.push({ source, reason: `ldxp 域名 ${host} 冷却中，保留旧数据`, cooldown });
    } else if (selected.length < maxSourcesPerRun) {
      selected.push(source);
      selectedIds.add(source.id);
    } else {
      skipped.push({ source, reason: "ldxp 本轮未排到，保留旧数据" });
    }
    nextCoreRound = 0;
  }

  const eligibleNonCore = [];
  for (const source of nonCoreSources) {
    const host = sourceHost(source);
    const cooldown = activeCooldownForHost(state, host, now);
    if (cooldown) {
      skipped.push({ source, reason: `ldxp 域名 ${host} 冷却中，保留旧数据`, cooldown });
    } else {
      eligibleNonCore.push(source);
    }
  }

  const nonCoreByHost = new Map();
  for (const source of eligibleNonCore) {
    const host = sourceHost(source);
    const entries = nonCoreByHost.get(host) || [];
    entries.push(source);
    nonCoreByHost.set(host, entries);
  }

  const knownHosts = new Set(ldxpSources.map((source) => sourceHost(source)));
  const cursorByHost = {};
  for (const [host, cursor] of Object.entries(state.cursorByHost || {})) {
    if (knownHosts.has(host)) {
      cursorByHost[host] = cursor;
    }
  }

  const hostKeys = Array.from(nonCoreByHost.keys());
  const hostCursor = Number.isInteger(state.hostCursor) ? state.hostCursor : 0;
  const orderedHosts = rotateSources(hostKeys, hostCursor);

  const hostQueues = [];
  for (const host of orderedHosts) {
    const entries = nonCoreByHost.get(host) || [];
    hostQueues.push({
      host,
      entries,
      rotated: rotateSources(entries, cursorByHost[host]),
      index: 0,
      used: 0,
    });
  }

  let nonCorePicked = 0;
  while (selected.length < maxSourcesPerRun) {
    let pickedAny = false;
    for (const queue of hostQueues) {
      if (selected.length >= maxSourcesPerRun) break;
      if (queue.index < queue.rotated.length) {
        const source = queue.rotated[queue.index++];
        selected.push(source);
        selectedIds.add(source.id);
        queue.used += 1;
        nonCorePicked += 1;
        pickedAny = true;
      }
    }
    if (!pickedAny) break;
  }

  for (const queue of hostQueues) {
    if (queue.used > 0) {
      cursorByHost[queue.host] = ((Number(cursorByHost[queue.host]) || 0) + queue.used) % queue.entries.length;
    }
  }

  for (const source of eligibleNonCore) {
    if (!selectedIds.has(source.id)) {
      skipped.push({ source, reason: "ldxp 本轮未排到，保留旧数据" });
    }
  }

  const nextHostCursor = (nonCorePicked > 0 && hostKeys.length > 0)
    ? (hostCursor + 1) % hostKeys.length
    : hostCursor;

  return {
    sources: selected,
    skipped,
    nextState: {
      ...state,
      version: 1,
      coreRound: nextCoreRound,
      hostCursor: nextHostCursor,
      cursorByHost,
      cooldowns: state.cooldowns || {},
      lastFailures: state.lastFailures || {},
      lastSuccess: state.lastSuccess || {},
      lastDisabledProbes: state.lastDisabledProbes || {},
    },
  };
}

export function isPermanentSourceFailure(message) {
  return PERMANENT_SOURCE_FAILURE_PATTERNS.some((pattern) => pattern.test(String(message || "")));
}

export function isTransientSourceFailure(message) {
  return TRANSIENT_SOURCE_FAILURE_PATTERNS.some((pattern) => pattern.test(String(message || "")));
}

export function shouldDisableFailedSource({
  message,
  failedAt,
  lastSuccessAt = null,
  now = new Date(),
  staleMs = DEAD_SOURCE_STALE_MS,
} = {}) {
  if (isPermanentSourceFailure(message)) return true;
  if (isTransientSourceFailure(message)) return false;
  const failedTime = new Date(failedAt || 0).getTime();
  if (!Number.isFinite(failedTime) || now.getTime() - failedTime < staleMs) return false;
  if (lastSuccessAt && new Date(lastSuccessAt).getTime() >= failedTime) return false;
  return /HTTP 5\d\d/.test(String(message || ""));
}

export function disableDeadSources(sources = [], {
  lastFailures = {},
  lastSuccess = {},
  now = new Date(),
} = {}) {
  let changed = false;
  const next = sources.map((source) => {
    if (source.enabled === false) return source;
    const failure = lastFailures[source.id];
    if (!failure) return source;
    if (!shouldDisableFailedSource({
      message: failure.message,
      failedAt: failure.at,
      lastSuccessAt: lastSuccess[source.id],
      now,
    })) return source;
    changed = true;
    return {
      ...source,
      enabled: false,
      disabledAt: now.toISOString(),
      disabledReason: failure.message,
    };
  });
  return { sources: next, changed };
}

export async function probeSource(source, { fallbackProxy = null } = {}) {
  if (source.adapter === "ldxp") {
    const session = await prewarmLdxpSession(source);
    const base = new URL(source.url);
    const info = await postJson(
      new URL("/shopApi/Shop/info", base),
      { token: source.token },
      {
        fallbackProxy,
        headers: {
          ...(session.cookie ? { cookie: session.cookie } : {}),
          referer: source.url,
          origin: base.origin,
        },
      },
    );
    if (info.code !== 1) {
      throw new Error(info.msg || "店铺信息异常");
    }
    return true;
  }
  if (source.adapter === "acg") {
    const res = await getJson(
      new URL("/user/api/index/commodity", source.url),
      { fallbackProxy },
    );
    if (res.code !== 200) {
      throw new Error(res.msg || "商品接口异常");
    }
    return true;
  }
  if (source.adapter === "dujiao") {
    const res = await getJson(
      new URL("/api/v1/public/products", source.apiBase || source.url),
      { fallbackProxy },
    );
    if (res.status_code !== 0) {
      throw new Error(res.msg || "商品接口异常");
    }
    return true;
  }
  throw new Error(`未知或不支持探测的适配器: ${source.adapter}`);
}

export async function probeAndRecoverDisabledSources(sources, {
  schedulerState = {},
  fallbackProxy = null,
  now = new Date(),
  probeIntervalMs = 24 * 60 * 60 * 1000,
  probeFn = probeSource,
} = {}) {
  const disabledSources = sources.filter((s) => s.enabled === false);
  if (disabledSources.length === 0) {
    return { sources, recovered: [], changed: false };
  }

  const lastDisabledProbes = { ...(schedulerState.lastDisabledProbes || {}) };
  const lastFailures = { ...(schedulerState.lastFailures || {}) };
  const lastSuccess = { ...(schedulerState.lastSuccess || {}) };
  const recoveredMap = new Map();
  let changed = false;

  for (const source of disabledSources) {
    const lastProbe = lastDisabledProbes[source.id];
    if (lastProbe?.at) {
      const elapsedMs = now.getTime() - new Date(lastProbe.at).getTime();
      if (elapsedMs < probeIntervalMs) {
        continue;
      }
    }

    try {
      await probeFn(source, { fallbackProxy });
      // Probe succeeded! Recover this source
      recoveredMap.set(source.id, {
        ...source,
        enabled: true,
      });
      delete recoveredMap.get(source.id).disabledAt;
      delete recoveredMap.get(source.id).disabledReason;

      delete lastFailures[source.id];
      lastSuccess[source.id] = now.toISOString();
      lastDisabledProbes[source.id] = {
        at: now.toISOString(),
        ok: true,
      };
      changed = true;
    } catch (error) {
      lastDisabledProbes[source.id] = {
        at: now.toISOString(),
        ok: false,
        error: error.message || String(error),
      };
    }
  }

  schedulerState.lastDisabledProbes = lastDisabledProbes;
  schedulerState.lastFailures = lastFailures;
  schedulerState.lastSuccess = lastSuccess;

  const nextSources = sources.map((source) => recoveredMap.get(source.id) || source);
  return {
    sources: nextSources,
    recovered: Array.from(recoveredMap.values()),
    changed,
  };
}

export function pruneUnknownSourceFailures(lastFailures = {}, sources = []) {
  const knownIds = new Set(sources.map((source) => source.id));
  const next = {};
  for (const [sourceId, failure] of Object.entries(lastFailures)) {
    if (knownIds.has(sourceId)) next[sourceId] = failure;
  }
  return next;
}

export function buildSourceHealth({
  sources = [],
  items = [],
  skipped = [],
  errors = [],
  lastSuccess = {},
  lastFailures = {},
  now = new Date(),
} = {}) {
  const skippedById = new Map(skipped.map((entry) => [entry.sourceId || entry.source?.id, entry]));
  const errorsById = new Map(errors.map((entry) => [entry.sourceId, entry]));
  const latestFetchedAt = new Map();
  const itemCountBySource = new Map();
  for (const item of items) {
    if (!item?.sourceId) continue;
    itemCountBySource.set(item.sourceId, (itemCountBySource.get(item.sourceId) || 0) + 1);
    if (item.fetchedAt && (!latestFetchedAt.has(item.sourceId) || item.fetchedAt > latestFetchedAt.get(item.sourceId))) {
      latestFetchedAt.set(item.sourceId, item.fetchedAt);
    }
  }

  return sources.map((source) => {
    const skip = skippedById.get(source.id);
    const error = errorsById.get(source.id);
    let status = "ok";
    let reason = null;
    if (error) {
      status = "failed";
      reason = error.message || null;
    } else if (skip) {
      status = String(skip.reason || "").includes("冷却") ? "cooldown" : "skipped";
      reason = skip.reason || null;
    }
    const lastSuccessAt = lastSuccess[source.id] || latestFetchedAt.get(source.id) || null;
    const ageMs = lastSuccessAt ? now.getTime() - new Date(lastSuccessAt).getTime() : null;
    const ageHours = Number.isFinite(ageMs) ? Math.round((ageMs / 36e5) * 10) / 10 : null;
    return {
      sourceId: source.id,
      sourceName: source.name,
      adapter: source.adapter,
      core: source.core === true,
      status,
      reason,
      lastSuccessAt,
      lastFailureAt: lastFailures[source.id]?.at || error?.at || null,
      lastError: lastFailures[source.id]?.message || error?.message || null,
      itemCount: itemCountBySource.get(source.id) || 0,
      ageHours,
    };
  });
}

export function reclassifyProductItem(item, rules, sources = null) {
  if (!item || !rules) return item;
  const classification = classifyProduct(item.title, item.descriptionText, rules);
  if (!classification || classification.category === "other") return null;

  let url = item.url;
  let sourceUrl = item.sourceUrl;

  if (sources && item.sourceId) {
    const source = Array.isArray(sources) ? sources.find((s) => s.id === item.sourceId) : null;
    if (source) {
      if (!sourceUrl || /^https?:\/\/[^\/]+\/?$/i.test(sourceUrl)) {
        sourceUrl = source.url;
      }
      if (!url || /^https?:\/\/[^\/]+\/?$/i.test(url)) {
        url = source.url;
      }
    }
  }

  return {
    ...item,
    brand: classification.brand || (classification.category === "grok" ? "grok" : (classification.category === "gemini" ? "gemini" : "codex")),
    category: classification.category,
    subtype: classification.subtype,
    confidence: classification.confidence,
    tags: classification.tags,
    matchReasons: classification.matchReasons,
    durationDays: classification.durationDays ?? null,
    durationLabel: classification.durationLabel || null,
    url: url || item.url,
    sourceUrl: sourceUrl ?? item.sourceUrl,
  };
}

export function reclassifyProductItems(items = [], rules = null, sources = null) {
  if (!rules) return items;
  return items
    .map((item) => reclassifyProductItem(item, rules, sources))
    .filter(Boolean);
}

export async function applyAiClassifierToUnknowns(items = []) {
  const result = [];
  for (const item of items) {
    if (item.subtype === "unknown" || item.category === "other") {
      const aiRes = await queryLocalClassifier(item.title, item.descriptionText);
      if (aiRes && aiRes.category && aiRes.subtype) {
        // 如果 AI 判定为 other 排除项，则直接丢弃不入库
        if (aiRes.category === "other" || aiRes.subtype === "other") {
          continue;
        }

        let targetSubtype = aiRes.subtype;
        if (aiRes.category === "grok" && targetSubtype === "m12") {
          targetSubtype = "m1";
        }

        result.push({
          ...item,
          brand: aiRes.category === "grok" ? "grok" : (aiRes.category === "gemini" ? "gemini" : "codex"),
          category: aiRes.category,
          subtype: targetSubtype,
          confidence: 0.95,
          tags: [...new Set([aiRes.category, targetSubtype, ...(item.tags || [])])],
          matchReasons: [...(item.matchReasons || []), `[AI端侧识别]: ${aiRes.category}/${targetSubtype}`],
        });
        continue;
      }
    }
    result.push(item);
  }
  return result;
}


export function mergeProductsWithStaleSourceItems({
  previousItems = [],
  currentItems = [],
  failedSourceIds = new Set(),
  rules = null,
} = {}) {
  const currentSourceIds = new Set(currentItems.map((item) => item.sourceId).filter(Boolean));
  const staleItems = previousItems
    .filter((item) => (
      item.sourceId
      && failedSourceIds.has(item.sourceId)
      && !currentSourceIds.has(item.sourceId)
    ))
    .map((item) => (rules ? reclassifyProductItem(item, rules) : item))
    .filter(Boolean);
  return [...currentItems, ...staleItems];
}

function randomLdxpDelayMs(env = process.env) {
  const config = resolveLdxpSchedulerConfig(env);
  return Math.round(config.delayMinMs + Math.random() * (config.delayMaxMs - config.delayMinMs));
}

export async function requestJson(url, {
  method = "GET",
  body = null,
  headers: extraHeaders = {},
  fallbackProxy = null,
  maxRedirects = 5,
} = {}) {
  const headers = {
    "user-agent": DEFAULT_BROWSER_UA,
    ...(body !== null ? { "content-type": "application/json" } : {}),
    ...extraHeaders,
  };

  let currentUrl = url;
  let redirectsRemaining = maxRedirects;

  try {
    while (true) {
      if (await systemLookupLooksPoisoned(new URL(currentUrl).hostname)) {
        throw new Error(`DNS 解析结果不可用: ${new URL(currentUrl).hostname}`);
      }
      const response = await fetch(currentUrl, {
        method,
        headers,
        ...(body !== null ? { body: JSON.stringify(body) } : {}),
        redirect: "manual",
      });

      if ([301, 302, 307, 308].includes(response.status) && response.headers.get("location")) {
        if (redirectsRemaining <= 0) {
          throw new Error(`重定向次数过多: ${currentUrl}`);
        }
        redirectsRemaining -= 1;
        currentUrl = new URL(response.headers.get("location"), currentUrl).href;
        continue;
      }

      if (!response.ok) throw createHttpError(response.status, currentUrl);
      const raw = await response.text();
      try {
        return JSON.parse(raw);
      } catch {
        throw new Error(`fetch 返回非 JSON: ${String(currentUrl)} ${raw.replace(/\s+/g, " ").slice(0, 120)}`);
      }
    }
  } catch (error) {
    if (fallbackProxy?.enabled && !isDomesticWafHost(new URL(currentUrl).hostname) && shouldUseFallbackForError(error)) {
      return fallbackProxy.fetchJson(currentUrl, {
        method,
        headers,
        body: body !== null ? JSON.stringify(body) : null,
      });
    }
    throw error;
  }
}

async function postJson(url, body, options = {}) {
  return requestJson(url, { method: "POST", body, ...options });
}

async function getJson(url, options = {}) {
  return requestJson(url, options);
}

async function fetchLdxp(source, rules, options = {}) {
  const blockedHosts = options.blockedHosts || new Set();
  const host = new URL(source.url).host;
  if (blockedHosts.has(host)) {
    throw new Error(`同域名 ${host} 已触发 WAF/采集失败，本轮跳过`);
  }

  if ((options.ldxpFetchMode || resolveLdxpFetchMode()) === "playwright") {
    try {
      const { shop, goods } = await fetchLdxpViaPlaywright(source);
      return goods
        .map((raw) => normalizeLdxpProduct(raw, { ...source, name: shop.nickname || source.name }, rules))
        .filter(Boolean);
    } catch (error) {
      if (DOMAIN_SKIP_ERROR_PATTERNS.some((pattern) => pattern.test(error.message))) {
        blockedHosts.add(host);
      }
      throw error;
    }
  }

  try {
    const base = new URL(source.url);
    const session = await prewarmLdxpSession(source, options);
    const ldxpRequestHeaders = {
      ...(session.cookie ? { cookie: session.cookie } : {}),
      referer: source.url,
      origin: base.origin,
    };
    const requestOptions = {
      ...options,
      headers: {
        ...(options.headers || {}),
        ...ldxpRequestHeaders,
      },
    };

    const info = await postJson(new URL("/shopApi/Shop/info", base), {
      token: source.token,
    }, requestOptions);
    if (info.code !== 1) throw new Error(info.msg || "店铺信息读取失败");

    const shop = info.data;
    const goodsTypes = Array.isArray(shop.goods_type_sort) ? shop.goods_type_sort : ["card"];
    const items = [];

    for (const goodsType of goodsTypes) {
      let current = 1;
      while (current <= 20) {
        if (current > 1) {
          await sleep(1500);
        }
        const data = await postJson(new URL("/shopApi/Shop/goodsList", base), {
          token: source.token,
          keywords: "",
          category_id: 0,
          goods_type: goodsType,
          current,
          pageSize: 50,
        }, requestOptions);
        if (data.code !== 1) throw new Error(data.msg || "商品列表读取失败");
        const list = data.data?.list || [];
        for (const raw of list) {
          const normalized = normalizeLdxpProduct(raw, { ...source, name: shop.nickname || source.name }, rules);
          if (normalized) items.push(normalized);
        }
        if (list.length < 50) break;
        current += 1;
      }
    }

    return items;
  } catch (error) {
    if (DOMAIN_SKIP_ERROR_PATTERNS.some((pattern) => pattern.test(error.message))) {
      blockedHosts.add(host);
    }
    throw error;
  }
}

async function fetchAcg(source, rules, options = {}) {
  const base = new URL(source.url);
  const data = await getJson(new URL("/user/api/index/commodity", base), options);
  if (data.code !== 200) throw new Error(data.msg || "商品列表读取失败");
  return (data.data || [])
    .map((raw) => normalizeAcgProduct(raw, source, rules))
    .filter(Boolean);
}

async function fetchDujiao(source, rules, options = {}) {
  const apiBase = new URL(source.apiBase || source.url);
  const data = await getJson(new URL("/api/v1/public/products", apiBase), options);
  if (data.status_code !== 0) throw new Error(data.msg || "商品列表读取失败");
  return (data.data || [])
    .map((raw) => normalizeDujiaoProduct(raw, source, rules))
    .filter(Boolean);
}

const adapters = {
  ldxp: fetchLdxp,
  acg: fetchAcg,
  dujiao: fetchDujiao,
};

export async function refreshProducts({ nextRefreshAt = null } = {}) {
  const cooldown = await readCooldown();
  if (cooldown) {
    const previousMeta = await readJsonOrNull(META_PATH);
    const previousProducts = await readJsonOrNull(PRODUCTS_PATH);
    const meta = {
      ...(previousMeta || {}),
      nextRefreshAt,
      protected: true,
      skippedByCooldown: true,
      protectionReason: "刷新冷却中，保留现有 products.json",
      cooldown,
      itemCount: previousProducts?.items?.length ?? previousMeta?.itemCount ?? 0,
      lastErrors: previousMeta?.errors || [],
      errors: [],
    };
    await writeJsonAtomic(new URL(META_PATH, root), meta);
    return meta;
  }

  const [sourcesConfig, rules] = await Promise.all([
    readJson("data/sources.json"),
    readJson("data/rules.json"),
  ]);
  const previousProducts = await readJsonOrNull(PRODUCTS_PATH);
  const backup = await backupCurrentData();
  const ldxpFetchMode = resolveLdxpFetchMode();
  const ldxpSchedulerConfig = resolveLdxpSchedulerConfig();
  const ldxpSchedulerState = await readLdxpSchedulerState();
  const probeIntervalMs = resolveDisabledSourceProbeIntervalMs();
  const probeResult = await probeAndRecoverDisabledSources(sourcesConfig.sources, {
    schedulerState: ldxpSchedulerState,
    probeIntervalMs,
    now: new Date(),
  });
  if (probeResult.changed) {
    sourcesConfig.sources = probeResult.sources;
  }
  const deadSources = disableDeadSources(sourcesConfig.sources, {
    lastFailures: ldxpSchedulerState.lastFailures,
    lastSuccess: ldxpSchedulerState.lastSuccess,
  });
  if (deadSources.changed) {
    sourcesConfig.sources = deadSources.sources;
  }
  if (probeResult.changed || deadSources.changed) {
    await writeJsonAtomic(new URL("data/sources.json", root), sourcesConfig);
  }
  const enabledSources = sourcesConfig.sources.filter((source) => source.enabled !== false);
  const ldxpPlan = buildLdxpRefreshPlan({
    sources: enabledSources,
    state: ldxpSchedulerState,
    now: new Date(),
    maxSourcesPerRun: ldxpSchedulerConfig.maxSourcesPerRun,
  });
  const scheduledLdxpIds = new Set(ldxpPlan.sources.map((source) => source.id));
  const staleSourceIds = new Set(ldxpPlan.skipped.map((entry) => entry.source.id));
  const refreshSources = enabledSources.filter((source) => (
    source.adapter !== "ldxp" || scheduledLdxpIds.has(source.id)
  ));
  const errors = [];
  const items = [];
  const fallbackProxy = new FallbackProxyContext();
  const blockedHosts = new Set();
  const nextLdxpState = ldxpPlan.nextState;
  let previousLdxpHost = null;

  try {
    for (const source of refreshSources) {
      try {
        if (source.adapter === "ldxp") {
          const host = sourceHost(source);
          if (previousLdxpHost) await sleep(randomLdxpDelayMs());
          previousLdxpHost = host;
        }
        const adapter = adapters[source.adapter];
        if (!adapter) throw new Error(`未知适配器: ${source.adapter}`);
        const fetchedAt = new Date().toISOString();
        const fetchedItems = await adapter(source, rules, { fallbackProxy, blockedHosts, ldxpFetchMode });
        items.push(...fetchedItems.map((item) => ({ ...item, fetchedAt })));
        nextLdxpState.lastSuccess = {
          ...(nextLdxpState.lastSuccess || {}),
          [source.id]: fetchedAt,
        };
        if (nextLdxpState.lastFailures?.[source.id]) {
          delete nextLdxpState.lastFailures[source.id];
        }
      } catch (error) {
        staleSourceIds.add(source.id);
        if (source.adapter === "ldxp") {
          const host = sourceHost(source);
          nextLdxpState.lastFailures = {
            ...(nextLdxpState.lastFailures || {}),
            [source.id]: {
              at: new Date().toISOString(),
              message: error.message,
            },
          };
          if (DOMAIN_SKIP_ERROR_PATTERNS.some((pattern) => pattern.test(error.message))) {
            nextLdxpState.cooldowns = {
              ...(nextLdxpState.cooldowns || {}),
              [host]: {
                reason: error.message,
                startedAt: new Date().toISOString(),
                until: new Date(Date.now() + ldxpSchedulerConfig.domainCooldownMs).toISOString(),
              },
            };
          }
        }
        errors.push({
          sourceId: source.id,
          sourceName: source.name,
          adapter: source.adapter,
          message: error.message,
        });
      }
    }
  } finally {
    await fallbackProxy.close();
    nextLdxpState.lastFailures = pruneUnknownSourceFailures(
      nextLdxpState.lastFailures,
      sourcesConfig.sources,
    );
    await writeLdxpSchedulerState(nextLdxpState);
  }

  const generatedAt = new Date().toISOString();
  const mergedItems = mergeProductsWithStaleSourceItems({
    previousItems: previousProducts?.items || [],
    currentItems: items,
    failedSourceIds: staleSourceIds,
    rules,
  });
  // 规则更新后统一重算，避免 skipped/stale 以外的旧 subtype 残留，并对齐商品链接
  const reclassifiedItems = reclassifyProductItems(mergedItems, rules, sourcesConfig.sources);
  // 当规则判定依然为 unknown 时，按需通过本地 AI 伴生小模型兜底识别
  const aiResolvedItems = await applyAiClassifierToUnknowns(reclassifiedItems);
  const sortedItems = sortProductsForDisplay(aiResolvedItems);
  const products = {
    generatedAt,
    brands: [
      {
        id: "codex",
        name: "Codex",
        subtypes: [
          { id: "free", label: "Free" },
          { id: "plus", label: "Plus" },
          { id: "pro_5x", label: "5x" },
          { id: "pro_20x", label: "20x" },
          { id: "codex_sms", label: "SMS" },
        ],
      },
      {
        id: "grok",
        name: "Grok",
        subtypes: [
          { id: "free", label: "Free" },
          { id: "m1", label: "1M" },
          { id: "m3", label: "3M" },
          { id: "y1", label: "1Y" },
        ],
      },
      {
        id: "gemini",
        name: "Gemini",
        subtypes: [
          { id: "y1", label: "1Y" },
          { id: "m18", label: "18M" },
          { id: "others", label: "Others" },
        ],
      },
    ],
    categories: [
      { id: "codex", name: "Codex", subtypes: rules.codexSubtypes },
      { id: "sms", name: "接码", subtypes: [rules.smsSubtype] },
      { id: "grok", name: "Grok", subtypes: rules.grokSubtypes || ["free", "m1", "m3", "y1"] },
      { id: "gemini", name: "Gemini", subtypes: rules.geminiSubtypes || ["y1", "m18", "others"] },
    ],
    items: sortedItems,
  };
  const meta = {
    generatedAt,
    nextRefreshAt,
    sourceCount: enabledSources.length,
    attemptedCount: refreshSources.length,
    successCount: refreshSources.length - errors.length,
    failureCount: errors.length,
    skippedCount: ldxpPlan.skipped.length,
    itemCount: sortedItems.length,
    errors,
    sources: buildSourceHealth({
      sources: enabledSources,
      items: sortedItems,
      skipped: ldxpPlan.skipped.map((entry) => ({
        sourceId: entry.source.id,
        sourceName: entry.source.name,
        reason: entry.reason,
      })),
      errors,
      lastSuccess: nextLdxpState.lastSuccess || {},
      lastFailures: nextLdxpState.lastFailures || {},
      now: new Date(generatedAt),
    }),
    ldxp: {
      fetchMode: ldxpFetchMode,
      maxSourcesPerRun: ldxpSchedulerConfig.maxSourcesPerRun,
      scheduledSourceCount: ldxpPlan.sources.length,
      staleSourceCount: staleSourceIds.size,
      cooldownHours: ldxpSchedulerConfig.domainCooldownMs / 60 / 60 / 1000,
      delayRangeMs: [ldxpSchedulerConfig.delayMinMs, ldxpSchedulerConfig.delayMaxMs],
      skipped: ldxpPlan.skipped.map((entry) => ({
        sourceId: entry.source.id,
        sourceName: entry.source.name,
        reason: entry.reason,
      })),
    },
  };

  const protectCurrentData = shouldProtectRefreshResult({
    previousItemCount: previousProducts?.items?.length ?? 0,
    nextItemCount: sortedItems.length,
    sourceCount: enabledSources.length,
    failureCount: errors.length,
    errors,
  });

  await mkdir(dataDir, { recursive: true });
  if (protectCurrentData) {
    const cooldown = await writeCooldown(errors[0]?.message || "刷新失败保护");
    meta.protected = true;
    meta.protectionReason = "刷新失败比例过高或商品数量骤降，已保留旧 products.json";
    meta.protectedItemCount = previousProducts?.items?.length ?? 0;
    meta.rejectedItemCount = sortedItems.length;
    meta.cooldown = cooldown;
    meta.backup = backup;
  } else {
    meta.protected = false;
    meta.backup = backup;
    await writeJsonAtomic(new URL("products.json", dataDir), products);
    try {
      meta.stockWatch = await processStockWatchNotifications({
        watchPath: new URL(STOCK_WATCH_PATH, root),
        previousProducts: previousProducts?.items || [],
        currentProducts: sortedItems,
      });
    } catch (error) {
      meta.stockWatch = {
        enabled: process.env.STOCK_NOTIFY_ENABLED !== "0",
        error: error instanceof Error ? error.message : String(error),
      };
    }
    try {
      const watchData = await readStockWatch(new URL(STOCK_WATCH_PATH, root));
      const watchIds = watchData.items.filter((item) => item.enabled !== false).map((item) => item.productId);
      const history = await updateWatchPriceHistory({
        historyPath: new URL(PRICE_HISTORY_PATH, root),
        backupDir,
        productIds: watchIds,
        products: sortedItems,
        now: new Date(generatedAt),
      });
      meta.priceHistory = {
        trackedCount: watchIds.length,
        pointCount: Object.values(history.items).reduce((sum, series) => sum + (series.points?.length || 0), 0),
      };
    } catch (error) {
      meta.priceHistory = {
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  await writeJsonAtomic(new URL("meta.json", dataDir), meta);

  return meta;
}
