import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  classifyProduct,
  normalizeAcgProduct,
  normalizeDujiaoProduct,
  normalizeLdxpProduct,
  sortProductsForDisplay,
} from "../src/cleaning.mjs";
import {
  buildFallbackProxyConfig,
  shouldProtectRefreshResult,
  shouldUseFallbackForError,
} from "../src/fallback-proxy.mjs";
import {
  buildLdxpRefreshPlan,
  mergeProductsWithStaleSourceItems,
  resolveLdxpFetchMode,
  resolveLdxpSchedulerConfig,
} from "../src/refresh.mjs";
import {
  parseDotEnv,
} from "../src/env.mjs";
import {
  buildLdxpPlaywrightPayload,
  buildLdxpPlaywrightRunners,
} from "../src/ldxp-playwright.mjs";
import {
  buildStockWatchNotificationUpdates,
  createStockWatchEntryFromUrl,
} from "../src/stock-watch.mjs";

const root = new URL("../", import.meta.url);

const rules = JSON.parse(await readFile(new URL("data/rules.json", root), "utf8"));
const sources = JSON.parse(await readFile(new URL("data/sources.json", root), "utf8"));
const productsData = JSON.parse(await readFile(new URL("data/products.json", root), "utf8"));
const html = await readFile(new URL("index.html", root), "utf8");
const app = await readFile(new URL("app.js", root), "utf8");
const themeApp = await readFile(new URL("theme.js", root), "utf8");
const adminHtml = await readFile(new URL("admin.html", root), "utf8");
const adminApp = await readFile(new URL("admin.js", root), "utf8");
const sourcesHtml = await readFile(new URL("sources.html", root), "utf8");
const sourcesApp = await readFile(new URL("sources.js", root), "utf8");
const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const server = await readFile(new URL("server.mjs", root), "utf8");

const stockWatchProducts = [
  {
    id: "ldxp-xiaoba:2mlvd7",
    title: "Gpt Free",
    sourceName: "Ai小八",
    price: 0.85,
    stockStatus: "out_of_stock",
    stockCount: 0,
    url: "https://pay.ldxp.cn/item/2mlvd7",
  },
];

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

assert.deepEqual(
  createStockWatchEntryFromUrl({
    products: stockWatchProducts,
    url: "https://pay.ldxp.cn/item/2mlvd7?utm_source=test#detail",
    now: new Date("2026-05-29T08:00:00.000Z"),
  }),
  {
    productId: "ldxp-xiaoba:2mlvd7",
    url: "https://pay.ldxp.cn/item/2mlvd7",
    title: "Gpt Free",
    sourceName: "Ai小八",
    enabled: true,
    createdAt: "2026-05-29T08:00:00.000Z",
    updatedAt: "2026-05-29T08:00:00.000Z",
    lastSeenAt: "2026-05-29T08:00:00.000Z",
    lastPrice: 0.85,
    lastStockStatus: "out_of_stock",
    lastStockCount: 0,
    lastNotifiedAt: null,
    lastNotifyStatus: null,
    lastNotifyError: null,
    lastNotifiedPrice: null,
    lastNotifiedStockStatus: null,
    lastNotifiedStockCount: null,
    lastNotifyChangeKey: null,
  },
);
assert.throws(
  () => createStockWatchEntryFromUrl({ products: stockWatchProducts, url: "https://pay.ldxp.cn/item/not-found" }),
  /未在当前商品数据中找到这个链接/,
);
assert.deepEqual(
  buildStockWatchNotificationUpdates({
    watchItems: [{
      productId: "ldxp-xiaoba:2mlvd7",
      enabled: true,
      lastStockStatus: "out_of_stock",
      lastStockCount: 0,
      lastNotifyStatus: null,
    }],
    previousProducts: stockWatchProducts,
    currentProducts: [{
      ...stockWatchProducts[0],
      stockStatus: "in_stock",
      stockCount: 124,
    }],
    now: new Date("2026-05-29T08:30:00.000Z"),
  }).notifications.map((notification) => notification.entry.productId),
  ["ldxp-xiaoba:2mlvd7"],
);
assert.deepEqual(
  buildStockWatchNotificationUpdates({
    watchItems: [{
      productId: "ldxp-xiaoba:2mlvd7",
      enabled: true,
      lastPrice: 0.85,
      lastStockStatus: "out_of_stock",
      lastStockCount: 0,
      lastNotifyStatus: null,
    }],
    previousProducts: stockWatchProducts,
    currentProducts: [{
      ...stockWatchProducts[0],
      price: 0.95,
    }],
    now: new Date("2026-05-29T08:35:00.000Z"),
  }).notifications.map((notification) => ({
    productId: notification.entry.productId,
    changes: notification.changes,
  })),
  [{
    productId: "ldxp-xiaoba:2mlvd7",
    changes: [{ type: "price", previous: 0.85, current: 0.95 }],
  }],
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
  },
);
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
  ["ldxp-plus:old"],
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
assert.equal(sources.sources.length, 30);
assert.ok(!sources.sources.some((source) => source.id === "acg-caowo" || source.url === "https://caowo.store/"));
assert.ok(sources.sources.some((source) => source.url === "https://pay.ldxp.cn/shop/HCJW0TDL"));
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
assert.ok(sources.sources.some((source) => source.url === "https://gmail91.shop/"));
assert.ok(sources.sources.some((source) => source.url === "https://pay.qxvx.cn/shop/OK1"));
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

assert.deepEqual(
  classifyProduct("Codex接码 ( 美区 ) 单次接码", "只能用于codex登录", rules),
  {
    category: "sms",
    subtype: "codex_sms",
    confidence: 0.95,
    tags: ["codex", "sms"],
    matchReasons: ["命中接码服务词: codex接码", "命中接码服务词: 单次接码"],
  },
);
assert.equal(
  classifyProduct("Codex接码 ( 美区 ) 单次接码", "适用于Free/Plus/Pro接码", rules).category,
  "sms",
);
assert.equal(
  classifyProduct("codex接码，美国实卡（一般可绑3个号）", "此商品为Codex接码额度卡，适用于Free/Plus/Pro接码", rules).subtype,
  "codex_sms",
);
assert.equal(
  classifyProduct("Gpt短效码🔥包接到", "", rules).category,
  "sms",
);
assert.equal(
  classifyProduct("Gpt短效码🔥包接到", "", rules).subtype,
  "codex_sms",
);
assert.equal(
  classifyProduct("【美区30天T-Mobile实体卡】", "ChatGPT接码，期限内可无限次接码", rules).category,
  "sms",
);
assert.equal(
  classifyProduct("反代教程【不要下单，直接点开看就行】记得看到最后", "json直接导入反代软件就能用，反代后使用codex，完全体gpt", rules).category,
  "other",
);
for (const title of [
  "【GPT-K12充值】理论2年，可用codex，无需接码",
  "【GPT-K12充值】理论2年，可用codex",
  "【GPT-K12充值】质保首登，无需接码，可用codex",
  "ChatGPT K12充值 理论2年 可用codex",
]) {
  assert.equal(classifyProduct(title, "", rules).category, "other");
  assert.equal(
    normalizeLdxpProduct({
      goods_key: "k12-test",
      name: title,
      description: "",
      price: "39.90",
      extend: { stock_count: "4" },
      link: "/item/k12-test",
    }, { id: "ldxp-test", name: "test", url: "https://pay.ldxp.cn/shop/test", adapter: "ldxp" }, rules),
    null,
  );
}

assert.equal(
  classifyProduct("CHATGPT FREE号 （已经接过码）", "RT JSON 包含账号密码", rules).category,
  "codex",
);
assert.equal(
  classifyProduct("CHATGPT FREE号 （已经接过码）", "RT JSON 包含账号密码", rules).subtype,
  "free",
);
assert.equal(
  classifyProduct("【顶级月卡】CodexAPI 300刀额度/天", "", rules).subtype,
  "api",
);
assert.equal(
  classifyProduct("plus--【codex可用】--该商品质保30天", "", rules).subtype,
  "plus",
);
assert.equal(
  classifyProduct("ChatGPT Pro 20x 月卡 正价官方直充", "codex 额度刷新", rules).subtype,
  "pro",
);
for (const title of [
  "Openai Codex 10美金额度🔥卡俄斯x1",
  "Openai Codex 100美金额度🔥创世纪x1",
  "Openai Codex 500美金额度🔥洛基x1 200并发x1",
  "100刀-ChatGPT Codex纯Pro线路-不限时",
  "200刀-ChatGPT Codex纯Pro线路-不限时",
  "🇺🇸 美国私人住宅IP ｜ 独享原生 ｜ 年付套餐",
]) {
  assert.equal(classifyProduct(title, "", rules).category, "other");
}
assert.equal(
  classifyProduct("ChatGPT Plus 月卡 正价官方直充", "稳定性仅次于纯Pro线路", rules).subtype,
  "plus",
);
assert.equal(
  classifyProduct("Perplexity Pro max功能都有，破解版软件，只支持安卓系统", "ChatGPT 分类", rules).category,
  "other",
);
assert.equal(
  classifyProduct("微软长效-outlook-【gr/o2双令牌号】", "刷新令牌取件", rules).category,
  "other",
);
assert.equal(
  classifyProduct("GROK【普号|直登成品｜域名邮箱】只保首登", "", rules).category,
  "other",
);
assert.equal(
  classifyProduct("随机地区2020--2024年邮箱【包GCP资格】（适合做piexl，家庭组，挖矿,注册GPT）", "", rules).category,
  "other",
);
assert.equal(
  classifyProduct("美区 Apple ID 成品号 可注册GPT", "", rules).category,
  "other",
);
assert.equal(
  classifyProduct("苹果ID账号带邮箱，适合注册ChatGPT", "", rules).category,
  "other",
);
assert.equal(
  classifyProduct("ChatGPT GO 会员账号 成品号", "", rules).category,
  "other",
);
assert.equal(
  classifyProduct("paypal实卡手机号", "", rules).category,
  "other",
);
assert.equal(
  classifyProduct("gpt接码（美卡，无质保，介意勿拍）", "", rules).category,
  "sms",
);
assert.equal(
  classifyProduct("GPT普号|Free Plan成品✅|rt 格式|自行转换|不会用勿拍|不支持接码登录", "", rules).category,
  "codex",
);
assert.equal(
  classifyProduct("GPT普号|Free Plan成品✅|rt 格式|自行转换|不会用勿拍|不支持接码登录", "", rules).subtype,
  "free",
);
assert.equal(
  classifyProduct("福利网页Plus号,无法反代,不能直接登录codex.如需使用自行接码", "", rules).category,
  "codex",
);
assert.equal(
  classifyProduct("福利网页Plus号,无法反代,不能直接登录codex.如需使用自行接码", "", rules).subtype,
  "plus",
);
assert.equal(
  classifyProduct("GPT普号|Free Plan成品✅|账密直登+RT|长效邮箱|带接码地址|适合业务", "", rules).subtype,
  "free",
);
assert.equal(
  classifyProduct("Codex|账密直登+RT|Codex/GPT已经过手机验证解锁✅|长效邮箱|带接码地址【接码成本上涨，无奈涨价】", "", rules).subtype,
  "free",
);
assert.equal(
  classifyProduct("Gpt Fre 🔥100个（已接码）| outlook.com | 日本", "", rules).subtype,
  "free",
);
assert.equal(
  classifyProduct("gpt free 优质货已接码 可升级plus", "", rules).subtype,
  "free",
);
assert.equal(
  classifyProduct("gpt free 优质货已接码 可升级puls", "", rules).subtype,
  "free",
);
assert.equal(
  classifyProduct("gpt free（90％可开plus）", "", rules).subtype,
  "free",
);
assert.equal(
  classifyProduct("GPT Free 的 RT｜已接码｜支持 sub / cpa  / JSON 3个号=5小时plus", "", rules).subtype,
  "free",
);
assert.equal(
  classifyProduct("GPT Free 成品号｜已接码｜可刷新 RT｜支持 sub / cpa  / JSON 3个号=5小时plus", "", rules).subtype,
  "free",
);
assert.equal(
  classifyProduct("gptplus稳定cdk成品账密（需接码质保首登）", "", rules).subtype,
  "plus",
);
assert.equal(
  classifyProduct("GPT puls 成品号 质保首登", "", rules).subtype,
  "plus",
);
assert.equal(
  classifyProduct("GPT半成品账号 质保首登", "", rules).subtype,
  "plus",
);
assert.equal(
  classifyProduct("ChatGPT土区直充月卡", "", rules).subtype,
  "plus",
);
assert.equal(
  classifyProduct("【日抛】PLUS未接码-仅网页-icloud📭（质保三小时内首登）", "ChatGPT Codex 可用", rules).subtype,
  "plus",
);
assert.equal(
  classifyProduct("gptplus稳定cdk成品账密（需接码质保首登）", "", rules).category,
  "codex",
);
assert.equal(
  classifyProduct("可达鸭GPT 额度卡 5个号", "", rules).subtype,
  "plus",
);
assert.equal(
  classifyProduct("可达鸭GPT 额度卡 10个号", "", rules).subtype,
  "plus",
);
assert.equal(
  classifyProduct("gpt team【成品号json反代专用】", "", rules).subtype,
  "free",
);
assert.equal(
  classifyProduct("GPT Plus新号CDK充值（pix渠道）", "请勿使用team空间的token充值", rules).subtype,
  "plus",
);
assert.equal(
  classifyProduct("GPT成品号（三天内封号换新号，30天内质保掉订阅）", "", rules).subtype,
  "plus",
);
assert.equal(
  classifyProduct("GPT成品号（三天内封号换新号，中转可用）", "", rules).subtype,
  "plus",
);

const ldxp = normalizeLdxpProduct(
  {
    link: "https://pay.ldxp.cn/item/58iqfn",
    goods_key: "58iqfn",
    name: "codex接码！超级稳定，不出码支持换号！",
    price: 1.98,
    category: { name: "ChatGPT" },
    user: { nickname: "AI小铺", token: "echo_dream" },
    extend: { stock_count: 0 },
  },
  { name: "AI小铺", url: "https://pay.ldxp.cn/shop/echo_dream", adapter: "ldxp" },
  rules,
);
assert.equal(ldxp.category, "sms");
assert.equal(ldxp.stockStatus, "out_of_stock");
assert.equal(ldxp.stockCount, 0);

const highPriceLdxp = normalizeLdxpProduct(
  {
    link: "https://pay.ldxp.cn/item/high-price",
    goods_key: "high-price",
    name: "ChatGPT Plus 土区直充",
    price: 2000,
    category: { name: "ChatGPT" },
    extend: { stock_count: 8 },
  },
  { name: "AI小铺", url: "https://pay.ldxp.cn/shop/echo_dream", adapter: "ldxp" },
  rules,
);
assert.equal(highPriceLdxp, null);
assert.deepEqual(
  productsData.items
    .filter((item) => typeof item.price === "number" && item.price >= 2000)
    .map((item) => ({ url: item.url, price: item.price })),
  [],
);

const acg = normalizeAcgProduct(
  {
    id: 51,
    name: "【试用款】CodexAPI 30刀额度 日卡",
    price: 1.68,
    stock: 56,
    category: { name: "TC中转站" },
  },
  { name: "ACG测试源", url: "https://acg.example/", adapter: "acg" },
  rules,
);
assert.equal(acg.category, "codex");
assert.equal(acg.subtype, "api");
assert.equal(acg.url, "https://acg.example/item/51");

const dujiao = normalizeDujiaoProduct(
  {
    id: 27,
    slug: "gpt-plus-1-2",
    title: { "zh-CN": "【土区】GPT PLUS 1个月自助充值CDK" },
    description: { "zh-CN": "Codex 额度未刷新可等待" },
    price_amount: "105.00",
    stock_status: "low_stock",
    is_sold_out: false,
    auto_stock_available: 2,
    category: { name: { "zh-CN": "gpt" } },
  },
  { name: "Spark-zone", url: "https://spark-zone.org/", adapter: "dujiao" },
  rules,
);
assert.equal(dujiao.subtype, "plus");
assert.equal(dujiao.stockStatus, "low_stock");

assert.deepEqual(
  sortProductsForDisplay([
    { price: 9, stockStatus: "out_of_stock" },
    { price: 5, stockStatus: "in_stock" },
    { price: 7, stockStatus: "low_stock" },
  ]).map((item) => item.price),
  [5, 7, 9],
);

assert.match(html, /data-products-url="data\/products\.json"/);
assert.match(html, /包含缺货/);
assert.doesNotMatch(html, /id="searchInput"/);
assert.match(html, /<title>Codex 比价<\/title>/);
assert.match(html, /href="assets\/logo\.svg"/);
assert.match(html, /class="brand-logo"/);
assert.match(html, /<h1>Codex 比价<\/h1>/);
assert.match(html, /本站仅汇总公开商品信息供参考/);
assert.match(html, /不代表对任何店铺或商品质量作出背书/);
assert.match(html, /<p class="summary" id="summary">正在读取商品数据\.\.\.<\/p>/);
assert.match(html, /<footer class="page-footer content-column">/);
assert.match(html, /<p class="disclaimer">本站仅汇总公开商品信息供参考，不代表对任何店铺或商品质量作出背书<\/p>/);
assert.match(html, /<p class="copyright">&copy; jiuge\.space<\/p>/);
assert.doesNotMatch(html, /admin\.html/);
assert.match(html, /href="sources\.html"/);
assert.match(html, /店铺列表/);
assert.match(html, /id="shareButton"/);
assert.match(html, /aria-label="生成分享截图"/);
assert.match(html, /id="shareOverlay"/);
assert.match(html, /id="shareImage"[\s\S]*<img/);
assert.match(html, /id="shareToast"/);
assert.match(html, /aria-live="polite"/);
assert.match(html, /正在生成分享图片/);
assert.match(html, /id="themeToggle"/);
assert.match(html, /class="theme-toggle icon-button"/);
assert.match(html, /class="theme-icon theme-icon-sun"/);
assert.match(html, /class="theme-icon theme-icon-moon"/);
assert.doesNotMatch(html, /theme-toggle-track/);
assert.doesNotMatch(html, /theme-toggle-thumb/);
assert.match(html, /src="theme\.js"/);
assert.match(html, /src="assets\/qrcode-generator\.js"/);
assert.doesNotMatch(html, /有货优先/);
assert.doesNotMatch(html, /value="stock"/);
assert.doesNotMatch(html, /data-category=/);
assert.doesNotMatch(html, /一级分类/);
assert.doesNotMatch(html, /仅Plus/);
assert.doesNotMatch(html, /一级标签/);
assert.doesNotMatch(html, /二级标签/);
assert.doesNotMatch(html, /显示设置/);
assert.match(html, /id="sortButton"/);
assert.match(html, /价格升序/);
assert.match(html, /data-subtype="free" aria-pressed="false">Free/);
assert.match(html, /data-subtype="plus" aria-pressed="true">Plus/);
assert.match(html, /data-subtype="pro" aria-pressed="false">Pro/);
assert.match(html, /data-subtype="codex_sms" aria-pressed="false">SMS/);
assert.doesNotMatch(html, /value="unknown"/);
assert.doesNotMatch(html, /命中/);
assert.match(html, /<p class="empty-state content-column" id="emptyState" hidden>没有匹配的商品。<\/p>/);
assert.match(html, /id="backToTop"/);
assert.match(app, /sortProducts/);
assert.match(app, /backToTop/);
assert.match(app, /shareButton/);
assert.match(app, /shareToast/);
assert.match(app, /let shareToastFrame = 0;/);
assert.match(app, /let shareToastTimer = 0;/);
assert.match(app, /function showShareToast/);
assert.match(app, /function hideShareToast/);
assert.match(app, /cancelAnimationFrame\(shareToastFrame\)/);
assert.match(app, /clearTimeout\(shareToastTimer\)/);
assert.match(app, /createShareSnapshotImage/);
assert.match(app, /function lockShareImageSize/);
assert.match(app, /shareImage\.style\.width = `\$\{width\}px`/);
assert.match(app, /shareImage\.style\.height = `\$\{height\}px`/);
assert.match(app, /function readStateFromUrl/);
assert.match(app, /function writeStateToUrl/);
assert.match(app, /function createShareUrl/);
assert.match(app, /function createQrImage/);
assert.match(app, /qrcode/);
assert.match(app, /createShareUrl\(\)/);
assert.doesNotMatch(app, /loadImage\("assets\/share-qr\.png"\)/);
assert.doesNotMatch(app, /share-logo\.png/);
assert.doesNotMatch(app, /loadImage\("assets\/logo\.svg"\)/);
assert.doesNotMatch(app, /ctx\.drawImage\(logo/);
assert.match(app, /const SHARE_VISIBLE_ITEMS = 5;/);
assert.match(app, /另有 \$\{items\.length - SHARE_VISIBLE_ITEMS\} 条商品可以查看/);
assert.match(app, /const moreRowHeight = 48;/);
assert.match(app, /fillRoundRect\(ctx, rowX, 550, rowWidth, moreRowHeight, 8, panel, line\)/);
assert.match(app, /canvas\.toDataURL\("image\/png"\)/);
assert.doesNotMatch(app, /qrserver\.com/);
assert.match(app, /shareOverlay\.addEventListener\("click"/);
assert.doesNotMatch(app, /image\.alt = "正在生成分享截图"/);
assert.doesNotMatch(app, /stats\.textContent \|\| summary\.textContent/);
assert.match(app, /scrollTo/);
assert.match(app, /DATA_RELOAD_INTERVAL_MS/);
assert.match(app, /setInterval\(loadData/);
assert.match(app, /price-asc/);
assert.doesNotMatch(app, /sortSelect\.value === "stock"/);
assert.doesNotMatch(app, /sortSelect/);
assert.match(app, /card\.append\(title, source, stock, price\)/);
assert.match(app, /function triggerFilterAnimation/);
assert.match(app, /render\(\{ animate: true \}\)/);
assert.match(app, /currentSubtype = "plus"/);
assert.match(app, /syncSubtypeButtons/);
assert.match(app, /syncSortButton/);
assert.doesNotMatch(app, /selectedSubtypes/);
assert.doesNotMatch(app, /setSubtypeSelection/);
assert.doesNotMatch(app, /hasExactSubtypeSelection/);
assert.match(app, /visibleSubtypeValues/);
assert.match(app, /MAX_VISIBLE_PRICE/);
assert.match(app, /item\.price >= MAX_VISIBLE_PRICE/);
assert.doesNotMatch(app, /themeToggle/);
assert.match(themeApp, /themeToggle/);
assert.match(themeApp, /localStorage\.setItem\("color-theme"/);
assert.match(themeApp, /document\.body\.dataset\.theme/);
assert.equal(packageJson.scripts.start, "node server.mjs");
assert.match(server, /const PORT = 49173;/);
assert.match(server, /const ADMIN_PORT = 49174;/);
assert.match(server, /\.svg": "image\/svg\+xml; charset=utf-8"/);
assert.match(server, /request\.method !== "GET" && request\.method !== "HEAD"/);
assert.match(server, /createStaticServer\("index\.html"/);
assert.match(server, /createStaticServer\("admin\.html"/);
assert.match(server, /function isAdminStaticPath/);
assert.match(server, /!isAdminStaticPath\(pathname\)/);
assert.match(server, /POST/);
assert.match(server, /knownAdapters/);
assert.match(server, /DEFAULT_REFRESH_INTERVAL_MS/);
assert.match(server, /scheduleNextRefresh/);
assert.match(server, /nextRefreshAt/);
assert.match(server, /refreshSettingsPath/);
assert.match(server, /handleRefreshStatus/);
assert.match(server, /handleRefreshNow/);
assert.match(server, /handleRefreshSettings/);
assert.match(server, /\/api\/refresh/);
assert.match(server, /\/api\/refresh-settings/);
assert.match(server, /GMT\+8/);
assert.match(server, /function formatGmt8Timestamp/);
assert.match(server, /function logWithTimestamp/);
assert.match(server, /logWithTimestamp\("log", `自动刷新完成/);
assert.match(server, /logWithTimestamp\("log", `手动刷新完成/);
assert.match(server, /logWithTimestamp\("error", `刷新状态写入失败/);
const styles = await readFile(new URL("styles.css", root), "utf8");
assert.match(styles, /--content-width: 780px;/);
assert.match(styles, /\.content-column/);
assert.match(styles, /\.filter-panel/);
assert.match(styles, /\.filter-actions/);
assert.match(styles, /grid-template-columns: minmax\(0, 1fr\) auto auto auto;/);
assert.match(styles, /white-space: nowrap;/);
assert.match(styles, /text-overflow: ellipsis;/);
assert.match(styles, /\.page-shell \{\n  width: min\(1180px, calc\(100% - 32px\)\);\n  margin: 0 auto;\n  padding: 36px 0 80px;/);
assert.match(styles, /\.page-header \{\n  padding: 12px 0 18px;/);
assert.match(styles, /\.disclaimer/);
assert.match(styles, /\.page-footer/);
assert.match(styles, /\.copyright/);
assert.match(styles, /\.toolbar \{\n  margin: 8px 0 18px;/);
assert.match(styles, /\.filter-panel \{\n  display: grid;\n  gap: 8px;/);
assert.match(styles, /\.filter-actions \{\n  justify-self: end;/);
assert.match(styles, /\.toolbar-row/);
assert.match(styles, /\.toolbar-link/);
assert.match(styles, /\[data-theme="dark"\]/);
assert.match(styles, /\.theme-toggle/);
assert.match(styles, /\.theme-icon/);
assert.match(styles, /\.theme-icon-moon/);
assert.doesNotMatch(styles, /\.theme-toggle-track/);
assert.doesNotMatch(styles, /\.theme-toggle-thumb/);
assert.match(styles, /\.brand-logo/);
assert.match(styles, /\.back-to-top/);
assert.match(styles, /\.share-overlay/);
assert.match(styles, /\.share-overlay\.is-visible/);
assert.match(styles, /\.share-image img/);
assert.match(styles, /\.share-toast/);
assert.match(styles, /\.share-toast\.is-visible/);
assert.match(styles, /\.share-overlay \{[\s\S]*z-index: 80;/);
assert.match(styles, /\.share-toast \{[\s\S]*z-index: 70;/);
assert.match(styles, /backdrop-filter: blur\(18px\)/);
assert.match(styles, /padding: 14px 22px;/);
assert.match(styles, /background: color-mix\(in srgb, var\(--panel\) 76%, transparent\)/);
assert.match(styles, /transform: translate\(-50%, -50%\)/);
assert.match(styles, /object-fit: contain;/);
assert.match(styles, /\.back-to-top\.is-visible/);
assert.match(styles, /\.product-list\.is-filtering \.product-card/);
assert.match(styles, /@keyframes filter-card-in/);
assert.match(styles, /\.product-list \{\n  display: grid;\n  grid-template-columns: 1fr;\n  gap: 10px;/);
assert.match(styles, /padding: 10px 12px;/);
assert.match(sourcesHtml, /店铺列表/);
assert.match(sourcesHtml, /href="assets\/logo\.svg"/);
assert.match(sourcesHtml, /class="header-actions"/);
assert.match(sourcesHtml, /返回/);
assert.doesNotMatch(sourcesHtml, /返回商品页/);
assert.doesNotMatch(sourcesHtml, /返回主页/);
assert.match(sourcesHtml, /href="index\.html"/);
assert.match(sourcesHtml, /data-sources-url="data\/sources\.json"/);
assert.match(sourcesHtml, /id="sourceLinks"/);
assert.match(sourcesHtml, /id="sourceLinks"[\s\S]*<footer class="page-footer content-column">[\s\S]*<p class="disclaimer">本站仅陈列数据源中的店铺链接，方便核对原始商品页面<\/p>[\s\S]*<p class="copyright">&copy; jiuge\.space<\/p>/);
assert.match(sourcesHtml, /src="theme\.js"/);
assert.match(sourcesApp, /fetch\(sourcesUrl/);
assert.match(sourcesApp, /source-link-card/);
assert.match(adminHtml, /后台管理/);
assert.match(adminHtml, /href="assets\/logo\.svg"/);
assert.match(adminHtml, /class="brand-logo"/);
assert.match(adminHtml, /class="admin-header-inner"/);
assert.match(adminHtml, /class="header-actions"/);
assert.match(adminHtml, /class="toolbar-link source-back-link" href="http:\/\/127\.0\.0\.1:49173\/">返回<\/a>/);
assert.match(adminHtml, /href="http:\/\/127\.0\.0\.1:49173\/"/);
assert.doesNotMatch(adminHtml, /href="index\.html"/);
assert.doesNotMatch(adminHtml, /返回商品页/);
assert.match(adminHtml, /id="refreshForm"/);
assert.match(adminHtml, /id="refreshIntervalMinutes"/);
assert.match(adminHtml, /id="refreshNow"/);
assert.match(adminHtml, /id="refreshStatus"/);
assert.match(adminHtml, /价格\/库存变动通知/);
assert.match(adminHtml, /id="stockWatchForm"/);
assert.match(adminHtml, /id="stockWatchUrl"/);
assert.match(adminHtml, /id="stockWatchList"/);
assert.match(adminHtml, /id="sourceList"/);
assert.match(adminApp, /coreSourceUrl/);
assert.match(adminApp, /核心/);
assert.match(adminApp, /source\.adapter === "ldxp"/);
assert.match(server, /PATCH/);
assert.match(server, /handleSourceUpdate/);
assert.match(server, /core/);
assert.doesNotMatch(adminHtml, /id="unknownProductList"/);
assert.doesNotMatch(adminHtml, /id="sourceForm"/);
assert.doesNotMatch(adminHtml, /导入新店铺/);
assert.doesNotMatch(adminApp, /detectAdapter/);
assert.match(adminApp, /unknown/);
assert.match(adminApp, /unknownProductsForSource/);
assert.match(adminApp, /createProductRow/);
assert.match(adminApp, /matchReasons/);
assert.match(adminApp, /metaUrl/);
assert.match(adminApp, /nextRefreshAt/);
assert.match(adminApp, /refreshStatusUrl/);
assert.match(adminApp, /refreshSettingsUrl/);
assert.match(adminApp, /refreshNowUrl/);
assert.match(adminApp, /stockWatchUrlApi/);
assert.match(adminApp, /查找商品/);
assert.match(adminApp, /加入观察区/);
assert.match(adminApp, /lastPrice/);
assert.match(adminApp, /测试通知/);
assert.match(adminApp, /移出观察区/);
assert.match(adminApp, /renderRefreshStatus/);
assert.match(adminApp, /refreshForm/);
assert.match(adminApp, /refreshNow/);
assert.match(adminApp, /DATA_RELOAD_INTERVAL_MS/);
assert.match(adminApp, /setInterval\(loadAdminData/);
assert.match(adminApp, /下次刷新/);
assert.match(adminApp, /MAX_VISIBLE_PRICE/);
assert.match(adminApp, /item\.price >= MAX_VISIBLE_PRICE/);
assert.match(server, /\/api\/stock-watch/);
assert.match(server, /handleStockWatchAdd/);
assert.match(server, /handleStockWatchTest/);
assert.match(server, /WEIXIN_GATEWAY_ALERT_URL/);
assert.match(styles, /\.source-products/);
assert.match(styles, /\.stock-watch-panel/);
assert.match(styles, /\.stock-watch-list/);
assert.match(styles, /\.stock-watch-row/);
assert.match(styles, /\.source-card-empty/);
assert.match(styles, /\.match-reasons/);
