const productList = document.querySelector("#productList");
const summary = document.querySelector("#summary");
const stats = document.querySelector("#stats");
const emptyState = document.querySelector("#emptyState");
const sortButton = document.querySelector("#sortButton");
const includeOutOfStock = document.querySelector("#includeOutOfStock");
const backToTop = document.querySelector("#backToTop");
const subtypeButtons = [...document.querySelectorAll("[data-subtype]")];

const productsUrl = document.body.dataset.productsUrl || "data/products.json";
const metaUrl = document.body.dataset.metaUrl || "data/meta.json";
const DATA_RELOAD_INTERVAL_MS = 60 * 1000;
const defaultSort = "price-asc";
const visibleSubtypeValues = ["free", "plus", "pro", "codex_sms"];

let allProducts = [];
let currentSort = defaultSort;
let currentSubtype = "plus";

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
  return allProducts.filter((item) => {
    if (!visibleSubtypeValues.includes(item.subtype)) return false;
    if (item.subtype !== currentSubtype) return false;
    if (!includeOutOfStock.checked && item.stockStatus === "out_of_stock") return false;
    return true;
  });
}

function syncSubtypeButtons() {
  for (const button of subtypeButtons) {
    const isActive = button.dataset.subtype === currentSubtype;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  }
}

function syncSortButton() {
  const isDesc = currentSort === "price-desc";
  sortButton.classList.toggle("is-desc", isDesc);
  sortButton.setAttribute("aria-label", isDesc ? "价格降序" : "价格升序");
  sortButton.title = isDesc ? "价格降序" : "价格升序";
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
    summary.textContent = `共 ${allProducts.length} 条商品。最近刷新：${time}`;
    render();
  } catch (error) {
    summary.textContent = `读取数据失败：${error.message}`;
    clearElement(productList);
    emptyState.hidden = true;
    console.error(error);
  }
}

for (const button of subtypeButtons) {
  button.addEventListener("click", () => {
    currentSubtype = button.dataset.subtype;
    syncSubtypeButtons();
    render({ animate: true });
  });
}

sortButton.addEventListener("click", () => {
  currentSort = currentSort === "price-asc" ? "price-desc" : "price-asc";
  syncSortButton();
  render({ animate: true });
});

includeOutOfStock.addEventListener("change", () => {
  render({ animate: true });
});

function syncBackToTop() {
  backToTop.classList.toggle("is-visible", window.scrollY > 360);
}

backToTop.addEventListener("click", () => {
  window.scrollTo({ top: 0, behavior: "smooth" });
});

window.addEventListener("scroll", syncBackToTop, { passive: true });

syncSubtypeButtons();
syncSortButton();
syncBackToTop();
loadData();
setInterval(loadData, DATA_RELOAD_INTERVAL_MS);
