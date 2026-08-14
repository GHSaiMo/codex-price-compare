export const PUBLIC_STATIC_PATHS = new Set([
  "/",
  "/index.html",
  "/app.js",
  "/theme.js",
  "/styles.css",
  "/sources.html",
  "/sources.js",
  "/source-sort.js",
  "/assets/logo.svg",
  "/assets/qrcode-generator.js",
  "/data/products.json",
  "/data/meta.json",
  "/data/sources.json",
]);

const PUBLIC_PRODUCT_KEYS = [
  "id",
  "brand",
  "category",
  "subtype",
  "durationDays",
  "durationLabel",
  "title",
  "price",
  "currency",
  "stockStatus",
  "stockCount",
  "url",
  "sourceId",
  "sourceName",
  "sourceUrl",
  "sourceAdapter",
  "sourceCategory",
  "fetchedAt",
];

export function isPublicStaticPath(pathname) {
  return PUBLIC_STATIC_PATHS.has(pathname);
}

export function toPublicProductItem(item) {
  const product = {};
  for (const key of PUBLIC_PRODUCT_KEYS) {
    if (item?.[key] !== undefined) product[key] = item[key];
  }
  return product;
}

export function toPublicProductsDocument(products) {
  const items = Array.isArray(products?.items) ? products.items.map(toPublicProductItem) : [];
  return {
    generatedAt: products?.generatedAt || null,
    brands: products?.brands || [],
    categories: products?.categories || [],
    items,
  };
}

export function toPublicMeta(meta) {
  if (!meta || typeof meta !== "object") return {};
  const { backup, sources, ...publicMeta } = meta;
  return publicMeta;
}
