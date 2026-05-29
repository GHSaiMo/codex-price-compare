import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";

import {
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

const root = new URL("../", import.meta.url);
const dataDir = new URL("data/", root);
const backupDir = new URL("backups/", dataDir);
const cooldownPath = new URL("refresh-cooldown.json", dataDir);
const PRODUCTS_PATH = "data/products.json";
const META_PATH = "data/meta.json";
const COOLDOWN_MS = 2 * 60 * 60 * 1000;
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

async function writeCooldown(reason, date = new Date()) {
  const cooldown = {
    reason,
    startedAt: date.toISOString(),
    until: new Date(date.getTime() + COOLDOWN_MS).toISOString(),
  };
  await writeFile(cooldownPath, `${JSON.stringify(cooldown, null, 2)}\n`);
  return cooldown;
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
    return response.json();
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

  if (process.env.LDXP_PLAYWRIGHT_DISABLED !== "1") {
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
  const errors = [];
  const items = [];
  const fallbackProxy = new FallbackProxyContext();
  const blockedHosts = new Set();

  try {
    for (const source of enabledSources) {
      try {
        const adapter = adapters[source.adapter];
        if (!adapter) throw new Error(`未知适配器: ${source.adapter}`);
        items.push(...(await adapter(source, rules, { fallbackProxy, blockedHosts })));
      } catch (error) {
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
  }

  const generatedAt = new Date().toISOString();
  const sortedItems = sortProductsForDisplay(items);
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
  }
  await writeFile(new URL("meta.json", dataDir), `${JSON.stringify(meta, null, 2)}\n`);

  return meta;
}
