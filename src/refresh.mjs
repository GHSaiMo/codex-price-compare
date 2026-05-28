import { mkdir, readFile, writeFile } from "node:fs/promises";

import {
  normalizeAcgProduct,
  normalizeDujiaoProduct,
  normalizeLdxpProduct,
  sortProductsForDisplay,
} from "./cleaning.mjs";

const root = new URL("../", import.meta.url);
const dataDir = new URL("data/", root);

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, root), "utf8"));
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "Mozilla/5.0 codex-price-compare",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function getJson(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 codex-price-compare" },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchLdxp(source, rules) {
  const base = new URL(source.url);
  const info = await postJson(new URL("/shopApi/Shop/info", base), {
    token: source.token,
  });
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
      });
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

async function fetchAcg(source, rules) {
  const base = new URL(source.url);
  const data = await getJson(new URL("/user/api/index/commodity", base));
  if (data.code !== 200) throw new Error(data.msg || "商品列表读取失败");
  return (data.data || [])
    .map((raw) => normalizeAcgProduct(raw, source, rules))
    .filter(Boolean);
}

async function fetchDujiao(source, rules) {
  const apiBase = new URL(source.apiBase || source.url);
  const data = await getJson(new URL("/api/v1/public/products", apiBase));
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
  const [sourcesConfig, rules] = await Promise.all([
    readJson("data/sources.json"),
    readJson("data/rules.json"),
  ]);
  const enabledSources = sourcesConfig.sources.filter((source) => source.enabled !== false);
  const errors = [];
  const items = [];

  for (const source of enabledSources) {
    try {
      const adapter = adapters[source.adapter];
      if (!adapter) throw new Error(`未知适配器: ${source.adapter}`);
      items.push(...(await adapter(source, rules)));
    } catch (error) {
      errors.push({
        sourceId: source.id,
        sourceName: source.name,
        adapter: source.adapter,
        message: error.message,
      });
    }
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

  await mkdir(dataDir, { recursive: true });
  await writeFile(new URL("products.json", dataDir), `${JSON.stringify(products, null, 2)}\n`);
  await writeFile(new URL("meta.json", dataDir), `${JSON.stringify(meta, null, 2)}\n`);

  return meta;
}
