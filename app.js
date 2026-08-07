const productList = document.querySelector("#productList");
const summary = document.querySelector("#summary");
const stats = document.querySelector("#stats");
const emptyState = document.querySelector("#emptyState");
const sortButton = document.querySelector("#sortButton");
const includeOutOfStock = document.querySelector("#includeOutOfStock");
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
      { id: "pro", label: "Pro" },
      { id: "codex_sms", label: "SMS" },
    ],
  },
  grok: {
    id: "grok",
    label: "Grok",
    title: "Grok 比价",
    defaultSubtype: "m12",
    subtypes: [
      { id: "free", label: "Free" },
      { id: "m12", label: "1M" },
      { id: "m3", label: "3M" },
      { id: "y1", label: "1Y" },
    ],
  },
};
const subtypeValuesFromUrl = new Map([
  ["free", "free"],
  ["plus", "plus"],
  ["pro", "pro"],
  ["sms", "codex_sms"],
  ["codex_sms", "codex_sms"],
  ["m12", "m12"],
  ["m1", "m12"],
  ["m2", "m12"],
  ["1m", "m12"],
  ["2m", "m12"],
  ["1-2m", "m12"],
  ["m3", "m3"],
  ["3m", "m3"],
  ["3m+", "m3"],
  ["y1", "y1"],
  ["1y", "y1"],
  ["year", "y1"],
]);
const urlStateKeys = {
  mode: "mode",
  subtype: "type",
  stock: "stock",
  sort: "sort",
};

let allProducts = [];
let currentSort = defaultSort;
let currentMode = "codex";
let currentSubtype = modeConfigs.codex.defaultSubtype;
let shareToastFrame = 0;
let shareToastTimer = 0;

function clearElement(element) {
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}

function formatPrice(price) {
  if (typeof price !== "number") return "价格未知";
  return `¥${price.toFixed(price % 1 === 0 ? 0 : 2)}`;
}

function stockLabel(item) {
  if (item.stockStatus === "out_of_stock") return "缺货";
  if (item.stockStatus === "low_stock") return item.stockCount == null ? "低库存" : `低库存 ${item.stockCount}`;
  if (item.stockStatus === "in_stock") return item.stockCount == null ? "有货" : `库存 ${item.stockCount}`;
  return "库存未知";
}

function productBrand(item) {
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
  const stockRank = { in_stock: 0, low_stock: 0, unknown: 1, out_of_stock: 2 };
  const price = (item) => (typeof item.price === "number" ? item.price : Number.POSITIVE_INFINITY);

  return [...items].sort((a, b) => {
    const priceDiff = currentSort === "price-desc" ? price(b) - price(a) : price(a) - price(b);
    if (priceDiff !== 0) return priceDiff;
    return (stockRank[a.stockStatus] ?? 1) - (stockRank[b.stockStatus] ?? 1);
  });
}

function filterProducts() {
  const subtypeValues = currentSubtypeValues();
  return allProducts.filter((item) => {
    if (productBrand(item) !== currentMode) return false;
    if (!subtypeValues.includes(item.subtype)) return false;
    if (item.subtype !== currentSubtype) return false;
    if (typeof item.price === "number" && item.price >= MAX_VISIBLE_PRICE) return false;
    if (!includeOutOfStock.checked && item.stockStatus === "out_of_stock") return false;
    return true;
  });
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

function createProductCard(item) {
  const card = document.createElement("article");
  card.className = `product-card ${item.stockStatus === "out_of_stock" ? "is-out" : ""}`;

  const title = document.createElement("h2");

  const price = document.createElement("strong");
  price.className = "price";
  price.textContent = formatPrice(item.price);

  const source = document.createElement("span");
  source.className = "source-pill";
  source.textContent = item.sourceName;

  const stock = document.createElement("span");
  stock.className = `stock-pill stock-${item.stockStatus || "unknown"}`;
  stock.textContent = stockLabel(item);

  const link = document.createElement("a");
  link.href = item.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = item.title;

  title.append(link);
  card.append(title, source, stock, price);
  return card;
}

function triggerFilterAnimation() {
  productList.classList.remove("is-filtering");
  void productList.offsetWidth;
  productList.classList.add("is-filtering");
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

  if (mode === "codex" || mode === "grok") {
    currentMode = mode;
  } else {
    try {
      const saved = window.localStorage?.getItem(MODE_STORAGE_KEY);
      if (saved === "codex" || saved === "grok") currentMode = saved;
    } catch {}
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
}

function writeStateToUrl() {
  if (!window.history?.replaceState) return;
  const url = createShareUrl();
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

function createShareUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set(urlStateKeys.mode, currentMode);
  url.searchParams.set(
    urlStateKeys.subtype,
    currentSubtype === "codex_sms"
      ? "sms"
      : (currentSubtype === "m12" ? "m1" : currentSubtype),
  );
  url.searchParams.set(urlStateKeys.stock, includeOutOfStock.checked ? "all" : "available");
  url.searchParams.set(urlStateKeys.sort, currentSort === "price-desc" ? "desc" : "asc");
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
  const visibleItems = items.slice(0, SHARE_VISIBLE_ITEMS);
  const imageHeight = getShareImageHeight(visibleItems.length);
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
  for (const item of visibleItems) {
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
    ctx.fillText(truncateCanvasText(ctx, item.title, 220), SHARE_ROW_X + 16, y + 27);

    ctx.fillStyle = muted;
    ctx.font = "13px Inter, system-ui, sans-serif";
    ctx.fillText(
      truncateCanvasText(ctx, `${item.sourceName} · ${stockLabel(item)}`, 220),
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
  if (items.length > SHARE_VISIBLE_ITEMS) {
    ctx.fillText(`另有 ${items.length - SHARE_VISIBLE_ITEMS} 条商品可以查看`, SHARE_IMAGE_WIDTH / 2, moreTextY);
  } else if (items.length === 0) {
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
  const previewItemCount = Math.min(sortProducts(filterProducts()).length, SHARE_VISIBLE_ITEMS);
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
  const items = sortProducts(filterProducts());
  clearElement(productList);
  emptyState.hidden = items.length > 0;

  const inStock = items.filter((item) => item.stockStatus !== "out_of_stock").length;
  const outOfStock = items.length - inStock;
  stats.textContent = `当前显示 ${items.length} 条，含有货 ${inStock} 条、缺货 ${outOfStock} 条`;

  for (const item of items) {
    productList.appendChild(createProductCard(item));
  }

  if (animate) triggerFilterAnimation();
}

async function loadData() {
  try {
    const [productsResponse, metaResponse] = await Promise.all([
      fetch(productsUrl, { cache: "no-store" }),
      fetch(metaUrl, { cache: "no-store" }),
    ]);
    if (!productsResponse.ok) throw new Error(`products HTTP ${productsResponse.status}`);
    if (!metaResponse.ok) throw new Error(`meta HTTP ${metaResponse.status}`);

    const products = await productsResponse.json();
    const meta = await metaResponse.json();
    allProducts = Array.isArray(products.items) ? products.items : [];

    const time = meta.generatedAt ? new Date(meta.generatedAt).toLocaleString("zh-CN") : "尚未刷新";
    updateSummary(time);
    render();
  } catch (error) {
    summary.textContent = `读取数据失败：${error.message}`;
    clearElement(productList);
    emptyState.hidden = true;
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
loadData();
setInterval(loadData, DATA_RELOAD_INTERVAL_MS);
