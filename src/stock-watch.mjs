import { readFile, writeFile } from "node:fs/promises";

const DEFAULT_WATCH_DATA = { version: 1, items: [] };
const NOTIFY_RETRY_AFTER_MS = 10 * 60 * 1000;

export function normalizeProductUrl(value) {
  const url = new URL(String(value || "").trim());
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/u, "") || "/";
  return url.href;
}

export function findProductByUrl(products, url) {
  const targetUrl = normalizeProductUrl(url);
  return products.find((item) => item?.url && normalizeProductUrl(item.url) === targetUrl) || null;
}

export function createStockWatchEntryFromUrl({ products, url, now = new Date() }) {
  const product = findProductByUrl(products, url);
  if (!product) {
    const err = new Error("未在当前商品数据中找到这个链接，请确认商品已被采集并刷新过。");
    err.statusCode = 404;
    throw err;
  }

  const timestamp = now.toISOString();
  return {
    productId: product.id,
    url: product.url,
    title: product.title,
    sourceName: product.sourceName,
    enabled: true,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastSeenAt: timestamp,
    lastStockStatus: product.stockStatus || "unknown",
    lastStockCount: typeof product.stockCount === "number" ? product.stockCount : null,
    lastNotifiedAt: null,
    lastNotifyStatus: null,
    lastNotifyError: null,
    lastNotifiedStockStatus: null,
  };
}

export async function readStockWatch(path) {
  try {
    const data = JSON.parse(await readFile(path, "utf8"));
    return normalizeWatchData(data);
  } catch {
    return structuredClone(DEFAULT_WATCH_DATA);
  }
}

export async function writeStockWatch(path, data) {
  await writeFile(path, `${JSON.stringify(normalizeWatchData(data), null, 2)}\n`);
}

export function upsertStockWatchEntry(watchData, entry) {
  const data = normalizeWatchData(watchData);
  const index = data.items.findIndex((item) => item.productId === entry.productId);
  if (index === -1) {
    data.items.push(entry);
    return data;
  }

  data.items[index] = {
    ...data.items[index],
    ...entry,
    createdAt: data.items[index].createdAt || entry.createdAt,
    lastNotifiedAt: data.items[index].lastNotifiedAt ?? entry.lastNotifiedAt,
    lastNotifyStatus: data.items[index].lastNotifyStatus ?? entry.lastNotifyStatus,
    lastNotifyError: data.items[index].lastNotifyError ?? entry.lastNotifyError,
    lastNotifiedStockStatus: data.items[index].lastNotifiedStockStatus ?? entry.lastNotifiedStockStatus,
  };
  return data;
}

export function removeStockWatchEntry(watchData, productId) {
  const data = normalizeWatchData(watchData);
  data.items = data.items.filter((item) => item.productId !== productId);
  return data;
}

export function buildStockWatchView(watchItems, currentProducts = []) {
  const currentById = productMap(currentProducts);
  return watchItems.map((entry) => {
    const product = currentById.get(entry.productId);
    return {
      ...entry,
      current: product ? publicProductFields(product) : null,
    };
  });
}

export function buildStockWatchNotificationUpdates({
  watchItems,
  previousProducts = [],
  currentProducts = [],
  now = new Date(),
  retryAfterMs = NOTIFY_RETRY_AFTER_MS,
}) {
  const previousById = productMap(previousProducts);
  const currentById = productMap(currentProducts);
  const timestamp = now.toISOString();
  const notifications = [];
  const items = watchItems.map((entry) => {
    if (!entry.enabled) return entry;

    const previous = previousById.get(entry.productId);
    const current = currentById.get(entry.productId);
    if (!current) return { ...entry, updatedAt: timestamp };

    const previousStatus = previous?.stockStatus || entry.lastStockStatus || "unknown";
    const currentStatus = current.stockStatus || "unknown";
    const nextEntry = {
      ...entry,
      title: current.title || entry.title,
      sourceName: current.sourceName || entry.sourceName,
      url: current.url || entry.url,
      updatedAt: timestamp,
      lastSeenAt: timestamp,
      lastStockStatus: currentStatus,
      lastStockCount: typeof current.stockCount === "number" ? current.stockCount : null,
      ...(currentStatus === "out_of_stock" ? { lastNotifiedStockStatus: null } : {}),
    };

    const becameAvailable = previousStatus === "out_of_stock" && isAvailableStatus(currentStatus);
    const canRetry = entry.lastNotifyStatus === "failed" && isAvailableStatus(currentStatus)
      && shouldRetry(entry.updatedAt, now, retryAfterMs);
    const alreadyNotified = entry.lastNotifyStatus === "sent" && entry.lastNotifiedStockStatus === currentStatus;
    if ((becameAvailable || canRetry) && !alreadyNotified) {
      notifications.push({
        entry: nextEntry,
        previous: previous ? publicProductFields(previous) : null,
        current: publicProductFields(current),
      });
    }

    return nextEntry;
  });

  return { items, notifications };
}

export async function processStockWatchNotifications({
  watchPath,
  previousProducts = [],
  currentProducts = [],
  gatewayUrl = process.env.WEIXIN_GATEWAY_ALERT_URL || "http://127.0.0.1:8787/alerts/send",
  target = process.env.WEIXIN_GATEWAY_ALERT_TARGET || "self",
  enabled = process.env.STOCK_NOTIFY_ENABLED !== "0",
  now = new Date(),
  fetchImpl = fetch,
} = {}) {
  const watchData = await readStockWatch(watchPath);
  const updates = buildStockWatchNotificationUpdates({
    watchItems: watchData.items,
    previousProducts,
    currentProducts,
    now,
  });
  let items = updates.items;
  if (enabled) {
    for (const notification of updates.notifications) {
      items = await sendStockNotification({
        items,
        notification,
        gatewayUrl,
        target,
        now,
        fetchImpl,
      });
    }
  }

  await writeStockWatch(watchPath, { version: 1, items });
  return { notificationCount: enabled ? updates.notifications.length : 0, enabled };
}

async function sendStockNotification({ items, notification, gatewayUrl, target, now, fetchImpl }) {
  const timestamp = now.toISOString();
  const { entry, current } = notification;
  try {
    const response = await fetchImpl(gatewayUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        target,
        text: formatNotificationText(current),
        alertId: `stock:${entry.productId}:${current.stockStatus}`,
      }),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(body || `gateway HTTP ${response.status}`);
    return updateNotificationStatus(items, entry.productId, {
      lastNotifiedAt: timestamp,
      lastNotifyStatus: "sent",
      lastNotifyError: null,
      lastNotifiedStockStatus: current.stockStatus,
    });
  } catch (error) {
    return updateNotificationStatus(items, entry.productId, {
      lastNotifyStatus: "failed",
      lastNotifyError: error instanceof Error ? error.message : String(error),
    });
  }
}

function updateNotificationStatus(items, productId, fields) {
  return items.map((entry) => entry.productId === productId ? { ...entry, ...fields } : entry);
}

function formatNotificationText(product) {
  const price = typeof product.price === "number" ? `¥${product.price}` : "价格未知";
  const stock = product.stockCount == null ? product.stockStatus : `${product.stockStatus} ${product.stockCount}`;
  return [
    "补货提醒",
    `商品：${product.title}`,
    `来源：${product.sourceName}`,
    `价格：${price}`,
    `库存：${stock}`,
    `链接：${product.url}`,
  ].join("\n");
}

function isAvailableStatus(status) {
  return status === "in_stock" || status === "low_stock";
}

function shouldRetry(lastUpdatedAt, now, retryAfterMs) {
  const last = new Date(lastUpdatedAt || 0).getTime();
  return !Number.isFinite(last) || now.getTime() - last >= retryAfterMs;
}

function productMap(products) {
  return new Map(products.filter((item) => item?.id).map((item) => [item.id, item]));
}

function publicProductFields(product) {
  return {
    id: product.id,
    title: product.title,
    sourceName: product.sourceName,
    price: product.price,
    stockStatus: product.stockStatus || "unknown",
    stockCount: typeof product.stockCount === "number" ? product.stockCount : null,
    url: product.url,
  };
}

function normalizeWatchData(data) {
  const items = Array.isArray(data?.items) ? data.items.filter((item) => item?.productId) : [];
  return { version: 1, items };
}
