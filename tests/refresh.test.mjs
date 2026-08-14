import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  FallbackProxyContext,
  buildFallbackProxyConfig,
  shouldProtectRefreshResult,
  shouldUseFallbackForError,
} from "../src/fallback-proxy.mjs";
import {
  buildLdxpRefreshPlan,
  buildSourceHealth,
  disableDeadSources,
  mergeProductsWithStaleSourceItems,
  parseBackupFilenameDate,
  pruneExpiredBackups,
  pruneUnknownSourceFailures,
  reclassifyProductItems,
  resolveLdxpFetchMode,
  resolveLdxpSchedulerConfig,
  shouldDisableFailedSource,
} from "../src/refresh.mjs";
import { parseDotEnv } from "../src/env.mjs";
import {
  isPublicStaticPath,
  toPublicMeta,
  toPublicProductItem,
  toPublicProductsDocument,
} from "../src/public-payload.mjs";
import {
  buildLdxpPlaywrightPayload,
  buildLdxpPlaywrightRunners,
} from "../src/ldxp-playwright.mjs";
import {
  appendHistoryPoints,
  backfillHistoryFromBackups,
  pruneHistory,
  summarizeHistory,
} from "../src/price-history.mjs";

const root = new URL("../", import.meta.url);
const rules = JSON.parse(await readFile(new URL("data/rules.json", root), "utf8"));
const sources = JSON.parse(await readFile(new URL("data/sources.json", root), "utf8"));

assert.deepEqual(
  parseDotEnv([
    "LDXP_FETCH_MODE=fetch",
    "LDXP_PLAYWRIGHT_HEADLESS=0",
    "QUOTED=\"hello world\"",
    "COMMENTED=value # trailing comment",
    "# ignored",
    "",
  ].join("\n")),
  {
    LDXP_FETCH_MODE: "fetch",
    LDXP_PLAYWRIGHT_HEADLESS: "0",
    QUOTED: "hello world",
    COMMENTED: "value",
  },
);

assert.equal(buildFallbackProxyConfig({}).enabled, false);
assert.deepEqual(
  buildFallbackProxyConfig({ FALLBACK_SSH_HOST: "vps" }),
  {
    enabled: true,
    sshHost: "vps",
    localHost: "127.0.0.1",
    localPort: 7891,
    proxyUrl: "socks5h://127.0.0.1:7891",
    requestAttempts: 3,
    retryDelayMs: 1000,
  },
);
assert.deepEqual(
  buildFallbackProxyConfig({
    FALLBACK_PROXY_URL: "http://127.0.0.1:7890",
    FALLBACK_PROXY_REQUEST_ATTEMPTS: "5",
    FALLBACK_PROXY_RETRY_DELAY_MS: "250",
  }),
  {
    enabled: true,
    localHost: "127.0.0.1",
    localPort: 7891,
    proxyUrl: "http://127.0.0.1:7890",
    requestAttempts: 5,
    retryDelayMs: 250,
  },
);
let fallbackCommandAttempts = 0;
const fallbackRetryWaits = [];
const retryingFallback = new FallbackProxyContext({
  enabled: true,
  proxyUrl: "http://127.0.0.1:7890",
  requestAttempts: 3,
  retryDelayMs: 100,
}, {
  execFileAsync: async () => {
    fallbackCommandAttempts += 1;
    if (fallbackCommandAttempts < 3) throw new Error("SSL_ERROR_SYSCALL");
    return { stdout: '{"ok":true}\n__HTTP_STATUS__:200' };
  },
  wait: async (delayMs) => fallbackRetryWaits.push(delayMs),
});
assert.deepEqual(await retryingFallback.fetchJson("https://example.com/data"), { ok: true });
assert.equal(fallbackCommandAttempts, 3);
assert.deepEqual(fallbackRetryWaits, [100, 200]);
assert.equal(shouldUseFallbackForError(Object.assign(new Error("HTTP 520"), { status: 520 })), true);
assert.equal(shouldUseFallbackForError(Object.assign(new Error("HTTP 403"), { status: 403 })), true);
assert.equal(shouldUseFallbackForError(Object.assign(new Error("HTTP 404"), { status: 404 })), false);
assert.equal(shouldUseFallbackForError(new Error("fetch failed")), true);
assert.equal(resolveLdxpFetchMode({}), "playwright");
assert.equal(resolveLdxpFetchMode({ LDXP_FETCH_MODE: "fetch" }), "fetch");
assert.equal(resolveLdxpFetchMode({ LDXP_FETCH_MODE: "playwright" }), "playwright");
assert.equal(resolveLdxpFetchMode({ LDXP_PLAYWRIGHT_DISABLED: "1" }), "fetch");
assert.throws(() => resolveLdxpFetchMode({ LDXP_FETCH_MODE: "curl" }), /LDXP_FETCH_MODE/);
assert.deepEqual(resolveLdxpSchedulerConfig({}), {
  domainCooldownMs: 21600000,
  maxSourcesPerRun: 15,
  delayMinMs: 8000,
  delayMaxMs: 25000,
});
assert.deepEqual(
  resolveLdxpSchedulerConfig({
    LDXP_MAX_SOURCES_PER_RUN: "12",
    LDXP_DOMAIN_COOLDOWN_HOURS: "3",
    LDXP_DELAY_MIN_MS: "1000",
    LDXP_DELAY_MAX_MS: "2000",
  }),
  {
    domainCooldownMs: 10800000,
    maxSourcesPerRun: 12,
    delayMinMs: 1000,
    delayMaxMs: 2000,
  },
);
assert.deepEqual(
  buildLdxpRefreshPlan({
    sources: [
      { id: "normal-1", adapter: "ldxp", url: "https://pay.ldxp.cn/shop/a" },
      { id: "core-1", adapter: "ldxp", core: true, url: "https://pay.ldxp.cn/shop/b" },
      { id: "normal-2", adapter: "ldxp", url: "https://pay.ldxp.cn/shop/c" },
      { id: "acg-1", adapter: "acg", url: "https://example.com/" },
    ],
    state: { cursorByHost: { "pay.ldxp.cn": 1 } },
    now: new Date("2026-05-30T00:00:00.000Z"),
    maxSourcesPerRun: 2,
  }).sources.map((source) => source.id),
  ["core-1", "normal-2"],
);
assert.deepEqual(
  buildLdxpRefreshPlan({
    sources: [
      { id: "core-1", adapter: "ldxp", core: true, url: "https://pay.ldxp.cn/shop/b" },
      { id: "normal-1", adapter: "ldxp", url: "https://pay.ldxp.cn/shop/a" },
    ],
    state: {
      cooldowns: {
        "pay.ldxp.cn": {
          until: "2026-05-30T06:00:00.000Z",
          reason: "WAF",
        },
      },
    },
    now: new Date("2026-05-30T00:00:00.000Z"),
  }).skipped.map((entry) => entry.source.id),
  ["core-1", "normal-1"],
);
assert.deepEqual(
  buildSourceHealth({
    sources: [
      { id: "core-1", name: "核心店", adapter: "ldxp", core: true },
      { id: "skip-1", name: "轮空店", adapter: "ldxp" },
      { id: "fail-1", name: "失败店", adapter: "ldxp" },
    ],
    items: [
      { sourceId: "core-1", fetchedAt: "2026-08-14T00:00:00.000Z" },
      { sourceId: "skip-1", fetchedAt: "2026-08-13T21:00:00.000Z" },
    ],
    skipped: [{ sourceId: "skip-1", reason: "ldxp 本轮未排到，保留旧数据" }],
    errors: [{ sourceId: "fail-1", message: "HTTP 522" }],
    lastSuccess: { "core-1": "2026-08-14T00:00:00.000Z" },
    lastFailures: { "fail-1": { at: "2026-08-14T00:00:00.000Z", message: "HTTP 522" } },
    now: new Date("2026-08-14T03:00:00.000Z"),
  }).map((entry) => ({ id: entry.sourceId, status: entry.status, ageHours: entry.ageHours })),
  [
    { id: "core-1", status: "ok", ageHours: 3 },
    { id: "skip-1", status: "skipped", ageHours: 6 },
    { id: "fail-1", status: "failed", ageHours: null },
  ],
);
assert.deepEqual(
  mergeProductsWithStaleSourceItems({
    previousItems: [
      { id: "ldxp-a:old", sourceId: "ldxp-a", title: "old-a" },
      { id: "ldxp-b:old", sourceId: "ldxp-b", title: "old-b" },
      { id: "acg-a:old", sourceId: "acg-a", title: "old-acg" },
    ],
    currentItems: [
      { id: "ldxp-a:new", sourceId: "ldxp-a", title: "new-a" },
      { id: "acg-a:new", sourceId: "acg-a", title: "new-acg" },
    ],
    failedSourceIds: new Set(["ldxp-b"]),
  }).map((item) => item.id),
  ["ldxp-a:new", "acg-a:new", "ldxp-b:old"],
);
assert.deepEqual(
  reclassifyProductItems([
    {
      id: "ldxp-pay-ldxp-cn-j2fbuhez:aw0gxk",
      sourceId: "ldxp-pay-ldxp-cn-j2fbuhez",
      title: "【Grok 普号】【帐密+sso】成品｜域名邮箱】无保---不支持grok build,量大联系",
      descriptionText: "GROK【 普号 |直登成品】域名邮箱 三段格式 帐号+密码+sso grok普号 没有会员 1个月 质保",
      brand: "grok",
      category: "grok",
      subtype: "m1",
      tags: ["grok", "m1"],
      matchReasons: ["命中时长: 1个月"],
    },
  ], rules).map((item) => ({
    id: item.id,
    subtype: item.subtype,
    tags: item.tags,
  })),
  [{
    id: "ldxp-pay-ldxp-cn-j2fbuhez:aw0gxk",
    subtype: "free",
    tags: ["grok", "free"],
  }],
);
assert.deepEqual(
  mergeProductsWithStaleSourceItems({
    previousItems: [
      {
        id: "ldxp-apple:old",
        sourceId: "ldxp-apple",
        title: "土耳奇苹果ID｜未开通iCloud｜下载APP |",
        descriptionText: "土耳奇苹果Apple ID账号批发零售 GPT",
      },
      {
        id: "ldxp-go:old",
        sourceId: "ldxp-go",
        title: "ChatGPT GO 三个月！！！质保1个月！！！",
        descriptionText: "账号密码验证码登录",
      },
      {
        id: "ldxp-plus:old",
        sourceId: "ldxp-plus",
        title: "ChatGPT Plus 成品号",
        descriptionText: "",
      },
    ],
    currentItems: [],
    failedSourceIds: new Set(["ldxp-apple", "ldxp-go", "ldxp-plus"]),
    rules,
  }).map((item) => item.id),
  ["ldxp-go:old", "ldxp-plus:old"],
);
assert.deepEqual(
  mergeProductsWithStaleSourceItems({
    previousItems: [
      {
        id: "ldxp-maomao-ai:x5zl5e",
        sourceId: "ldxp-maomao-ai",
        title: "gpt free 优质货已接码 可升级plus",
        descriptionText: "质保首登 gptfree 接码号",
        category: "codex",
        subtype: "plus",
        confidence: 0.9,
        tags: ["plus"],
        matchReasons: ["命中套餐词: plus"],
      },
    ],
    currentItems: [],
    failedSourceIds: new Set(["ldxp-maomao-ai"]),
    rules,
  }).map((item) => ({
    id: item.id,
    category: item.category,
    subtype: item.subtype,
    tags: item.tags,
  })),
  [{
    id: "ldxp-maomao-ai:x5zl5e",
    category: "codex",
    subtype: "free",
    tags: ["free"],
  }],
);
assert.deepEqual(buildLdxpPlaywrightRunners({}), [{ id: "local", kind: "local" }]);
assert.deepEqual(
  buildLdxpPlaywrightRunners({
    FALLBACK_SSH_HOST: "vps",
    LDXP_WINDOWS_TAILSCALE_IP: "100.127.136.64",
  }),
  [
    { id: "local", kind: "local" },
    { id: "vps", kind: "ssh", host: "vps" },
    { id: "windows", kind: "windows-tailscale", host: "100.127.136.64" },
  ],
);
assert.deepEqual(
  buildLdxpPlaywrightPayload(
    { url: "https://pay.ldxp.cn/shop/echo_dream", token: "echo_dream" },
    { id: "local", kind: "local" },
    { LDXP_PLAYWRIGHT_MANUAL_WAIT_MS: "30000" },
  ),
  {
    source: { url: "https://pay.ldxp.cn/shop/echo_dream", token: "echo_dream" },
    channel: "chrome",
    headless: false,
    manualWaitMs: 30000,
    requestRetryAttempts: 4,
    requestRetryDelayMs: 3000,
    timeoutMs: 60000,
    remoteCwd: "/root/codex-price-compare",
    userDataDir: ".playwright-ldxp-profile",
  },
);
assert.equal(
  buildLdxpPlaywrightPayload(
    { url: "https://pay.ldxp.cn/shop/echo_dream", token: "echo_dream" },
    { id: "local", kind: "local" },
    {
      LDXP_PLAYWRIGHT_REQUEST_RETRY_ATTEMPTS: "6",
      LDXP_PLAYWRIGHT_REQUEST_RETRY_DELAY_MS: "500",
    },
  ).requestRetryAttempts,
  6,
);
assert.equal(
  buildLdxpPlaywrightPayload(
    { url: "https://pay.ldxp.cn/shop/echo_dream", token: "echo_dream" },
    { id: "local", kind: "local" },
    {
      LDXP_PLAYWRIGHT_REQUEST_RETRY_ATTEMPTS: "6",
      LDXP_PLAYWRIGHT_REQUEST_RETRY_DELAY_MS: "500",
    },
  ).requestRetryDelayMs,
  500,
);
assert.equal(
  shouldProtectRefreshResult({
    previousItemCount: 200,
    nextItemCount: 52,
    sourceCount: 30,
    failureCount: 22,
    errors: [{ message: "HTTP 520" }],
  }),
  true,
);
assert.equal(
  shouldProtectRefreshResult({
    previousItemCount: 52,
    nextItemCount: 120,
    sourceCount: 30,
    failureCount: 2,
    errors: [{ message: "HTTP 404" }],
  }),
  false,
);

assert.equal(sources.version, 1);
assert.ok(sources.sources.some((source) => source.adapter === "ldxp"));
assert.ok(sources.sources.some((source) => source.adapter === "acg"));
assert.ok(sources.sources.some((source) => source.adapter === "dujiao"));
assert.ok(sources.sources.length >= 30);
assert.ok(!sources.sources.some((source) => source.id === "acg-caowo" || source.url === "https://caowo.store/"));
assert.ok(!sources.sources.some((source) => source.id === "ldxp-kaka" || source.url === "https://pay.ldxp.cn/shop/D92VW084"));
assert.ok(sources.sources.some((source) => source.url === "https://pay.ldxp.cn/shop/catcoder"));
assert.ok(sources.sources.some((source) => (
  source.id === "ldxp-doghubx"
  && source.name === "doghubx"
  && source.url === "https://pay.ldxp.cn/shop/JBJJWNA5"
  && source.token === "JBJJWNA5"
)));
assert.ok(sources.sources.some((source) => (
  source.id === "ldxp-akkkk"
  && source.name === "Akkkk"
  && source.url === "https://pay.ldxp.cn/shop/1PTC0Z1B"
  && source.token === "1PTC0Z1B"
)));
assert.ok(sources.sources.some((source) => (
  source.id === "ldxp-niuniushop"
  && source.name === "牛牛ai专卖店"
  && source.url === "https://pay.ldxp.cn/shop/niuniushop"
  && source.token === "niuniushop"
)));
assert.ok(sources.sources.some((source) => (
  source.id === "ldxp-gpt-chengpin"
  && source.name === "gpt成品"
  && source.url === "https://pay.ldxp.cn/shop/6YEJH8PE"
  && source.token === "6YEJH8PE"
)));
assert.ok(sources.sources.some((source) => (
  source.id === "ldxp-longteng"
  && source.name === "龙腾专卖店"
  && source.url === "https://pay.ldxp.cn/shop/DEQLOPDB"
  && source.token === "DEQLOPDB"
)));
assert.ok(sources.sources.some((source) => (
  source.id === "ldxp-z7krwfir"
  && source.name === "AI最严厉的父亲"
  && source.url === "https://pay.ldxp.cn/shop/Z7KRWFIR"
  && source.token === "Z7KRWFIR"
)));
assert.ok(sources.sources.some((source) => (
  source.id === "ldxp-haoai"
  && source.name === "Ai小店"
  && source.url === "https://pay.ldxp.cn/shop/haoai"
  && source.token === "haoai"
)));
assert.ok(sources.sources.some((source) => source.url === "https://gmail91.shop/"));
assert.ok(sources.sources.some((source) => source.url === "https://shop.mfttai.com/"));
assert.ok(
  sources.sources.some((source) => source.url === "https://kelaode.vip/" && source.apiBase === "https://api.kelaode.vip/"),
);
assert.ok(
  sources.sources.some((source) => (
    source.id === "dujiao-spark-zone"
    && source.name === "Spark-zone"
    && source.url === "https://spark-zone.org/"
    && source.adapter === "dujiao"
  )),
);

assert.equal(isPublicStaticPath("/"), true);
assert.equal(isPublicStaticPath("/index.html"), true);
assert.equal(isPublicStaticPath("/data/products.json"), true);
assert.equal(isPublicStaticPath("/.env"), false);
assert.equal(isPublicStaticPath("/src/refresh.mjs"), false);
assert.equal(isPublicStaticPath("/data/stock-watch.json"), false);
assert.equal(isPublicStaticPath("/data/backups/latest-products.json"), false);

const publicItem = toPublicProductItem({
  id: "ldxp-test:1",
  brand: "codex",
  category: "codex",
  subtype: "plus",
  title: "ChatGPT Plus 成品号",
  price: 12,
  currency: "CNY",
  stockStatus: "in_stock",
  stockCount: 3,
  url: "https://pay.ldxp.cn/item/1",
  sourceId: "ldxp-test",
  sourceName: "test",
  sourceUrl: "https://pay.ldxp.cn/shop/test",
  sourceAdapter: "ldxp",
  sourceCategory: "gpt",
  fetchedAt: "2026-08-14T01:00:00.000Z",
  confidence: 0.9,
  tags: ["plus"],
  matchReasons: ["命中套餐词: plus"],
  descriptionText: "内部描述",
  raw: { goodsKey: "1" },
});
assert.equal(publicItem.title, "ChatGPT Plus 成品号");
assert.equal(publicItem.subtype, "plus");
assert.equal(publicItem.fetchedAt, "2026-08-14T01:00:00.000Z");
assert.equal(Object.hasOwn(publicItem, "raw"), false);
assert.equal(Object.hasOwn(publicItem, "descriptionText"), false);
assert.equal(Object.hasOwn(publicItem, "matchReasons"), false);
assert.equal(Object.hasOwn(publicItem, "confidence"), false);
assert.deepEqual(
  toPublicMeta({
    itemCount: 10,
    backup: {
      products: "/Users/hal9000/Websites/codex-price-compare/data/backups/x-products.json",
      meta: "/Users/hal9000/Websites/codex-price-compare/data/backups/x-meta.json",
    },
    sources: [{ sourceId: "ldxp-test", lastError: "HTTP 522" }],
    priceHistory: { trackedCount: 3, pointCount: 40 },
  }),
  { itemCount: 10 },
);
assert.deepEqual(
  toPublicProductsDocument({
    generatedAt: "2026-08-14T00:00:00.000Z",
    brands: [{ id: "codex" }],
    categories: [{ id: "codex" }],
    items: [{
      id: "ldxp-test:1",
      title: "Plus",
      raw: { goodsKey: "1" },
      descriptionText: "secret",
    }],
  }).items.map((item) => Object.keys(item).sort()),
  [["id", "title"].sort()],
);


assert.equal(parseBackupFilenameDate("2026-08-01T00-00-00-000Z-products.json")?.toISOString(), "2026-08-01T00:00:00.000Z");
assert.equal(parseBackupFilenameDate("notes.txt"), null);

const backupDir = await mkdtemp(join(tmpdir(), "codex-price-compare-backups-"));
try {
  const keepName = "2026-08-10T00-00-00-000Z-products.json";
  const dropName = "2026-07-01T00-00-00-000Z-products.json";
  await writeFile(join(backupDir, keepName), "{}\n");
  await writeFile(join(backupDir, dropName), "{}\n");
  await writeFile(join(backupDir, "readme.txt"), "keep\n");
  const removed = await pruneExpiredBackups({
    dir: pathToFileURL(`${backupDir}/`),
    now: new Date("2026-08-14T00:00:00.000Z"),
    retentionMs: 14 * 24 * 60 * 60 * 1000,
  });
  assert.deepEqual(removed, [dropName]);
  assert.deepEqual((await readdir(backupDir)).sort(), ["readme.txt", keepName].sort());
} finally {
  await rm(backupDir, { recursive: true, force: true });
}

const deadNow = new Date("2026-08-14T00:00:00.000Z");
assert.equal(shouldDisableFailedSource({
  message: "商家已被关闭",
  failedAt: deadNow.toISOString(),
  now: deadNow,
}), true);
assert.equal(shouldDisableFailedSource({
  message: "店铺不存在",
  failedAt: deadNow.toISOString(),
  now: deadNow,
}), true);
assert.equal(shouldDisableFailedSource({
  message: "WAF challenge",
  failedAt: "2026-07-01T00:00:00.000Z",
  now: deadNow,
}), false);
assert.equal(shouldDisableFailedSource({
  message: "HTTP 403",
  failedAt: "2026-07-01T00:00:00.000Z",
  now: deadNow,
}), false);
assert.equal(shouldDisableFailedSource({
  message: "HTTP 525",
  failedAt: "2026-08-13T00:00:00.000Z",
  now: deadNow,
}), false);
assert.equal(shouldDisableFailedSource({
  message: "HTTP 525",
  failedAt: "2026-07-20T00:00:00.000Z",
  now: deadNow,
}), true);
assert.equal(shouldDisableFailedSource({
  message: "HTTP 525",
  failedAt: "2026-07-20T00:00:00.000Z",
  lastSuccessAt: "2026-07-21T00:00:00.000Z",
  now: deadNow,
}), false);

const disabled = disableDeadSources([
  { id: "dead", name: "死店", adapter: "ldxp", core: true, url: "https://pay.ldxp.cn/shop/dead" },
  { id: "waf", name: "WAF店", adapter: "ldxp", url: "https://pay.ldxp.cn/shop/waf" },
  { id: "ok", name: "好店", adapter: "ldxp", url: "https://pay.ldxp.cn/shop/ok" },
  { id: "already", name: "已关", adapter: "ldxp", enabled: false, url: "https://pay.ldxp.cn/shop/already" },
], {
  lastFailures: {
    dead: { at: "2026-07-01T00:00:00.000Z", message: "店铺不存在" },
    waf: { at: "2026-07-01T00:00:00.000Z", message: "WAF" },
  },
  now: deadNow,
});
assert.equal(disabled.changed, true);
assert.equal(disabled.sources.find((source) => source.id === "dead").enabled, false);
assert.equal(disabled.sources.find((source) => source.id === "dead").disabledReason, "店铺不存在");
assert.equal(disabled.sources.find((source) => source.id === "waf").enabled, undefined);
assert.equal(disabled.sources.find((source) => source.id === "already").enabled, false);

const enabledAfterDisable = disabled.sources.filter((source) => source.enabled !== false);
assert.deepEqual(
  buildLdxpRefreshPlan({
    sources: enabledAfterDisable,
    now: deadNow,
    maxSourcesPerRun: 15,
  }).sources.map((source) => source.id),
  ["waf", "ok"],
);

assert.deepEqual(
  pruneUnknownSourceFailures(
    { keep: { message: "x" }, gone: { message: "y" } },
    [{ id: "keep" }],
  ),
  { keep: { message: "x" } },
);

const historyProduct = {
  id: "sku-1",
  price: 10,
  stockStatus: "in_stock",
  stockCount: 5,
};
let history = appendHistoryPoints({ version: 1, items: {} }, {
  productIds: ["sku-1"],
  products: [historyProduct],
  now: new Date("2026-08-14T02:00:00.000Z"),
});
assert.equal(history.items["sku-1"].points.length, 1);
history = appendHistoryPoints(history, {
  productIds: ["sku-1"],
  products: [historyProduct],
  now: new Date("2026-08-14T02:30:00.000Z"),
});
assert.equal(history.items["sku-1"].points.length, 1);
history = appendHistoryPoints(history, {
  productIds: ["sku-1"],
  products: [{ ...historyProduct, price: 8 }],
  now: new Date("2026-08-14T02:40:00.000Z"),
});
assert.equal(history.items["sku-1"].points.length, 2);
history = appendHistoryPoints(history, {
  productIds: ["sku-1"],
  products: [{ ...historyProduct, price: 8 }],
  now: new Date("2026-08-14T03:40:00.000Z"),
});
assert.equal(history.items["sku-1"].points.length, 3);
assert.deepEqual(summarizeHistory(history.items["sku-1"].points), {
  count: 3,
  low: 8,
  high: 10,
  last: history.items["sku-1"].points[2],
});

const pruned = pruneHistory({
  version: 1,
  items: {
    "sku-1": {
      points: [
        { t: "2026-07-01T00:00:00.000Z", p: 1, s: "in_stock", c: 1 },
        { t: "2026-08-10T00:00:00.000Z", p: 2, s: "in_stock", c: 1 },
      ],
    },
    "sku-gone": {
      points: [{ t: "2026-08-10T00:00:00.000Z", p: 3, s: "in_stock", c: 1 }],
    },
  },
}, {
  now: new Date("2026-08-14T00:00:00.000Z"),
  keepIds: ["sku-1"],
});
assert.deepEqual(Object.keys(pruned.items), ["sku-1"]);
assert.equal(pruned.items["sku-1"].points.length, 1);
assert.equal(pruned.items["sku-1"].points[0].p, 2);

const historyDir = await mkdtemp(join(tmpdir(), "codex-price-compare-history-"));
try {
  await writeFile(join(historyDir, "2026-08-01T00-00-00-000Z-products.json"), JSON.stringify({
    items: [{ id: "sku-1", price: 9, stockStatus: "in_stock", stockCount: 2 }],
  }));
  await writeFile(join(historyDir, "2026-08-10T00-00-00-000Z-products.json"), JSON.stringify({
    items: [{ id: "sku-1", price: 7, stockStatus: "out_of_stock", stockCount: 0 }],
  }));
  const filled = await backfillHistoryFromBackups({
    history: { version: 1, items: {} },
    backupDir: pathToFileURL(`${historyDir}/`),
    productIds: ["sku-1"],
    now: new Date("2026-08-14T00:00:00.000Z"),
  });
  assert.equal(filled.items["sku-1"].points.length, 2);
  assert.equal(filled.items["sku-1"].points[0].p, 9);
  assert.equal(filled.items["sku-1"].points[1].p, 7);
  assert.equal(filled.items["sku-1"].points[1].s, "out_of_stock");
} finally {
  await rm(historyDir, { recursive: true, force: true });
}
