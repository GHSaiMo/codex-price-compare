import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const html = await readFile(new URL("index.html", root), "utf8");
const app = await readFile(new URL("app.js", root), "utf8");
const themeApp = await readFile(new URL("theme.js", root), "utf8");
const adminHtml = await readFile(new URL("admin.html", root), "utf8");
const adminApp = await readFile(new URL("admin.js", root), "utf8");
const sourcesHtml = await readFile(new URL("sources.html", root), "utf8");
const sourcesApp = await readFile(new URL("sources.js", root), "utf8");
const sourceSortApp = await readFile(new URL("source-sort.js", root), "utf8");
const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const server = await readFile(new URL("server.mjs", root), "utf8");
const styles = await readFile(new URL("styles.css", root), "utf8");

assert.match(html, /data-products-url="data\/products\.json"/);
assert.match(html, /包含缺货/);
assert.match(html, /class="toolbar-row toolbar-row-search" hidden/);
assert.match(html, /id="searchInput"/);
assert.match(html, /id="shopFilter"/);
assert.match(html, /搜索标题或店铺/);
assert.match(html, /Codex 比价/);
assert.match(html, /id="documentTitle"/);
assert.match(html, /href="assets\/logo\.svg"/);
assert.match(html, /class="brand-logo"/);
assert.match(html, /id="pageTitle"/);
assert.match(html, /<h1 id="pageTitle">Codex 比价<\/h1>/);
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
assert.match(html, /src="theme\.js/);
assert.match(html, /src="assets\/qrcode-generator\.js/);
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
assert.match(html, /data-mode="codex" aria-pressed="true">Codex/);
assert.match(html, /data-mode="grok" aria-pressed="false">Grok/);
assert.match(html, /data-mode="gemini" aria-pressed="false">Gemini/);
assert.match(html, /id="subtypeGroup"/);
assert.match(html, /data-subtype="free" aria-pressed="false">Free/);
assert.doesNotMatch(html, /data-subtype="go"/);
assert.doesNotMatch(html, />Go</);
assert.match(html, /data-subtype="plus" aria-pressed="true">Plus/);
assert.match(html, /data-subtype="pro_5x" aria-pressed="false">5x/);
assert.match(html, /data-subtype="pro_20x" aria-pressed="false">20x/);
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
assert.match(app, /isIndexDomain/);
assert.match(app, /function writeStateToUrl/);
assert.match(app, /function createShareUrl/);
assert.match(app, /urlStateKeys/);
assert.match(app, /searchInput/);
assert.match(app, /shopFilter/);
assert.match(app, /function matchesSearch/);
assert.doesNotMatch(app, /\{ id: "go", label: "Go" \}/);
assert.match(app, /\["go", "free"\]/);
assert.match(app, /modeConfigs/);
assert.match(app, /currentMode/);
assert.match(app, /m1/);
assert.match(app, /m3/);
assert.match(app, /y1/);
assert.match(app, /1M/);
assert.match(app, /defaultSubtype: "m1"/);
assert.match(app, /defaultSubtype: "m18"/);
assert.match(app, /id: "gemini"/);
assert.match(app, /Others/);
assert.match(app, /切换品牌时回到该模式默认标签/);
assert.match(app, /\["sms", "codex_sms"\]/);
assert.match(app, /function subtypeForUrl/);
assert.match(app, /plus_ready/);
assert.match(app, /plus_trial/);
assert.match(app, /plus_topup/);
assert.match(app, /pro_5x/);
assert.match(app, /pro_20x/);
assert.match(app, /\["m1", "m1"\]/);
assert.match(app, /function createQrImage/);
assert.match(app, /qrcode/);
assert.match(app, /createShareUrl\(\)/);
assert.doesNotMatch(app, /loadImage\("assets\/share-qr\.png"\)/);
assert.doesNotMatch(app, /share-logo\.png/);
assert.doesNotMatch(app, /loadImage\("assets\/logo\.svg"\)/);
assert.doesNotMatch(app, /ctx\.drawImage\(logo/);
assert.match(app, /const SHARE_VISIBLE_ITEMS = 5;/);
assert.match(app, /function getShareImageHeight/);
assert.match(app, /const SHARE_IMAGE_MAX_HEIGHT = 844;/);
assert.match(app, /另有 \$\{items\.length - SHARE_VISIBLE_ITEMS\} 条商品可以查看/);
assert.match(app, /const SHARE_MORE_ROW_HEIGHT = 48;/);
assert.match(app, /fillRoundRect\(ctx, SHARE_ROW_X, moreRowY, SHARE_ROW_WIDTH, SHARE_MORE_ROW_HEIGHT, 8, panel, line\)/);
assert.match(app, /return \{ dataUrl: canvas\.toDataURL\("image\/png"\), height: imageHeight \};/);
assert.match(app, /lockShareImageSize\(snapshot\.height\)/);
assert.match(app, /lockShareImageSize\(getShareImageHeight\(previewItemCount\)\)/);
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
assert.match(app, /function groupProducts/);
assert.match(app, /function compareGroupItems/);
assert.match(app, /function normalizeGroupKey/);
assert.match(app, /function createGroupedProductElement/);
assert.match(app, /uniqueShops/);
assert.match(app, /expandedGroupKeys/);
assert.match(app, /source-pill-toggle/);
assert.match(app, /product-group-children/);
{
  const createElem = () => ({
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    appendChild() {},
    append() {},
    setAttribute() {},
    removeAttribute() {},
    addEventListener() {},
    querySelectorAll: () => [],
  });
  const sandbox = {
    document: {
      querySelector: () => createElem(),
      querySelectorAll: () => [],
      createElement: () => createElem(),
      createElementNS: () => createElem(),
      body: { dataset: {}, classList: { add() {}, remove() {} } },
    },
    window: { addEventListener() {}, location: { search: "", href: "http://localhost/" }, history: { replaceState() {} } },
    URL,
    URLSearchParams,
    fetch: () => Promise.resolve(),
    setInterval: () => {},
    clearTimeout: () => {},
    cancelAnimationFrame: () => {},
    requestAnimationFrame: () => {},
  };
  vm.createContext(sandbox);
  vm.runInContext(app, sandbox);

  assert.equal(sandbox.normalizeGroupKey("【请看店铺公告】ChatGPT Plus 20x"), "ChatGPT Plus 20x");
  assert.equal(sandbox.normalizeGroupKey("ChatGPT Plus 20x"), "ChatGPT Plus 20x");

  const mockItems = [
    { title: "ChatGPT Plus", price: 150, sourceName: "Shop B", stockStatus: "in_stock" },
    { title: "ChatGPT Plus", price: 120, sourceName: "Shop A", stockStatus: "in_stock" },
    { title: "ChatGPT Plus", price: 180, sourceName: "Shop C", stockStatus: "in_stock" },
    { title: "Grok 2.0", price: 40, sourceName: "Shop D", stockStatus: "in_stock" },
    { title: "Grok 2.0", price: 30, sourceName: "Shop E", stockStatus: "in_stock" },
  ];

  // 升序测试：同款折叠为一组，最便宜的作为母商品，展开后升序排列
  vm.runInContext('currentSort = "price-asc"', sandbox);
  const groupsAsc = sandbox.groupProducts(sandbox.sortProducts(mockItems));
  assert.equal(groupsAsc.length, 2);
  assert.equal(groupsAsc[0].primary.title, "Grok 2.0");
  assert.equal(groupsAsc[0].primary.price, 30);
  assert.deepEqual(JSON.parse(JSON.stringify(groupsAsc[0].items.map((i) => i.price))), [30, 40]);
  assert.equal(groupsAsc[1].primary.title, "ChatGPT Plus");
  assert.equal(groupsAsc[1].primary.price, 120);
  assert.deepEqual(JSON.parse(JSON.stringify(groupsAsc[1].items.map((i) => i.price))), [120, 150, 180]);

  // 降序测试：同款折叠为一组，最贵的作为母商品，展开后降序排列
  vm.runInContext('currentSort = "price-desc"', sandbox);
  const groupsDesc = sandbox.groupProducts(sandbox.sortProducts(mockItems));
  assert.equal(groupsDesc.length, 2);
  assert.equal(groupsDesc[0].primary.title, "ChatGPT Plus");
  assert.equal(groupsDesc[0].primary.price, 180);
  assert.deepEqual(JSON.parse(JSON.stringify(groupsDesc[0].items.map((i) => i.price))), [180, 150, 120]);
  assert.equal(groupsDesc[1].primary.title, "Grok 2.0");
  assert.equal(groupsDesc[1].primary.price, 40);
  assert.deepEqual(JSON.parse(JSON.stringify(groupsDesc[1].items.map((i) => i.price))), [40, 30]);

  // 链接回退测试：母站根域名自动回退到店铺链接
  assert.equal(
    sandbox.resolveProductUrl({ url: "https://pay.ldxp.cn", sourceUrl: "https://pay.ldxp.cn/shop/test" }),
    "https://pay.ldxp.cn/shop/test",
  );
  assert.equal(
    sandbox.resolveProductUrl({ url: "https://pay.ldxp.cn/", sourceUrl: "https://pay.ldxp.cn/shop/test" }),
    "https://pay.ldxp.cn/shop/test",
  );
  assert.equal(
    sandbox.resolveProductUrl({ url: "https://pay.ldxp.cn/item/abc", sourceUrl: "https://pay.ldxp.cn/shop/test" }),
    "https://pay.ldxp.cn/item/abc",
  );
}
assert.match(app, /function triggerFilterAnimation/);
assert.match(app, /render\(\{ animate: true \}\)/);
assert.match(app, /defaultSubtype: "plus"/);
assert.match(app, /currentSubtype = modeConfigs.codex.defaultSubtype/);
assert.match(app, /syncSubtypeButtons/);
assert.match(app, /syncSortButton/);
assert.doesNotMatch(app, /selectedSubtypes/);
assert.doesNotMatch(app, /setSubtypeSelection/);
assert.doesNotMatch(app, /hasExactSubtypeSelection/);
assert.match(app, /currentSubtypeValues/);
assert.match(app, /MAX_VISIBLE_PRICE/);
assert.match(app, /item\.price >= MAX_VISIBLE_PRICE/);
assert.match(app, /function updateSummary/);
assert.match(app, /function isSummaryOverflowing/);
assert.match(app, /共 \$\{allProducts\.length\} 条商品。最近刷新：/);
assert.match(app, /if \(isSummaryOverflowing\(\)\) summary\.textContent = compact;/);
assert.match(app, /window\.addEventListener\(\s*\"resize\"/);
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
assert.match(server, /isPublicStaticPath/);
assert.match(server, /toPublicProductsDocument/);
assert.match(server, /toPublicMeta/);
assert.match(server, /!allowApi && !isPublicStaticPath/);
assert.match(server, /"\/source-sort\.js"/);
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
assert.match(server, /summarizeHistory/);
assert.match(server, /price-history\.json/);
assert.match(server, /"cache-control": "no-cache"/);
assert.match(styles, /--content-width: 780px;/);
assert.match(styles, /\.content-column/);
assert.match(styles, /\.filter-panel/);
assert.match(styles, /\.filter-actions/);
assert.match(styles, /\.page-shell/);
assert.match(styles, /\.page-header/);
assert.match(styles, /\.disclaimer/);
assert.match(styles, /\.page-footer/);
assert.match(styles, /\.copyright/);
assert.match(styles, /\.toolbar/);
assert.match(styles, /\.toolbar-row/);
assert.match(styles, /\.toolbar-link/);
assert.match(styles, /\[data-theme="dark"\]/);
assert.match(styles, /\.theme-toggle/);
assert.match(styles, /\.theme-icon/);
assert.match(styles, /\.theme-icon-moon/);
assert.doesNotMatch(styles, /\.theme-toggle-track/);
assert.doesNotMatch(styles, /\.theme-toggle-thumb/);
assert.match(styles, /\.brand-logo/);
assert.match(styles, /\.title-row > h1/);
assert.match(styles, /\.back-to-top/);
assert.match(styles, /\.share-overlay/);
assert.match(styles, /\.share-overlay\.is-visible/);
assert.match(styles, /\.share-image img/);
assert.match(styles, /\.share-toast/);
assert.match(styles, /\.share-toast\.is-visible/);
assert.match(styles, /\.back-to-top\.is-visible/);
assert.match(styles, /\.product-list\.is-filtering \.product-card/);
assert.match(styles, /@keyframes filter-card-in/);
assert.match(styles, /\.product-list/);
assert.match(styles, /\.source-pill-toggle/);
assert.match(styles, /\.product-group/);
assert.match(styles, /\.product-group-children/);
assert.match(styles, /\.product-card-child/);
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
assert.match(sourcesHtml, /src="theme\.js/);
assert.match(sourcesHtml, /src="source-sort\.js/);
assert.match(sourcesApp, /fetch\(sourcesUrl/);
assert.match(sourcesApp, /source-link-card/);
assert.match(sourcesApp, /sortSources\(/);
assert.match(sourceSortApp, /function sortSources/);
assert.match(sourceSortApp, /adapterOrder/);
assert.match(sourceSortApp, /compareSourceNames/);
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
assert.match(adminHtml, /价格库存观察/);
assert.match(adminHtml, /id="stockWatchForm"/);
assert.match(adminHtml, /id="stockWatchUrl"/);
assert.match(adminHtml, /id="stockWatchTarget"/);
assert.match(adminHtml, /id="stockWatchDigest"/);
assert.match(adminHtml, /每日摘要/);
assert.match(adminHtml, /id="stockWatchList"/);
assert.match(adminHtml, /id="sourceList"/);
assert.match(adminHtml, /src="source-sort\.js/);
assert.match(adminApp, /coreSourceUrl/);
assert.match(adminApp, /核心/);
assert.match(adminApp, /source\.adapter === "ldxp"/);
assert.match(adminApp, /sortSources\(Array\.isArray\(sourcesData\.sources\)/);
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
assert.match(adminApp, /sourceHealth/);
assert.match(adminApp, /本轮抓取/);
assert.match(adminApp, /createHistorySparkline/);
assert.match(adminApp, /watch-history/);
assert.match(adminApp, /14日/);
assert.match(adminApp, /已停用/);
assert.match(adminApp, /disabledReason/);
assert.match(adminApp, /每日摘要/);
assert.match(adminApp, /targetPrice/);
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
assert.match(server, /sendWeChatBridgeText/);
assert.doesNotMatch(server, /WEIXIN_GATEWAY_ALERT/);
assert.match(styles, /\.source-products/);
assert.match(styles, /\.search-field/);
assert.match(styles, /\.source-health/);
assert.match(styles, /\.watch-history/);
assert.match(styles, /\.watch-sparkline/);
assert.match(styles, /\.stock-watch-list/);
assert.match(styles, /\.stock-watch-row/);
assert.match(styles, /\.source-card-empty/);
assert.match(styles, /\.match-reasons/);
