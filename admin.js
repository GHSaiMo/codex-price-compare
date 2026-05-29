const sourceList = document.querySelector("#sourceList");
const adminSummary = document.querySelector("#adminSummary");
const refreshForm = document.querySelector("#refreshForm");
const refreshIntervalMinutes = document.querySelector("#refreshIntervalMinutes");
const refreshNow = document.querySelector("#refreshNow");
const refreshStatus = document.querySelector("#refreshStatus");
const stockWatchForm = document.querySelector("#stockWatchForm");
const stockWatchUrl = document.querySelector("#stockWatchUrl");
const stockWatchStatus = document.querySelector("#stockWatchStatus");
const stockWatchList = document.querySelector("#stockWatchList");

const productsUrl = document.body.dataset.productsUrl || "data/products.json";
const sourcesUrl = document.body.dataset.sourcesUrl || "data/sources.json";
const metaUrl = document.body.dataset.metaUrl || "data/meta.json";
const refreshStatusUrl = "/api/refresh";
const refreshSettingsUrl = "/api/refresh-settings";
const refreshNowUrl = "/api/refresh";
const stockWatchUrlApi = "/api/stock-watch";
const DATA_RELOAD_INTERVAL_MS = 60 * 1000;
const MAX_VISIBLE_PRICE = 2000;

let products = [];
let sources = [];
let meta = {};
let stockWatchItems = [];

function clearElement(element) {
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}

function unknownProductsForSource(sourceId) {
  return products.filter((item) => item.sourceId === sourceId && item.subtype === "unknown");
}

function visibleProducts(items) {
  return items.filter((item) => !(typeof item.price === "number" && item.price >= MAX_VISIBLE_PRICE));
}

function displayMatchReasons(item) {
  return Array.isArray(item.matchReasons) && item.matchReasons.length > 0
    ? item.matchReasons.join("；")
    : "无命中关键词";
}

function stockLabel(item) {
  const status = item?.stockStatus || "unknown";
  if (status === "out_of_stock") return "缺货";
  if (status === "low_stock") return item.stockCount == null ? "低库存" : `低库存 ${item.stockCount}`;
  if (status === "in_stock") return item.stockCount == null ? "有货" : `库存 ${item.stockCount}`;
  return "库存未知";
}

function createProductRow(item) {
  const row = document.createElement("a");
  row.className = "admin-product-row is-unknown";
  row.href = item.url;
  row.target = "_blank";
  row.rel = "noopener noreferrer";

  const title = document.createElement("span");
  title.className = "admin-product-title";
  title.textContent = item.title;

  const category = document.createElement("span");
  category.className = "count-pill";
  category.textContent = item.sourceCategory || "未分类";

  const price = document.createElement("span");
  price.className = "admin-product-price";
  price.textContent = typeof item.price === "number" ? `¥${item.price}` : "价格未知";

  const reasons = document.createElement("span");
  reasons.className = "match-reasons";
  reasons.textContent = displayMatchReasons(item);

  row.append(title, category, price, reasons);
  return row;
}

function createEmptyRow() {
  const empty = document.createElement("p");
  empty.className = "source-card-empty";
  empty.textContent = "暂无 unknown 商品。";
  return empty;
}

function renderSources() {
  clearElement(sourceList);
  const lastRefresh = meta.generatedAt ? new Date(meta.generatedAt).toLocaleString("zh-CN") : "尚未刷新";
  const nextRefreshAt = meta.nextRefreshAt ? new Date(meta.nextRefreshAt).toLocaleString("zh-CN") : "等待服务端调度";
  const unknownCount = products.filter((item) => item.subtype === "unknown").length;
  adminSummary.textContent = `共 ${sources.length} 个店铺，${unknownCount} 条 unknown 商品。最近刷新：${lastRefresh}；下次刷新：${nextRefreshAt}`;

  for (const source of sources) {
    const unknownProducts = unknownProductsForSource(source.id);
    const card = document.createElement("article");
    card.className = "source-card";

    const header = document.createElement("div");
    header.className = "source-card-header";

    const name = document.createElement("strong");
    name.textContent = source.name;

    const adapter = document.createElement("span");
    adapter.className = "adapter-pill";
    adapter.textContent = source.adapter;

    const count = document.createElement("span");
    count.className = "count-pill";
    count.textContent = `unknown: ${unknownProducts.length}`;

    const productRows = document.createElement("div");
    productRows.className = "source-products";
    if (unknownProducts.length === 0) {
      productRows.appendChild(createEmptyRow());
    } else {
      for (const item of unknownProducts) {
        productRows.appendChild(createProductRow(item));
      }
    }

    header.append(name, adapter, count);
    card.append(header, productRows);
    sourceList.appendChild(card);
  }
}

function renderStockWatch() {
  clearElement(stockWatchList);
  if (stockWatchItems.length === 0) {
    const empty = document.createElement("p");
    empty.className = "source-card-empty";
    empty.textContent = "暂无关注商品。";
    stockWatchList.appendChild(empty);
    return;
  }

  for (const entry of stockWatchItems) {
    const current = entry.current || {};
    const row = document.createElement("article");
    row.className = "stock-watch-row";

    const main = document.createElement("div");
    main.className = "stock-watch-main";

    const title = document.createElement("a");
    title.className = "admin-product-title";
    title.href = current.url || entry.url;
    title.target = "_blank";
    title.rel = "noopener noreferrer";
    title.textContent = current.title || entry.title;

    const metaLine = document.createElement("span");
    metaLine.className = "match-reasons";
    metaLine.textContent = `${current.sourceName || entry.sourceName || "未知来源"} · ${entry.productId}`;

    main.append(title, metaLine);

    const stock = document.createElement("span");
    stock.className = `stock-pill stock-${current.stockStatus || entry.lastStockStatus || "unknown"}`;
    stock.textContent = stockLabel(current.stockStatus ? current : {
      stockStatus: entry.lastStockStatus,
      stockCount: entry.lastStockCount,
    });

    const notify = document.createElement("span");
    notify.className = "count-pill";
    notify.textContent = entry.lastNotifyStatus === "sent"
      ? `已通知 ${formatTime(entry.lastNotifiedAt)}`
      : entry.lastNotifyStatus === "failed"
        ? "通知失败"
        : "未通知";

    const actions = document.createElement("div");
    actions.className = "stock-watch-actions";

    const test = document.createElement("button");
    test.className = "toolbar-link";
    test.type = "button";
    test.textContent = "测试通知";
    test.addEventListener("click", () => testStockWatch(entry.productId, test));

    const remove = document.createElement("button");
    remove.className = "toolbar-link";
    remove.type = "button";
    remove.textContent = "取消关注";
    remove.addEventListener("click", () => removeStockWatch(entry.productId, remove));

    actions.append(test, remove);
    row.append(main, stock, notify, actions);
    stockWatchList.appendChild(row);
  }
}

function formatTime(value) {
  return value ? new Date(value).toLocaleString("zh-CN") : "等待服务端调度";
}

function renderRefreshStatus(status) {
  if (!status || typeof status !== "object") return;
  refreshIntervalMinutes.value = status.intervalMinutes || "";
  refreshStatus.textContent = `刷新间隔：${status.intervalMinutes || "未知"} 分钟；下次刷新：${formatTime(status.nextRefreshAt)}${status.refreshInProgress ? "；正在刷新" : ""}。`;
}

async function loadRefreshStatus() {
  const response = await fetch(refreshStatusUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`refresh HTTP ${response.status}`);
  renderRefreshStatus(await response.json());
}

async function loadAdminData() {
  try {
    const [productsResponse, sourcesResponse, metaResponse, refreshResponse, stockWatchResponse] = await Promise.all([
      fetch(productsUrl, { cache: "no-store" }),
      fetch(sourcesUrl, { cache: "no-store" }),
      fetch(metaUrl, { cache: "no-store" }),
      fetch(refreshStatusUrl, { cache: "no-store" }),
      fetch(stockWatchUrlApi, { cache: "no-store" }),
    ]);
    if (!productsResponse.ok) throw new Error(`products HTTP ${productsResponse.status}`);
    if (!sourcesResponse.ok) throw new Error(`sources HTTP ${sourcesResponse.status}`);
    if (!metaResponse.ok) throw new Error(`meta HTTP ${metaResponse.status}`);
    if (!refreshResponse.ok) throw new Error(`refresh HTTP ${refreshResponse.status}`);
    if (!stockWatchResponse.ok) throw new Error(`stock-watch HTTP ${stockWatchResponse.status}`);

    const productsData = await productsResponse.json();
    const sourcesData = await sourcesResponse.json();
    const metaData = await metaResponse.json();
    const refreshData = await refreshResponse.json();
    const stockWatchData = await stockWatchResponse.json();
    products = Array.isArray(productsData.items) ? visibleProducts(productsData.items) : [];
    sources = Array.isArray(sourcesData.sources) ? sourcesData.sources : [];
    meta = metaData && typeof metaData === "object" ? metaData : {};
    stockWatchItems = Array.isArray(stockWatchData.items) ? stockWatchData.items : [];
    renderRefreshStatus(refreshData);
    renderStockWatch();
    renderSources();
  } catch (error) {
    adminSummary.textContent = `读取后台数据失败：${error.message}`;
    console.error(error);
  }
}

async function addStockWatch(url) {
  const response = await fetch(stockWatchUrlApi, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || `HTTP ${response.status}`);
  return result;
}

async function removeStockWatch(productId, button) {
  button.disabled = true;
  stockWatchStatus.textContent = "正在取消关注...";
  try {
    const response = await fetch(`${stockWatchUrlApi}/${encodeURIComponent(productId)}`, { method: "DELETE" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || `HTTP ${response.status}`);
    stockWatchStatus.textContent = "已取消关注。";
    await loadAdminData();
  } catch (error) {
    stockWatchStatus.textContent = `取消失败：${error.message}`;
  } finally {
    button.disabled = false;
  }
}

async function testStockWatch(productId, button) {
  button.disabled = true;
  stockWatchStatus.textContent = "正在发送测试通知...";
  try {
    const response = await fetch(`${stockWatchUrlApi}/${encodeURIComponent(productId)}/test`, { method: "POST" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || `HTTP ${response.status}`);
    stockWatchStatus.textContent = "测试通知已发送。";
  } catch (error) {
    stockWatchStatus.textContent = `测试通知失败：${error.message}`;
  } finally {
    button.disabled = false;
  }
}

refreshForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  refreshStatus.textContent = "正在保存刷新间隔...";
  try {
    const response = await fetch(refreshSettingsUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intervalMinutes: Number(refreshIntervalMinutes.value) }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || `HTTP ${response.status}`);
    renderRefreshStatus(result);
  } catch (error) {
    refreshStatus.textContent = `保存失败：${error.message}`;
  }
});

refreshNow.addEventListener("click", async () => {
  refreshNow.disabled = true;
  refreshStatus.textContent = "正在手动刷新...";
  try {
    const response = await fetch(refreshNowUrl, { method: "POST" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || `HTTP ${response.status}`);
    renderRefreshStatus(result);
    await loadAdminData();
  } catch (error) {
    refreshStatus.textContent = `手动刷新失败：${error.message}`;
  } finally {
    refreshNow.disabled = false;
  }
});

stockWatchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  stockWatchStatus.textContent = "正在查找商品...";
  try {
    await addStockWatch(stockWatchUrl.value);
    stockWatchUrl.value = "";
    stockWatchStatus.textContent = "已匹配商品 ID 并加入关注列表。";
    await loadAdminData();
  } catch (error) {
    stockWatchStatus.textContent = `关注失败：${error.message}`;
  }
});

loadAdminData();
loadRefreshStatus().catch((error) => {
  refreshStatus.textContent = `读取刷新状态失败：${error.message}`;
});
setInterval(loadAdminData, DATA_RELOAD_INTERVAL_MS);
