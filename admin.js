const sourceList = document.querySelector("#sourceList");
const adminSummary = document.querySelector("#adminSummary");
const refreshForm = document.querySelector("#refreshForm");
const refreshIntervalMinutes = document.querySelector("#refreshIntervalMinutes");
const refreshNow = document.querySelector("#refreshNow");
const refreshStatus = document.querySelector("#refreshStatus");
const stockWatchForm = document.querySelector("#stockWatchForm");
const stockWatchUrl = document.querySelector("#stockWatchUrl");
const stockWatchTarget = document.querySelector("#stockWatchTarget");
const stockWatchDigest = document.querySelector("#stockWatchDigest");
const stockWatchStatus = document.querySelector("#stockWatchStatus");
const stockWatchList = document.querySelector("#stockWatchList");

const productsUrl = document.body.dataset.productsUrl || "data/products.json";
const sourcesUrl = document.body.dataset.sourcesUrl || "data/sources.json";
const metaUrl = document.body.dataset.metaUrl || "data/meta.json";
const refreshStatusUrl = "/api/refresh";
const refreshSettingsUrl = "/api/refresh-settings";
const refreshNowUrl = "/api/refresh";
const stockWatchUrlApi = "/api/stock-watch";
const coreSourceUrl = (sourceId) => `/api/sources/${encodeURIComponent(sourceId)}`;
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

function sourceHealth(sourceId) {
  if (Array.isArray(meta.sources)) {
    return meta.sources.find((entry) => entry.sourceId === sourceId) || null;
  }
  const skipped = (meta.ldxp?.skipped || []).find((entry) => entry.sourceId === sourceId);
  if (skipped) {
    return {
      status: String(skipped.reason || "").includes("冷却") ? "cooldown" : "skipped",
      reason: skipped.reason || null,
      ageHours: null,
    };
  }
  const error = (meta.errors || []).find((entry) => entry.sourceId === sourceId);
  if (error) {
    return { status: "failed", reason: error.message, ageHours: null };
  }
  return null;
}

function healthStatusLabel(status) {
  return {
    ok: "已刷新",
    skipped: "本轮跳过",
    cooldown: "冷却中",
    failed: "失败",
  }[status] || status || "未知";
}

function formatAgeHours(hours) {
  if (hours == null || !Number.isFinite(hours)) return "年龄未知";
  if (hours < 1) return "刚刚刷新";
  if (hours < 48) return `${Math.round(hours)} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
}

function createHistorySparkline(history) {
  const points = Array.isArray(history?.points) ? history.points.filter((point) => typeof point.p === "number") : [];
  if (points.length < 2 && history?.low == null) return null;

  const wrap = document.createElement("div");
  wrap.className = "watch-history";

  const label = document.createElement("span");
  if (typeof history?.low === "number" && typeof history?.high === "number") {
    label.textContent = `14日 ¥${history.low}–¥${history.high}`;
  } else {
    label.textContent = "暂无价格走势";
  }
  wrap.append(label);

  if (points.length >= 2) {
    const prices = points.map((point) => point.p);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const width = 120;
    const height = 28;
    const pad = 2;
    const coords = prices.map((price, index) => {
      const x = pad + (index / (prices.length - 1)) * (width - pad * 2);
      const y = max === min
        ? height / 2
        : pad + (1 - (price - min) / (max - min)) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "watch-sparkline");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    svg.setAttribute("aria-hidden", "true");
    const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    polyline.setAttribute("fill", "none");
    polyline.setAttribute("stroke", "currentColor");
    polyline.setAttribute("stroke-width", "1.5");
    polyline.setAttribute("points", coords);
    svg.append(polyline);
    wrap.append(svg);
  }
  return wrap;
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

function formatPrice(price) {
  return typeof price === "number" ? `¥${price}` : "价格未知";
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
  price.textContent = formatPrice(item.price);

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

function createCoreSourceToggle(source) {
  const label = document.createElement("label");
  label.className = "core-source-toggle";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = source.core === true;
  input.addEventListener("change", () => updateCoreSource(source.id, input.checked, input));

  const text = document.createElement("span");
  text.textContent = "核心";

  label.append(input, text);
  return label;
}

function renderSources() {
  clearElement(sourceList);
  const lastRefresh = meta.generatedAt ? new Date(meta.generatedAt).toLocaleString("zh-CN") : "尚未刷新";
  const nextRefreshAt = meta.nextRefreshAt ? new Date(meta.nextRefreshAt).toLocaleString("zh-CN") : "等待服务端调度";
  const unknownCount = products.filter((item) => item.subtype === "unknown").length;
  const attempted = meta.attemptedCount ?? meta.successCount ?? sources.length;
  const skipped = meta.skippedCount ?? meta.ldxp?.staleSourceCount ?? 0;
  const failed = meta.failureCount ?? 0;
  adminSummary.textContent = `共 ${sources.length} 个店铺，本轮抓取 ${attempted}、跳过 ${skipped}、失败 ${failed}；${unknownCount} 条 unknown。最近刷新：${lastRefresh}；下次刷新：${nextRefreshAt}`;

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

    const health = sourceHealth(source.id);
    if (source.enabled === false) {
      const status = document.createElement("span");
      status.className = "status-pill status-failed";
      status.textContent = "已停用";
      header.append(name, adapter, count, status);
    } else if (health) {
      const status = document.createElement("span");
      status.className = `status-pill status-${health.status || "skipped"}`;
      status.textContent = `${healthStatusLabel(health.status)} · ${formatAgeHours(health.ageHours)}`;
      header.append(name, adapter, count, status);
    } else {
      header.append(name, adapter, count);
    }
    if (source.adapter === "ldxp") {
      header.appendChild(createCoreSourceToggle(source));
    }

    const productRows = document.createElement("div");
    productRows.className = "source-products";
    if (unknownProducts.length === 0) {
      productRows.appendChild(createEmptyRow());
    } else {
      for (const item of unknownProducts) {
        productRows.appendChild(createProductRow(item));
      }
    }

    if (health?.reason || source.disabledReason) {
      const reason = document.createElement("p");
      reason.className = "source-health";
      reason.textContent = source.disabledReason || health.reason;
      card.append(header, reason, productRows);
    } else {
      card.append(header, productRows);
    }
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
    const missingLabel = !entry.current && entry.missingSince
      ? ` · 已消失 ${formatTime(entry.missingSince)}`
      : "";
    const targetLabel = typeof entry.targetPrice === "number" ? ` · 到价 ¥${entry.targetPrice}` : "";
    metaLine.textContent = `${current.sourceName || entry.sourceName || "未知来源"} · ${entry.productId}${targetLabel}${missingLabel}`;

    main.append(title, metaLine);
    const history = createHistorySparkline(entry.history);
    if (history) main.append(history);

    const price = document.createElement("span");
    price.className = "admin-product-price stock-watch-price";
    price.textContent = formatPrice(typeof current.price === "number" ? current.price : entry.lastPrice);

    const stock = document.createElement("span");
    const stockItem = current.stockStatus ? current : {
      stockStatus: entry.missingSince ? "missing" : entry.lastStockStatus,
      stockCount: entry.lastStockCount,
    };
    stock.className = `stock-pill stock-${stockItem.stockStatus || "unknown"}`;
    stock.textContent = entry.missingSince && !current.stockStatus ? "已消失" : stockLabel(stockItem);

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
    remove.textContent = "移出观察区";
    remove.addEventListener("click", () => removeStockWatch(entry.productId, remove));

    actions.append(test, remove);
    row.append(main, price, stock, notify, actions);
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
    sources = sortSources(Array.isArray(sourcesData.sources) ? sourcesData.sources : []);
    meta = metaData && typeof metaData === "object" ? metaData : {};
    stockWatchItems = Array.isArray(stockWatchData.items) ? stockWatchData.items : [];
    if (stockWatchDigest) stockWatchDigest.checked = stockWatchData.digestEnabled === true;
    if (stockWatchStatus && stockWatchStatus.textContent === "正在读取观察列表...") {
      stockWatchStatus.textContent = "";
    }
    renderRefreshStatus(refreshData);
    renderStockWatch();
    renderSources();
  } catch (error) {
    adminSummary.textContent = `读取后台数据失败：${error.message}`;
    if (stockWatchStatus && stockWatchStatus.textContent === "正在读取观察列表...") {
      stockWatchStatus.textContent = "读取观察列表失败。";
    }
    console.error(error);
  }
}

async function addStockWatch(url, targetPrice) {
  const payload = { url };
  if (targetPrice) payload.targetPrice = targetPrice;
  const response = await fetch(stockWatchUrlApi, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || `HTTP ${response.status}`);
  return result;
}

async function updateCoreSource(sourceId, core, input) {
  input.disabled = true;
  try {
    const response = await fetch(coreSourceUrl(sourceId), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ core }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || `HTTP ${response.status}`);
    const source = sources.find((entry) => entry.id === sourceId);
    if (source) source.core = result.source.core === true;
  } catch (error) {
    input.checked = !core;
    adminSummary.textContent = `核心店铺保存失败：${error.message}`;
  } finally {
    input.disabled = false;
  }
}

async function removeStockWatch(productId, button) {
  button.disabled = true;
  stockWatchStatus.textContent = "正在移出观察区...";
  try {
    const response = await fetch(`${stockWatchUrlApi}/${encodeURIComponent(productId)}`, { method: "DELETE" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || `HTTP ${response.status}`);
    stockWatchStatus.textContent = "已移出观察区。";
    await loadAdminData();
  } catch (error) {
    stockWatchStatus.textContent = `移出失败：${error.message}`;
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
    await addStockWatch(stockWatchUrl.value, stockWatchTarget?.value);
    stockWatchUrl.value = "";
    if (stockWatchTarget) stockWatchTarget.value = "";
    stockWatchStatus.textContent = "已匹配商品 ID 并加入观察区。";
    await loadAdminData();
  } catch (error) {
    stockWatchStatus.textContent = `关注失败：${error.message}`;
  }
});

stockWatchDigest?.addEventListener("change", async () => {
  stockWatchDigest.disabled = true;
  stockWatchStatus.textContent = "正在保存摘要设置...";
  try {
    const response = await fetch(stockWatchUrlApi, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ digestEnabled: stockWatchDigest.checked }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || `HTTP ${response.status}`);
    stockWatchStatus.textContent = result.digestEnabled ? "已开启每日摘要。" : "已关闭每日摘要。";
  } catch (error) {
    stockWatchDigest.checked = !stockWatchDigest.checked;
    stockWatchStatus.textContent = `摘要设置失败：${error.message}`;
  } finally {
    stockWatchDigest.disabled = false;
  }
});

const recSummary = document.querySelector("#recSummary");
const recFilterGroup = document.querySelector("#recFilterGroup");
const recList = document.querySelector("#recList");
const recommendationsApiUrl = "/api/recommendations";

let recommendations = [];
let activeRecFilter = "all";

async function loadRecommendations() {
  if (!recList) return;
  try {
    const res = await fetch(recommendationsApiUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    recommendations = Array.isArray(data.items) ? data.items : [];
    renderRecommendations();
  } catch (err) {
    if (recSummary) recSummary.textContent = `读取推荐失败: ${err.message}`;
  }
}

function formatRecTime(isoString) {
  if (!isoString) return "";
  try {
    const d = new Date(isoString);
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return isoString;
  }
}

function renderRecommendations() {
  if (!recList) return;
  clearElement(recList);

  const pendingCount = recommendations.filter((r) => r.status === "pending").length;
  if (recSummary) {
    recSummary.textContent = `共 ${recommendations.length} 条推荐（${pendingCount} 条待处理）`;
  }

  const filtered = recommendations.filter((r) => {
    if (activeRecFilter === "all") return true;
    return r.status === activeRecFilter;
  });

  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "rec-empty";
    empty.textContent =
      activeRecFilter === "all" ? "暂无用户推荐记录" : `暂无【${activeRecFilter}】状态的推荐`;
    recList.appendChild(empty);
    return;
  }

  filtered.forEach((rec) => {
    const card = document.createElement("article");
    card.className = "rec-item";
    card.dataset.id = rec.id;

    const top = document.createElement("div");
    top.className = "rec-item-top";

    const metaDiv = document.createElement("div");
    metaDiv.className = "rec-item-meta";

    const timeSpan = document.createElement("span");
    timeSpan.textContent = formatRecTime(rec.createdAt);
    metaDiv.appendChild(timeSpan);

    const statusPill = document.createElement("span");
    statusPill.className = `rec-status-pill rec-status-${rec.status}`;
    statusPill.textContent =
      rec.status === "pending" ? "待处理" : rec.status === "accepted" ? "已采纳" : "已忽略";
    metaDiv.appendChild(statusPill);

    if (rec.clientIp) {
      const ipSpan = document.createElement("span");
      ipSpan.textContent = `IP: ${rec.clientIp}`;
      metaDiv.appendChild(ipSpan);
    }

    const actions = document.createElement("div");
    actions.className = "rec-item-actions";

    if (rec.status !== "accepted") {
      const acceptBtn = document.createElement("button");
      acceptBtn.className = "rec-btn-action";
      acceptBtn.type = "button";
      acceptBtn.textContent = "采纳";
      acceptBtn.addEventListener("click", () => updateRecStatus(rec.id, "accepted"));
      actions.appendChild(acceptBtn);
    }

    if (rec.status !== "ignored") {
      const ignoreBtn = document.createElement("button");
      ignoreBtn.className = "rec-btn-action";
      ignoreBtn.type = "button";
      ignoreBtn.textContent = "忽略";
      ignoreBtn.addEventListener("click", () => updateRecStatus(rec.id, "ignored"));
      actions.appendChild(ignoreBtn);
    }

    if (rec.status !== "pending") {
      const resetBtn = document.createElement("button");
      resetBtn.className = "rec-btn-action";
      resetBtn.type = "button";
      resetBtn.textContent = "设为待处理";
      resetBtn.addEventListener("click", () => updateRecStatus(rec.id, "pending"));
      actions.appendChild(resetBtn);
    }

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "rec-btn-action rec-btn-delete";
    deleteBtn.type = "button";
    deleteBtn.textContent = "删除";
    deleteBtn.addEventListener("click", () => deleteRec(rec.id));
    actions.appendChild(deleteBtn);

    top.appendChild(metaDiv);
    top.appendChild(actions);
    card.appendChild(top);

    const bodyDiv = document.createElement("div");
    bodyDiv.className = "rec-item-body";

    if (rec.title) {
      const titleEl = document.createElement("h4");
      titleEl.className = "rec-item-title";
      titleEl.textContent = rec.title;
      bodyDiv.appendChild(titleEl);
    }

    const linkEl = document.createElement("a");
    linkEl.className = "rec-item-url";
    linkEl.href = rec.url;
    linkEl.target = "_blank";
    linkEl.rel = "noopener noreferrer";
    linkEl.textContent = `🔗 ${rec.url}`;
    bodyDiv.appendChild(linkEl);

    if (rec.description) {
      const descEl = document.createElement("p");
      descEl.className = "rec-item-desc";
      descEl.textContent = rec.description;
      bodyDiv.appendChild(descEl);
    }

    card.appendChild(bodyDiv);
    recList.appendChild(card);
  });
}

async function updateRecStatus(id, newStatus) {
  try {
    const res = await fetch(`${recommendationsApiUrl}/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.message || `HTTP ${res.status}`);
    const idx = recommendations.findIndex((r) => r.id === id);
    if (idx !== -1) {
      recommendations[idx] = result.item;
      renderRecommendations();
    }
  } catch (err) {
    alert(`更新状态失败: ${err.message}`);
  }
}

async function deleteRec(id) {
  if (!confirm("确定删除这条推荐记录吗？")) return;
  try {
    const res = await fetch(`${recommendationsApiUrl}/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.message || `HTTP ${res.status}`);
    recommendations = recommendations.filter((r) => r.id !== id);
    renderRecommendations();
  } catch (err) {
    alert(`删除失败: ${err.message}`);
  }
}

if (recFilterGroup) {
  recFilterGroup.addEventListener("click", (e) => {
    const btn = e.target.closest(".rec-filter-btn");
    if (!btn) return;
    recFilterGroup.querySelectorAll(".rec-filter-btn").forEach((b) => b.classList.remove("is-active"));
    btn.classList.add("is-active");
    activeRecFilter = btn.dataset.status || "all";
    renderRecommendations();
  });
}

loadAdminData();
loadRefreshStatus().catch((error) => {
  refreshStatus.textContent = `读取刷新状态失败：${error.message}`;
});
loadRecommendations();
setInterval(loadAdminData, DATA_RELOAD_INTERVAL_MS);
setInterval(loadRecommendations, DATA_RELOAD_INTERVAL_MS);

