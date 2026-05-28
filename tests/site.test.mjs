import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  classifyProduct,
  normalizeAcgProduct,
  normalizeDujiaoProduct,
  normalizeLdxpProduct,
  sortProductsForDisplay,
} from "../src/cleaning.mjs";

const root = new URL("../", import.meta.url);

const rules = JSON.parse(await readFile(new URL("data/rules.json", root), "utf8"));
const sources = JSON.parse(await readFile(new URL("data/sources.json", root), "utf8"));
const html = await readFile(new URL("index.html", root), "utf8");
const app = await readFile(new URL("app.js", root), "utf8");
const themeApp = await readFile(new URL("theme.js", root), "utf8");
const adminHtml = await readFile(new URL("admin.html", root), "utf8");
const adminApp = await readFile(new URL("admin.js", root), "utf8");
const sourcesHtml = await readFile(new URL("sources.html", root), "utf8");
const sourcesApp = await readFile(new URL("sources.js", root), "utf8");
const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const server = await readFile(new URL("server.mjs", root), "utf8");

assert.equal(sources.version, 1);
assert.ok(sources.sources.some((source) => source.adapter === "ldxp"));
assert.ok(sources.sources.some((source) => source.adapter === "acg"));
assert.ok(sources.sources.some((source) => source.adapter === "dujiao"));
assert.equal(sources.sources.length, 19);
assert.ok(sources.sources.some((source) => source.url === "https://pay.ldxp.cn/shop/HCJW0TDL"));
assert.ok(sources.sources.some((source) => source.url === "https://gmail91.shop/"));
assert.ok(sources.sources.some((source) => source.url === "https://ai666.dnxb.cc/"));
assert.ok(sources.sources.some((source) => source.url === "https://pay.qxvx.cn/shop/OK1"));
assert.ok(
  sources.sources.some((source) => source.url === "https://kelaode.vip/" && source.apiBase === "https://api.kelaode.vip/"),
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
  classifyProduct("Gpt Fre 🔥100个（已接码）| outlook.com | 日本", "", rules).subtype,
  "free",
);
assert.equal(
  classifyProduct("gptplus稳定cdk成品账密（需接码质保首登）", "", rules).subtype,
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

const acg = normalizeAcgProduct(
  {
    id: 51,
    name: "【试用款】CodexAPI 30刀额度 日卡",
    price: 1.68,
    stock: 56,
    category: { name: "TC中转站" },
  },
  { name: "GPT专卖-cw", url: "https://caowo.store/", adapter: "acg" },
  rules,
);
assert.equal(acg.category, "codex");
assert.equal(acg.subtype, "api");
assert.equal(acg.url, "https://caowo.store/item/51");

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
assert.match(html, /id="themeToggle"/);
assert.match(html, /class="theme-toggle-track"/);
assert.match(html, /class="theme-toggle-thumb"/);
assert.match(html, /src="theme\.js"/);
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
assert.match(styles, /\.theme-toggle-track/);
assert.match(styles, /\.theme-toggle-thumb/);
assert.match(styles, /\.brand-logo/);
assert.match(styles, /\.back-to-top/);
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
assert.match(adminHtml, /id="sourceList"/);
assert.doesNotMatch(adminHtml, /id="unknownProductList"/);
assert.doesNotMatch(adminHtml, /id="sourceForm"/);
assert.doesNotMatch(adminHtml, /导入新店铺/);
assert.doesNotMatch(adminApp, /detectAdapter/);
assert.doesNotMatch(adminApp, /api\/sources/);
assert.match(adminApp, /unknown/);
assert.match(adminApp, /unknownProductsForSource/);
assert.match(adminApp, /createProductRow/);
assert.match(adminApp, /matchReasons/);
assert.match(adminApp, /metaUrl/);
assert.match(adminApp, /nextRefreshAt/);
assert.match(adminApp, /refreshStatusUrl/);
assert.match(adminApp, /refreshSettingsUrl/);
assert.match(adminApp, /refreshNowUrl/);
assert.match(adminApp, /renderRefreshStatus/);
assert.match(adminApp, /refreshForm/);
assert.match(adminApp, /refreshNow/);
assert.match(adminApp, /DATA_RELOAD_INTERVAL_MS/);
assert.match(adminApp, /setInterval\(loadAdminData/);
assert.match(adminApp, /下次刷新/);
assert.match(styles, /\.source-products/);
assert.match(styles, /\.source-card-empty/);
assert.match(styles, /\.match-reasons/);
