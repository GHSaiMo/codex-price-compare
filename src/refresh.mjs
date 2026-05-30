import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

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
} from "./fallback-proxy.mjs";
import { fetchLdxpViaPlaywright } from "./ldxp-playwright.mjs";
import { processStockWatchNotifications } from "./stock-watch.mjs";

const root = new URL("../", import.meta.url);
const dataDir = new URL("data/", root);
const backupDir = new URL("backups/", dataDir);
const cooldownPath = new URL("refresh-cooldown.json", dataDir);
const ldxpSchedulerPath = new URL("ldxp-scheduler.json", dataDir);
const PRODUCTS_PATH = "data/products.json";
const META_PATH = "data/meta.json";
const STOCK_WATCH_PATH = "data/stock-watch.json";
const COOLDOWN_MS = 2 * 60 * 60 * 1000;
const LDXP_MAX_SOURCES_PER_RUN = 15;
const LDXP_DELAY_MIN_MS = 8 * 1000;
const LDXP_DELAY_MAX_MS = 25 * 1000;
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
      const target = new URL(`${stamp}-${name}.json`, backupDir);
      await copyFile(source, target);
      backups[name] = target.pathname;
    } catch {
      // 首次刷新时可能还没有历史文件。
    }
  }
  return backups;
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
      cursorByHost: state?.cursorByHost && typeof state.cursorByHost === "object" ? state.cursorByHost : {},
      cooldowns: state?.cooldowns && typeof state.cooldowns === "object" ? state.cooldowns : {},
      lastFailures: state?.lastFailures && typeof state.lastFailures === "object" ? state.lastFailures : {},
    };
  } catch {
    return { version: 1, cursorByHost: {}, cooldowns: {}, lastFailures: {} };
  }
}

async function writeLdxpSchedulerState(state) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(ldxpSchedulerPath, `${JSON.stringify({
    version: 1,
    cursorByHost: state.cursorByHost || {},
    cooldowns: state.cooldowns || {},
    lastFailures: state.lastFailures || {},
  }, null, 2)}\n`);
}

async function writeCooldown(reason, date = new Date()) {
  const cooldown = {
    reason,
    startedAt: date.toISOString(),
    until: new Date(date.getTime() + COOLDOWN_MS).toISOString(),
  };
  await writeFile(cooldownPath, `${JSON.stringify(cooldown, null, 2)}\n`);
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
  const skipped = [];
  const eligible = [];
  for (const source of ldxpSources) {
    const host = sourceHost(source);
    const cooldown = activeCooldownForHost(state, host, now);
    if (cooldown) {
      skipped.push({ source, reason: `ldxp 域名 ${host} 冷却中，保留旧数据`, cooldown });
    } else {
      eligible.push(source);
    }
  }

  const selected = [];
  const selectedIds = new Set();
  for (const source of eligible.filter((entry) => entry.core === true)) {
    if (selected.length >= maxSourcesPerRun) break;
    selected.push(source);
    selectedIds.add(source.id);
  }

  const nonCoreByHost = new Map();
  for (const source of eligible) {
    if (source.core === true || selectedIds.has(source.id)) continue;
    const host = sourceHost(source);
    const entries = nonCoreByHost.get(host) || [];
    entries.push(source);
    nonCoreByHost.set(host, entries);
  }

  const cursorByHost = { ...(state.cursorByHost || {}) };
  for (const [host, entries] of nonCoreByHost) {
    const rotated = rotateSources(entries, cursorByHost[host]);
    let used = 0;
    for (const source of rotated) {
      if (selected.length >= maxSourcesPerRun) break;
      selected.push(source);
      selectedIds.add(source.id);
      used += 1;
    }
    if (used > 0) {
      cursorByHost[host] = ((Number(cursorByHost[host]) || 0) + used) % entries.length;
    }
  }

  for (const source of eligible) {
    if (!selectedIds.has(source.id)) {
      skipped.push({ source, reason: "ldxp 本轮未排到，保留旧数据" });
    }
  }

  return {
    sources: selected,
    skipped,
    nextState: {
      ...state,
      version: 1,
      cursorByHost,
      cooldowns: state.cooldowns || {},
      lastFailures: state.lastFailures || {},
    },
  };
}

export function mergeProductsWithStaleSourceItems({
  previousItems = [],
  currentItems = [],
  failedSourceIds = new Set(),
  rules = null,
} = {}) {
  const currentSourceIds = new Set(currentItems.map((item) => item.sourceId).filter(Boolean));
  const staleItems = previousItems.filter((item) => (
    item.sourceId
    && failedSourceIds.has(item.sourceId)
    && !currentSourceIds.has(item.sourceId)
    && (!rules || classifyProduct(item.title, item.descriptionText, rules).category !== "other")
  ));
  return [...currentItems, ...staleItems];
}

function randomLdxpDelayMs(env = process.env) {
  const config = resolveLdxpSchedulerConfig(env);
  return Math.round(config.delayMinMs + Math.random() * (config.delayMaxMs - config.delayMinMs));
}

async function requestJson(url, { method = "GET", body = null, fallbackProxy = null } = {}) {
  const headers = {
    ...(body !== null ? { "content-type": "application/json" } : {}),
    "user-agent": "Mozilla/5.0 codex-price-compare",
  };

  try {
    const response = await fetch(url, {
      method,
      headers,
      ...(body !== null ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw createHttpError(response.status, url);
    const raw = await response.text();
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error(`fetch 返回非 JSON: ${String(url)} ${raw.replace(/\s+/g, " ").slice(0, 120)}`);
    }
  } catch (error) {
    if (fallbackProxy?.enabled && shouldUseFallbackForError(error)) {
      return fallbackProxy.fetchJson(url, {
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
    const info = await postJson(new URL("/shopApi/Shop/info", base), {
      token: source.token,
    }, options);
    if (info.code !== 1) throw new Error(info.msg || "店铺信息读取失败");

    const shop = info.data;
    const goodsTypes = Array.isArray(shop.goods_type_sort) ? shop.goods_type_sort : ["card"];
    const items = [];

    for (const goodsType of goodsTypes) {
      let current = 1;
      while (current <= 20) {
        const data = await postJson(new URL("/shopApi/Shop/goodsList", base), {
          token: source.token,
          keywords: "",
          category_id: 0,
          goods_type: goodsType,
          current,
          pageSize: 50,
        }, options);
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
    await writeFile(new URL(META_PATH, root), `${JSON.stringify(meta, null, 2)}\n`);
    return meta;
  }

  const [sourcesConfig, rules] = await Promise.all([
    readJson("data/sources.json"),
    readJson("data/rules.json"),
  ]);
  const previousProducts = await readJsonOrNull(PRODUCTS_PATH);
  const backup = await backupCurrentData();
  const enabledSources = sourcesConfig.sources.filter((source) => source.enabled !== false);
  const ldxpFetchMode = resolveLdxpFetchMode();
  const ldxpSchedulerConfig = resolveLdxpSchedulerConfig();
  const ldxpSchedulerState = await readLdxpSchedulerState();
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
        items.push(...(await adapter(source, rules, { fallbackProxy, blockedHosts, ldxpFetchMode })));
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
    await writeLdxpSchedulerState(nextLdxpState);
  }

  const generatedAt = new Date().toISOString();
  const mergedItems = mergeProductsWithStaleSourceItems({
    previousItems: previousProducts?.items || [],
    currentItems: items,
    failedSourceIds: staleSourceIds,
    rules,
  });
  const sortedItems = sortProductsForDisplay(mergedItems);
  const products = {
    generatedAt,
    categories: [
      { id: "codex", name: "Codex", subtypes: rules.codexSubtypes },
      { id: "sms", name: "接码", subtypes: [rules.smsSubtype] },
    ],
    items: sortedItems,
  };
  const meta = {
    generatedAt,
    nextRefreshAt,
    sourceCount: enabledSources.length,
    successCount: enabledSources.length - errors.length,
    failureCount: errors.length,
    itemCount: sortedItems.length,
    errors,
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
    await writeFile(new URL("products.json", dataDir), `${JSON.stringify(products, null, 2)}\n`);
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
  }
  await writeFile(new URL("meta.json", dataDir), `${JSON.stringify(meta, null, 2)}\n`);

  return meta;
}
