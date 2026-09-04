const productList = document.querySelector("#productList");
const summary = document.querySelector("#summary");
const stats = document.querySelector("#stats");
const emptyState = document.querySelector("#emptyState");
const sortButton = document.querySelector("#sortButton");
const includeOutOfStock = document.querySelector("#includeOutOfStock");
const searchInput = document.querySelector("#searchInput");
const shopFilter = document.querySelector("#shopFilter");
const backToTop = document.querySelector("#backToTop");
const shareButton = document.querySelector("#shareButton");
const shareOverlay = document.querySelector("#shareOverlay");
const shareImage = document.querySelector("#shareImage");
const shareToast = document.querySelector("#shareToast");
const subtypeGroup = document.querySelector("#subtypeGroup");
const modeButtons = [...document.querySelectorAll("[data-mode]")];
const pageTitle = document.querySelector("#pageTitle");
const brandEyebrow = document.querySelector("#brandEyebrow");
const documentTitle = document.querySelector("#documentTitle") || document.querySelector("title");

const productsUrl = document.body.dataset.productsUrl || "data/products.json";
const metaUrl = document.body.dataset.metaUrl || "data/meta.json";
const DATA_RELOAD_INTERVAL_MS = 60 * 1000;
const MAX_VISIBLE_PRICE = 2000;
const SHARE_VISIBLE_ITEMS = 5;
const SHARE_IMAGE_WIDTH = 390;
const SHARE_IMAGE_MAX_HEIGHT = 844;
const SHARE_ROW_X = 28;
const SHARE_ROW_WIDTH = 334;
const SHARE_ROW_HEIGHT = 68;
const SHARE_ROW_GAP = 10;
const SHARE_CARDS_TOP = 160;
const SHARE_MORE_ROW_HEIGHT = 48;
const SHARE_MORE_ROW_GAP = 22;
const SHARE_QR_SIZE = 160;
const SHARE_QR_INSET = 12;
const SHARE_TIP_GAP = 28;
const SHARE_BOTTOM_PAD = 36;
const defaultSort = "price-asc";
const MODE_STORAGE_KEY = "brandMode";
let lastRefreshLabel = "尚未刷新";
const modeConfigs = {
  codex: {
    id: "codex",
    label: "Codex",
    title: "Codex 比价",
    defaultSubtype: "plus",
    subtypes: [
      { id: "free", label: "Free" },
      { id: "plus", label: "Plus" },
      { id: "pro_5x", label: "5x" },
      { id: "pro_20x", label: "20x" },
      { id: "codex_sms", label: "SMS" },
    ],
  },
  grok: {
    id: "grok",
    label: "Grok",
    title: "Grok 比价",
    defaultSubtype: "m1",
    subtypes: [
      { id: "free", label: "Free" },
      { id: "m1", label: "1M" },
      { id: "m3", label: "3M" },
      { id: "y1", label: "1Y" },
    ],
  },
  gemini: {
    id: "gemini",
    label: "Gemini",
    title: "Gemini 比价",
    defaultSubtype: "m18",
    subtypes: [
      { id: "y1", label: "1Y" },
      { id: "m18", label: "18M" },
      { id: "others", label: "Others" },
    ],
  },
};
const subtypeValuesFromUrl = new Map([
  ["free", "free"],
  ["plus", "plus"],
  ["go", "free"],
  ["trial", "plus"],
  ["plus_trial", "plus"],
  ["ready", "plus"],
  ["plus_ready", "plus"],
  ["topup", "plus"],
  ["plus_topup", "plus"],
  ["pro", "pro_5x"],
  ["5x", "pro_5x"],
  ["pro_5x", "pro_5x"],
  ["20x", "pro_20x"],
  ["pro_20x", "pro_20x"],
  ["sms", "codex_sms"],
  ["codex_sms", "codex_sms"],
  ["m12", "m1"],
  ["m1", "m1"],
  ["m2", "m1"],
  ["1m", "m1"],
  ["2m", "m1"],
  ["1-2m", "m1"],
  ["m3", "m3"],
  ["3m", "m3"],
  ["3m+", "m3"],
  ["y1", "y1"],
  ["1y", "y1"],
  ["year", "y1"],
  ["m18", "m18"],
  ["others", "others"],
  ["other", "others"],
]);
const subtypeToUrlValue = new Map([
  ["codex_sms", "sms"],
  ["m1", "m1"],
  ["m12", "m1"],
  ["pro_5x", "5x"],
  ["pro_20x", "20x"],
  ["m18", "m18"],
  ["others", "others"],
]);
const urlStateKeys = {
  mode: "mode",
  subtype: "type",
  stock: "stock",
  sort: "sort",
  query: "q",
  shop: "shop",
};

let allProducts = [];
let currentSort = defaultSort;
let currentMode = "codex";
let currentSubtype = modeConfigs.codex.defaultSubtype;
let currentQuery = "";
let currentShopId = "";
let shareToastFrame = 0;
let shareToastTimer = 0;
const expandedGroupKeys = new Set();

function clearElement(element) {
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}

function formatPrice(price) {
  if (typeof price !== "number") return "价格未知";
  return `¥${price.toFixed(price % 1 === 0 ? 0 : 2)}`;
}

function displayProductTitle(title) {
  return String(title || "")
    .replace(/^[\[【]\s*请看店铺公告\s*[\]】]\s*/u, "")
    .trim();
}

function stockLabel(item) {
  if (item.stockStatus === "out_of_stock") return "缺货";
  if (item.stockStatus === "low_stock") return item.stockCount == null ? "低库存" : `低库存 ${item.stockCount}`;
  if (item.stockStatus === "in_stock") return item.stockCount == null ? "有货" : `库存 ${item.stockCount}`;
  return "库存未知";
}

function productBrand(item) {
  if (item.brand === "gemini" || item.category === "gemini") return "gemini";
  if (item.brand === "grok" || item.category === "grok") return "grok";
  return "codex";
}

function currentModeConfig() {
  return modeConfigs[currentMode] || modeConfigs.codex;
}

function currentSubtypeValues() {
  return currentModeConfig().subtypes.map((item) => item.id);
}

function currentSubtypeLabel() {
  return currentModeConfig().subtypes.find((item) => item.id === currentSubtype)?.label || currentSubtype;
}

function sortProducts(items) {
  return [...items].sort(compareGroupItems);
}

function matchesSearch(item, query = currentQuery) {
  const tokens = String(query || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const haystack = `${displayProductTitle(item.title)} ${item.sourceName || ""}`.toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

function canonicalSubtype(item) {
  return item?.subtype === "go" ? "free" : item?.subtype;
}

function matchesCurrentSelection(item, { includeOutOfStock: allowOutOfStock = true } = {}) {
  const subtypeValues = currentSubtypeValues();
  const itemSubtype = canonicalSubtype(item);
  if (productBrand(item) !== currentMode) return false;
  if (!subtypeValues.includes(itemSubtype)) return false;
  if (itemSubtype !== currentSubtype) return false;
  if (typeof item.price === "number" && item.price >= MAX_VISIBLE_PRICE) return false;
  if (!allowOutOfStock && item.stockStatus === "out_of_stock") return false;
  if (currentShopId && item.sourceId !== currentShopId) return false;
  if (!matchesSearch(item)) return false;
  return true;
}

function filterProducts(options = {}) {
  const allowOutOfStock = options.includeOutOfStock ?? includeOutOfStock.checked;
  return allProducts.filter((item) => matchesCurrentSelection(item, { includeOutOfStock: allowOutOfStock }));
}

// 当前标签/模式下没有有货商品、但存在缺货商品时，自动打开“包含缺货”。
function ensureIncludeOutOfStockFallback() {
  if (includeOutOfStock.checked) return false;
  if (filterProducts({ includeOutOfStock: false }).length > 0) return false;
  if (filterProducts({ includeOutOfStock: true }).length === 0) return false;
  includeOutOfStock.checked = true;
  return true;
}

function ensureSubtypeForMode() {
  const values = currentSubtypeValues();
  if (!values.includes(currentSubtype)) {
    currentSubtype = currentModeConfig().defaultSubtype;
  }
}

function renderSubtypeButtons() {
  clearElement(subtypeGroup);
  for (const subtype of currentModeConfig().subtypes) {
    const button = document.createElement("button");
    button.className = "subtype-button";
    button.type = "button";
    button.dataset.subtype = subtype.id;
    button.textContent = subtype.label;
    button.addEventListener("click", () => {
      currentSubtype = subtype.id;
      syncSubtypeButtons();
      writeStateToUrl();
      render({ animate: true });
    });
    subtypeGroup.appendChild(button);
  }
  syncSubtypeButtons();
}

function syncModeButtons() {
  for (const button of modeButtons) {
    const isActive = button.dataset.mode === currentMode;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  }
}

function syncSubtypeButtons() {
  const subtypeButtons = [...subtypeGroup.querySelectorAll("[data-subtype]")];
  for (const button of subtypeButtons) {
    const isActive = button.dataset.subtype === currentSubtype;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  }
}

function syncModeChrome() {
  const config = currentModeConfig();
  if (pageTitle) pageTitle.textContent = config.title;
  if (brandEyebrow) brandEyebrow.textContent = config.label;
  if (documentTitle) documentTitle.textContent = config.title;
  document.body.dataset.mode = currentMode;
  try {
    window.localStorage?.setItem(MODE_STORAGE_KEY, currentMode);
  } catch {}
}

function syncSortButton() {
  const isDesc = currentSort === "price-desc";
  sortButton.classList.toggle("is-desc", isDesc);
  sortButton.setAttribute("aria-label", isDesc ? "价格降序" : "价格升序");
  sortButton.title = isDesc ? "价格降序" : "价格升序";
}

function isSummaryOverflowing() {
  if (!summary) return false;
  const style = getComputedStyle(summary);
  const lineHeight = Number.parseFloat(style.lineHeight);
  const fontSize = Number.parseFloat(style.fontSize);
  const oneLine = Number.isFinite(lineHeight) ? lineHeight : fontSize * 1.6;
  return summary.scrollHeight > oneLine + 1 || summary.scrollWidth > summary.clientWidth + 1;
}

function updateSummary(time) {
  if (typeof time === "string") lastRefreshLabel = time;
  if (!summary) return;

  const modeCount = allProducts.filter((item) => productBrand(item) === currentMode).length;
  const full = `共 ${allProducts.length} 条商品，当前 ${currentModeConfig().label} ${modeCount} 条。最近刷新：${lastRefreshLabel}`;
  const compact = `共 ${allProducts.length} 条商品。最近刷新：${lastRefreshLabel}`;

  summary.textContent = full;
  if (isSummaryOverflowing()) summary.textContent = compact;
}

function shopsForCurrentMode() {
  const shops = new Map();
  for (const item of allProducts) {
    if (productBrand(item) !== currentMode || !item.sourceId) continue;
    if (!shops.has(item.sourceId)) shops.set(item.sourceId, item.sourceName || item.sourceId);
  }
  return [...shops.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

function syncShopFilter() {
  if (!shopFilter) return;
  const shops = shopsForCurrentMode();
  const previous = currentShopId;
  clearElement(shopFilter);
  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = "全部店铺";
  shopFilter.appendChild(allOption);
  for (const shop of shops) {
    const option = document.createElement("option");
    option.value = shop.id;
    option.textContent = shop.name;
    shopFilter.appendChild(option);
  }
  if (previous && shops.some((shop) => shop.id === previous)) {
    currentShopId = previous;
    shopFilter.value = previous;
  } else {
    currentShopId = "";
    shopFilter.value = "";
  }
}

function compareGroupItems(a, b) {
  const stockRank = { in_stock: 0, low_stock: 0, unknown: 1, out_of_stock: 2 };
  const price = (item) => {
    if (typeof item?.price === "number") return item.price;
    return currentSort === "price-desc" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  };
  const priceDiff = currentSort === "price-desc" ? price(b) - price(a) : price(a) - price(b);
  if (priceDiff !== 0) return priceDiff;
  const rankDiff = (stockRank[a?.stockStatus] ?? 1) - (stockRank[b?.stockStatus] ?? 1);
  if (rankDiff !== 0) return rankDiff;
  const sourceDiff = String(a?.sourceId || a?.sourceName || "").localeCompare(String(b?.sourceId || b?.sourceName || ""), "zh-CN");
  if (sourceDiff !== 0) return sourceDiff;
  return String(a?.url || "").localeCompare(String(b?.url || ""));
}

function normalizeGroupKey(title) {
  const normTitle = displayProductTitle(title)
    .replace(/[【\[]/g, "[")
    .replace(/[】\]]/g, "]")
    .replace(/[（(]/g, "(")
    .replace(/[）)]/g, ")")
    .replace(/\s+/g, " ")
    .trim();
  return normTitle;
}

function groupProducts(sortedItems) {
  const groups = [];
  const map = new Map();

  for (const item of sortedItems) {
    const key = normalizeGroupKey(item.title);
    let group = map.get(key);
    if (!group) {
      group = {
        key,
        primary: item,
        items: [],
      };
      map.set(key, group);
      groups.push(group);
    }
    group.items.push(item);
  }

  for (const group of groups) {
    group.items.sort(compareGroupItems);
    group.primary = group.items[0];
  }

  groups.sort((a, b) => compareGroupItems(a.primary, b.primary));

  return groups;
}

function resolveProductUrl(item) {
  const url = String(item?.url || "").trim();
  const sourceUrl = String(item?.sourceUrl || "").trim();
  if (/^https?:\/\/[^\/]+\/?$/i.test(url) && sourceUrl) {
    return sourceUrl;
  }
  return url || sourceUrl || "#";
}

function createProductCard(item, { isChild = false } = {}) {
  const card = document.createElement("article");
  card.className = `product-card ${item.stockStatus === "out_of_stock" ? "is-out" : ""}${isChild ? " product-card-child" : ""}`;

  const title = document.createElement("h2");

  const price = document.createElement("strong");
  price.className = "price";
  price.textContent = formatPrice(item.price);

  const source = document.createElement("span");
  source.className = "source-pill";
  source.textContent = item.sourceName;
  source.title = item.sourceName;

  const stock = document.createElement("span");
  stock.className = `stock-pill stock-${item.stockStatus || "unknown"}`;
  stock.textContent = stockLabel(item);

  const link = document.createElement("a");
  link.href = resolveProductUrl(item);
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = displayProductTitle(item.title);

  title.append(link);
  card.append(title, source, stock, price);
  return card;
}

function createGroupedProductElement(group) {
  if (group.items.length === 1) {
    return createProductCard(group.items[0]);
  }

  const groupContainer = document.createElement("div");
  groupContainer.className = "product-group";

  const isExpanded = expandedGroupKeys.has(group.key);
  if (isExpanded) {
    groupContainer.classList.add("is-expanded");
  }

  const primaryItem = group.primary;
  const primaryCard = document.createElement("article");
  primaryCard.className = `product-card product-card-parent is-expandable ${primaryItem.stockStatus === "out_of_stock" ? "is-out" : ""}`;

  const title = document.createElement("h2");
  const link = document.createElement("a");
  link.href = resolveProductUrl(primaryItem);
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = displayProductTitle(primaryItem.title);
  title.append(link);

  const price = document.createElement("strong");
  price.className = "price";
  price.textContent = formatPrice(primaryItem.price);

  const uniqueShops = new Set(group.items.map((i) => i.sourceId || i.sourceName).filter(Boolean));
  const isMultiShop = uniqueShops.size > 1;
  const countLabel = isMultiShop ? `共${uniqueShops.size}家` : `共${group.items.length}条`;

  const getAriaLabel = (expanded) => {
    if (isMultiShop) {
      return expanded ? "收起其他商家" : `展开全部 ${uniqueShops.size} 家商家`;
    }
    return expanded ? "收起其他规格" : `展开全部 ${group.items.length} 条规格`;
  };

  const getTitleTip = (expanded) => {
    if (isMultiShop) {
      return expanded ? "点击收起商家" : `点击展开查看 ${uniqueShops.size} 家商家`;
    }
    return expanded ? "点击收起规格" : `点击展开查看 ${group.items.length} 条规格`;
  };

  const sourceButton = document.createElement("button");
  sourceButton.type = "button";
  sourceButton.className = `source-pill source-pill-toggle ${isExpanded ? "is-expanded" : ""}`;
  sourceButton.setAttribute("aria-expanded", String(isExpanded));
  sourceButton.setAttribute("aria-label", getAriaLabel(isExpanded));
  sourceButton.title = getTitleTip(isExpanded);

  const sourceNameSpan = document.createElement("span");
  sourceNameSpan.className = "source-name";
  sourceNameSpan.textContent = primaryItem.sourceName;
  sourceNameSpan.title = primaryItem.sourceName;

  const countBadge = document.createElement("span");
  countBadge.className = "source-badge";
  countBadge.textContent = countLabel;

  const arrowSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  arrowSvg.setAttribute("class", "source-arrow");
  arrowSvg.setAttribute("viewBox", "0 0 20 20");
  arrowSvg.setAttribute("fill", "currentColor");
  arrowSvg.setAttribute("aria-hidden", "true");
  const arrowPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  arrowPath.setAttribute("d", "M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z");
  arrowSvg.appendChild(arrowPath);

  sourceButton.append(sourceNameSpan, countBadge, arrowSvg);

  const stock = document.createElement("span");
  stock.className = `stock-pill stock-${primaryItem.stockStatus || "unknown"}`;
  stock.textContent = stockLabel(primaryItem);

  primaryCard.append(title, sourceButton, stock, price);

  const childrenContainer = document.createElement("div");
  childrenContainer.className = "product-group-children";
  childrenContainer.hidden = !isExpanded;

  for (let i = 1; i < group.items.length; i++) {
    const childCard = createProductCard(group.items[i], { isChild: true });
    childrenContainer.appendChild(childCard);
  }

  sourceButton.addEventListener("click", (e) => {
    e.stopPropagation();
    const currentlyExpanded = expandedGroupKeys.has(group.key);
    if (currentlyExpanded) {
      expandedGroupKeys.delete(group.key);
      groupContainer.classList.remove("is-expanded");
      sourceButton.classList.remove("is-expanded");
      sourceButton.setAttribute("aria-expanded", "false");
      sourceButton.setAttribute("aria-label", getAriaLabel(false));
      sourceButton.title = getTitleTip(false);
      childrenContainer.hidden = true;
    } else {
      expandedGroupKeys.add(group.key);
      groupContainer.classList.add("is-expanded");
      sourceButton.classList.add("is-expanded");
      sourceButton.setAttribute("aria-expanded", "true");
      sourceButton.setAttribute("aria-label", getAriaLabel(true));
      sourceButton.title = getTitleTip(true);
      childrenContainer.hidden = false;
    }
  });

  groupContainer.append(primaryCard, childrenContainer);
  return groupContainer;
}

function triggerFilterAnimation() {
  productList.classList.remove("is-filtering");
  requestAnimationFrame(() => {
    productList.classList.add("is-filtering");
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function readStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get(urlStateKeys.mode);
  const subtype = subtypeValuesFromUrl.get(params.get(urlStateKeys.subtype));
  const stock = params.get(urlStateKeys.stock);
  const sort = params.get(urlStateKeys.sort);
  const query = params.get(urlStateKeys.query);
  const shop = params.get(urlStateKeys.shop);

  const host = String(window.location?.hostname || "").toLowerCase();
  const isIndexDomain = /(?:^|\.)index(?:\.|$)/.test(host);
  const isCodexDomain = /(?:^|\.)codex(?:\.|$)/.test(host);
  const isGrokDomain = /(?:^|\.)grok(?:\.|$)/.test(host);
  const isGeminiDomain = /(?:^|\.)gemini(?:\.|$)/.test(host);

  if (mode === "codex" || mode === "grok" || mode === "gemini") {
    currentMode = mode;
  } else if (isIndexDomain || isCodexDomain) {
    currentMode = "codex";
  } else if (isGrokDomain) {
    currentMode = "grok";
  } else if (isGeminiDomain) {
    currentMode = "gemini";
  } else {
    currentMode = "codex";
  }

  ensureSubtypeForMode();
  if (subtype && currentSubtypeValues().includes(subtype)) {
    currentSubtype = subtype;
  }
  if (stock === "all") {
    includeOutOfStock.checked = true;
  } else if (stock === "available") {
    includeOutOfStock.checked = false;
  }
  if (sort === "desc") {
    currentSort = "price-desc";
  } else if (sort === "asc") {
    currentSort = "price-asc";
  }
  if (query) {
    currentQuery = query;
    if (searchInput) searchInput.value = query;
  }
  if (shop) currentShopId = shop;
}

function writeStateToUrl() {
  if (!window.history?.replaceState) return;
  const url = createShareUrl();
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

function subtypeForUrl(subtype) {
  return subtypeToUrlValue.get(subtype) || subtype;
}

function createShareUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set(urlStateKeys.mode, currentMode);
  url.searchParams.set(urlStateKeys.subtype, subtypeForUrl(currentSubtype));
  url.searchParams.set(urlStateKeys.stock, includeOutOfStock.checked ? "all" : "available");
  url.searchParams.set(urlStateKeys.sort, currentSort === "price-desc" ? "desc" : "asc");
  if (currentQuery) url.searchParams.set(urlStateKeys.query, currentQuery);
  else url.searchParams.delete(urlStateKeys.query);
  if (currentShopId) url.searchParams.set(urlStateKeys.shop, currentShopId);
  else url.searchParams.delete(urlStateKeys.shop);
  return url;
}

function createQrImage(url) {
  if (typeof qrcode !== "function") {
    throw new Error("二维码生成器未加载");
  }
  const qr = qrcode(0, "M");
  qr.addData(url.toString());
  qr.make();
  return loadImage(qr.createDataURL(6, 1));
}

function canvasColor(name) {
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function fillRoundRect(ctx, x, y, width, height, radius, fillStyle, strokeStyle) {
  roundRect(ctx, x, y, width, height, radius);
  ctx.fillStyle = fillStyle;
  ctx.fill();
  if (strokeStyle) {
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function truncateCanvasText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let output = text;
  while (output.length > 1 && ctx.measureText(`${output}...`).width > maxWidth) {
    output = output.slice(0, -1);
  }
  return `${output}...`;
}

function getShareImageHeight(itemCount) {
  const visibleCount = Math.min(Math.max(itemCount, 0), SHARE_VISIBLE_ITEMS);
  const moreRowY = SHARE_CARDS_TOP + visibleCount * (SHARE_ROW_HEIGHT + SHARE_ROW_GAP);
  const qrY = moreRowY + SHARE_MORE_ROW_HEIGHT + SHARE_MORE_ROW_GAP;
  const tipY = qrY + SHARE_QR_SIZE + SHARE_TIP_GAP;
  return tipY + SHARE_BOTTOM_PAD;
}

function lockShareImageSize(imageHeight = SHARE_IMAGE_MAX_HEIGHT) {
  const maxWidth = Math.max(220, window.innerWidth - 72);
  const maxHeight = Math.max(420, window.innerHeight - 96);
  const width = Math.floor(
    Math.min(SHARE_IMAGE_WIDTH, maxWidth, (maxHeight * SHARE_IMAGE_WIDTH) / imageHeight),
  );
  const height = Math.floor((width * imageHeight) / SHARE_IMAGE_WIDTH);
  shareImage.style.width = `${width}px`;
  shareImage.style.height = `${height}px`;
}

function showShareToast() {
  cancelAnimationFrame(shareToastFrame);
  clearTimeout(shareToastTimer);
  shareToast.hidden = false;
  shareToastFrame = requestAnimationFrame(() => {
    shareToastFrame = 0;
    shareToast.classList.add("is-visible");
  });
}

function hideShareToast() {
  cancelAnimationFrame(shareToastFrame);
  shareToastFrame = 0;
  clearTimeout(shareToastTimer);
  shareToast.classList.remove("is-visible");
  shareToastTimer = setTimeout(() => {
    shareToastTimer = 0;
    if (!shareToast.classList.contains("is-visible")) {
      shareToast.hidden = true;
    }
  }, 160);
}

async function createShareSnapshotImage() {
  const items = sortProducts(filterProducts());
  const groups = groupProducts(items);
  const visibleGroups = groups.slice(0, SHARE_VISIBLE_ITEMS);
  const imageHeight = getShareImageHeight(visibleGroups.length);
  const modeConfig = currentModeConfig();
  const subtypeText = currentSubtypeLabel();
  const qr = await createQrImage(createShareUrl());
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = SHARE_IMAGE_WIDTH * scale;
  canvas.height = imageHeight * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);

  const bg = canvasColor("--bg");
  const panel = canvasColor("--panel");
  const panelMuted = canvasColor("--panel-muted");
  const outPanel = canvasColor("--out-panel");
  const text = canvasColor("--text");
  const muted = canvasColor("--muted");
  const line = canvasColor("--line");
  const accent = canvasColor("--accent");
  const warn = canvasColor("--warn");

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, SHARE_IMAGE_WIDTH, imageHeight);

  ctx.textAlign = "center";
  ctx.font = "800 12px Inter, system-ui, sans-serif";
  ctx.fillStyle = accent;
  ctx.fillText(modeConfig.label.toUpperCase(), SHARE_IMAGE_WIDTH / 2, 50);

  ctx.textAlign = "center";
  ctx.fillStyle = text;
  ctx.font = "800 42px Inter, system-ui, sans-serif";
  ctx.fillText(modeConfig.title, SHARE_IMAGE_WIDTH / 2, 94);

  ctx.fillStyle = muted;
  ctx.font = "15px Inter, system-ui, sans-serif";
  ctx.fillText(`${subtypeText} · ${currentSort === "price-desc" ? "价格降序" : "价格升序"}`, SHARE_IMAGE_WIDTH / 2, 124);

  ctx.textAlign = "left";
  let y = SHARE_CARDS_TOP;
  for (const group of visibleGroups) {
    const item = group.primary;
    fillRoundRect(
      ctx,
      SHARE_ROW_X,
      y,
      SHARE_ROW_WIDTH,
      SHARE_ROW_HEIGHT,
      8,
      item.stockStatus === "out_of_stock" ? outPanel : panel,
      line,
    );

    ctx.fillStyle = text;
    ctx.font = "700 15px Inter, system-ui, sans-serif";
    ctx.fillText(truncateCanvasText(ctx, displayProductTitle(item.title), 220), SHARE_ROW_X + 16, y + 27);

    const uniqueShops = new Set(group.items.map((i) => i.sourceId || i.sourceName).filter(Boolean));
    const isMultiShop = uniqueShops.size > 1;
    const countLabel = group.items.length > 1
      ? (isMultiShop ? `共${uniqueShops.size}家` : `共${group.items.length}条`)
      : "";
    const subText = countLabel
      ? `${item.sourceName} · ${countLabel} · ${stockLabel(item)}`
      : `${item.sourceName} · ${stockLabel(item)}`;

    ctx.fillStyle = muted;
    ctx.font = "13px Inter, system-ui, sans-serif";
    ctx.fillText(
      truncateCanvasText(ctx, subText, 220),
      SHARE_ROW_X + 16,
      y + 50,
    );

    ctx.textAlign = "right";
    ctx.fillStyle = item.stockStatus === "out_of_stock" ? warn : accent;
    ctx.font = "800 18px Inter, system-ui, sans-serif";
    ctx.fillText(formatPrice(item.price), SHARE_ROW_X + SHARE_ROW_WIDTH - 16, y + 42);
    ctx.textAlign = "left";

    y += SHARE_ROW_HEIGHT + SHARE_ROW_GAP;
  }

  const moreRowY = y;
  const moreTextY = moreRowY + 30;
  const qrY = moreRowY + SHARE_MORE_ROW_HEIGHT + SHARE_MORE_ROW_GAP;
  const qrX = Math.round((SHARE_IMAGE_WIDTH - SHARE_QR_SIZE) / 2);
  const tipY = qrY + SHARE_QR_SIZE + SHARE_TIP_GAP;

  ctx.textAlign = "center";
  fillRoundRect(ctx, SHARE_ROW_X, moreRowY, SHARE_ROW_WIDTH, SHARE_MORE_ROW_HEIGHT, 8, panel, line);
  ctx.fillStyle = text;
  ctx.font = "700 15px Inter, system-ui, sans-serif";
  if (groups.length > SHARE_VISIBLE_ITEMS) {
    const remaining = groups.length - SHARE_VISIBLE_ITEMS;
    const unit = groups.length < items.length ? "款" : "条";
    ctx.fillText(`另有 ${remaining} ${unit}商品可以查看`, SHARE_IMAGE_WIDTH / 2, moreTextY);
  } else if (groups.length === 0) {
    ctx.fillText("没有匹配的商品", SHARE_IMAGE_WIDTH / 2, moreTextY);
  } else {
    ctx.fillText("已显示全部匹配商品", SHARE_IMAGE_WIDTH / 2, moreTextY);
  }

  fillRoundRect(ctx, qrX, qrY, SHARE_QR_SIZE, SHARE_QR_SIZE, 10, "#ffffff", line);
  ctx.drawImage(
    qr,
    qrX + SHARE_QR_INSET,
    qrY + SHARE_QR_INSET,
    SHARE_QR_SIZE - SHARE_QR_INSET * 2,
    SHARE_QR_SIZE - SHARE_QR_INSET * 2,
  );

  ctx.fillStyle = muted;
  ctx.font = "14px Inter, system-ui, sans-serif";
  ctx.fillText("长按图片扫码或者分享", SHARE_IMAGE_WIDTH / 2, tipY);

  ctx.fillStyle = panelMuted;
  ctx.fillRect(0, imageHeight - 1, SHARE_IMAGE_WIDTH, 1);
  return { dataUrl: canvas.toDataURL("image/png"), height: imageHeight };
}

async function openShareOverlay() {
  const image = shareImage.querySelector("img");
  shareButton.disabled = true;
  shareButton.setAttribute("aria-busy", "true");
  image.removeAttribute("src");
  const previewItemCount = Math.min(groupProducts(sortProducts(filterProducts())).length, SHARE_VISIBLE_ITEMS);
  lockShareImageSize(getShareImageHeight(previewItemCount));
  showShareToast();

  try {
    const snapshot = await createShareSnapshotImage();
    lockShareImageSize(snapshot.height);
    image.src = snapshot.dataUrl;
    image.alt = `${currentModeConfig().title}分享截图`;
    hideShareToast();
    shareOverlay.hidden = false;
    requestAnimationFrame(() => {
      document.body.classList.add("is-share-open");
      shareOverlay.classList.add("is-visible");
    });
  } catch (error) {
    console.error(error);
    hideShareToast();
  } finally {
    shareButton.disabled = false;
    shareButton.removeAttribute("aria-busy");
  }
}

function closeShareOverlay() {
  shareOverlay.classList.remove("is-visible");
  document.body.classList.remove("is-share-open");
  setTimeout(() => {
    if (!shareOverlay.classList.contains("is-visible")) {
      shareOverlay.hidden = true;
      shareImage.querySelector("img").removeAttribute("src");
    }
  }, 180);
}

function render({ animate = false } = {}) {
  if (ensureIncludeOutOfStockFallback()) {
    writeStateToUrl();
  }
  const items = sortProducts(filterProducts());
  clearElement(productList);
  emptyState.hidden = items.length > 0;

  const inStock = items.filter((item) => item.stockStatus !== "out_of_stock").length;
  const outOfStock = items.length - inStock;
  const groups = groupProducts(items);
  if (groups.length < items.length) {
    stats.textContent = `显示 ${groups.length} 款（共 ${items.length} 条）· 有货 ${inStock} · 缺货 ${outOfStock}`;
  } else {
    stats.textContent = `显示 ${items.length} 条 · 有货 ${inStock} · 缺货 ${outOfStock}`;
  }

  const fragment = document.createDocumentFragment();
  for (const group of groups) {
    fragment.appendChild(createGroupedProductElement(group));
  }
  productList.appendChild(fragment);

  if (animate) triggerFilterAnimation();
}

const PRODUCTS_CACHE_KEY = "codex_price_products_cache";
const META_CACHE_KEY = "codex_price_meta_cache";

function restoreLocalCache() {
  try {
    const cachedProductsRaw = localStorage.getItem(PRODUCTS_CACHE_KEY);
    const cachedMetaRaw = localStorage.getItem(META_CACHE_KEY);

    if (cachedProductsRaw) {
      const parsed = JSON.parse(cachedProductsRaw);
      if (Array.isArray(parsed?.items) && parsed.items.length > 0) {
        allProducts = parsed.items;
        if (parsed.etag) productsEtag = parsed.etag;
      }
    }
    if (cachedMetaRaw) {
      const parsed = JSON.parse(cachedMetaRaw);
      if (parsed?.etag) metaEtag = parsed.etag;
      if (parsed?.time) lastRefreshLabel = parsed.time;
    }

    if (allProducts.length > 0) {
      syncShopFilter();
      updateSummary(lastRefreshLabel);
      render();
    }
  } catch {
    // Ignore storage parse failure
  }
}

function saveLocalProductsCache(items, etag) {
  try {
    localStorage.setItem(PRODUCTS_CACHE_KEY, JSON.stringify({ items, etag }));
  } catch {
    // Ignore storage quota error
  }
}

function saveLocalMetaCache(meta, etag, time) {
  try {
    localStorage.setItem(META_CACHE_KEY, JSON.stringify({ meta, etag, time }));
  } catch {
    // Ignore storage quota error
  }
}

let productsEtag = null;
let metaEtag = null;

async function loadData() {
  try {
    const productsHeaders = {};
    const metaHeaders = {};
    if (productsEtag) productsHeaders["If-None-Match"] = productsEtag;
    if (metaEtag) metaHeaders["If-None-Match"] = metaEtag;

    const [productsResponse, metaResponse] = await Promise.all([
      fetch(productsUrl, { headers: productsHeaders }),
      fetch(metaUrl, { headers: metaHeaders }),
    ]);

    if (productsResponse.status === 304 && metaResponse.status === 304) {
      return;
    }

    let hasUpdate = false;
    if (productsResponse.status === 200) {
      const newProductsEtag = productsResponse.headers.get("etag");
      if (newProductsEtag) productsEtag = newProductsEtag;
      const products = await productsResponse.json();
      allProducts = Array.isArray(products.items) ? products.items : [];
      saveLocalProductsCache(allProducts, productsEtag);
      hasUpdate = true;
    } else if (productsResponse.status !== 304) {
      throw new Error(`products HTTP ${productsResponse.status}`);
    }

    let time = null;
    if (metaResponse.status === 200) {
      const newMetaEtag = metaResponse.headers.get("etag");
      if (newMetaEtag) metaEtag = newMetaEtag;
      const meta = await metaResponse.json();
      time = meta.generatedAt ? new Date(meta.generatedAt).toLocaleString("zh-CN") : "尚未刷新";
      lastRefreshLabel = time;
      saveLocalMetaCache(meta, metaEtag, time);
      hasUpdate = true;
    } else if (metaResponse.status !== 304) {
      throw new Error(`meta HTTP ${metaResponse.status}`);
    }

    if (hasUpdate) {
      syncShopFilter();
      if (time) updateSummary(time);
      else updateSummary();
      render();
    }
  } catch (error) {
    if (allProducts.length === 0) {
      summary.textContent = `读取数据失败：${error.message}`;
      clearElement(productList);
      emptyState.hidden = true;
    }
    console.error(error);
  }
}

function setMode(mode, { animate = true } = {}) {
  if (!modeConfigs[mode] || mode === currentMode) return;
  currentMode = mode;
  // 切换品牌时回到该模式默认标签，例如 Grok 默认 1M。
  currentSubtype = currentModeConfig().defaultSubtype;
  syncModeButtons();
  syncModeChrome();
  renderSubtypeButtons();
  syncShopFilter();
  writeStateToUrl();
  // 已有商品数据时直接重绘；同时刷新摘要中的模式计数。
  if (allProducts.length > 0) {
    updateSummary();
  }
  render({ animate });
}

for (const button of modeButtons) {
  button.addEventListener("click", () => {
    setMode(button.dataset.mode);
  });
}

sortButton.addEventListener("click", () => {
  currentSort = currentSort === "price-asc" ? "price-desc" : "price-asc";
  syncSortButton();
  writeStateToUrl();
  render({ animate: true });
});

includeOutOfStock.addEventListener("change", () => {
  writeStateToUrl();
  render({ animate: true });
});

let searchDebounceTimer = null;
searchInput?.addEventListener("input", () => {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    currentQuery = searchInput.value.trim();
    writeStateToUrl();
    render({ animate: true });
  }, 150);
});

shopFilter?.addEventListener("change", () => {
  currentShopId = shopFilter.value;
  writeStateToUrl();
  render({ animate: true });
});

function syncBackToTop() {
  backToTop.classList.toggle("is-visible", window.scrollY > 360);
}

backToTop.addEventListener("click", () => {
  window.scrollTo({ top: 0, behavior: "smooth" });
});

shareButton.addEventListener("click", openShareOverlay);

shareOverlay.addEventListener("click", (event) => {
  if (event.target === shareOverlay) closeShareOverlay();
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && shareOverlay.classList.contains("is-visible")) closeShareOverlay();
});

window.addEventListener("scroll", syncBackToTop, { passive: true });

window.addEventListener(
  "resize",
  () => {
    if (allProducts.length > 0) updateSummary();
  },
  { passive: true },
);

readStateFromUrl();
syncModeButtons();
syncModeChrome();
renderSubtypeButtons();
syncSortButton();
syncBackToTop();
writeStateToUrl();
restoreLocalCache();
loadData();
setInterval(loadData, DATA_RELOAD_INTERVAL_MS);
