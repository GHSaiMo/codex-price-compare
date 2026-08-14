import { readFile, writeFile } from "node:fs/promises";

import { resolveWeChatBridgeConfig, sendWeChatBridgeText } from "./wechatbridge.mjs";

const DEFAULT_WATCH_DATA = { version: 1, digestEnabled: false, lastDigestAt: null, items: [] };
const NOTIFY_RETRY_AFTER_MS = 10 * 60 * 1000;
const DIGEST_INTERVAL_MS = 24 * 60 * 60 * 1000;
const PRICE_DROP_RATIO = 0.1;

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

export function createStockWatchEntryFromUrl({ products, url, targetPrice = null, now = new Date() }) {
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
    targetPrice: normalizeTargetPrice(targetPrice),
    createdAt: timestamp,
    updatedAt: timestamp,
    lastSeenAt: timestamp,
    missingSince: null,
    lastPrice: productPrice(product),
    lastStockStatus: product.stockStatus || "unknown",
    lastStockCount: typeof product.stockCount === "number" ? product.stockCount : null,
    lastNotifiedAt: null,
    lastNotifyStatus: null,
    lastNotifyError: null,
    lastNotifiedPrice: null,
    lastNotifiedStockStatus: null,
    lastNotifiedStockCount: null,
    lastNotifyChangeKey: null,
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
    targetPrice: entry.targetPrice ?? data.items[index].targetPrice ?? null,
    lastNotifiedAt: data.items[index].lastNotifiedAt ?? entry.lastNotifiedAt,
    lastNotifyStatus: data.items[index].lastNotifyStatus ?? entry.lastNotifyStatus,
    lastNotifyError: data.items[index].lastNotifyError ?? entry.lastNotifyError,
    lastNotifiedPrice: data.items[index].lastNotifiedPrice ?? entry.lastNotifiedPrice,
    lastNotifiedStockStatus: data.items[index].lastNotifiedStockStatus ?? entry.lastNotifiedStockStatus,
    lastNotifiedStockCount: data.items[index].lastNotifiedStockCount ?? entry.lastNotifiedStockCount,
    lastNotifyChangeKey: data.items[index].lastNotifyChangeKey ?? entry.lastNotifyChangeKey,
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
  digestEnabled = false,
  lastDigestAt = null,
  digestIntervalMs = DIGEST_INTERVAL_MS,
} = {}) {
  const previousById = productMap(previousProducts);
  const currentById = productMap(currentProducts);
  const timestamp = now.toISOString();
  const notifications = [];
  const items = watchItems.map((entry) => {
    if (!entry.enabled) return entry;

    const previous = previousById.get(entry.productId);
    const current = currentById.get(entry.productId);
    if (!current) {
      const nextEntry = {
        ...entry,
        updatedAt: timestamp,
        missingSince: entry.missingSince || timestamp,
      };
      const changeKey = `gone:${nextEntry.missingSince}`;
      const canRetry = entry.lastNotifyStatus === "failed" && shouldRetry(entry.updatedAt, now, retryAfterMs);
      const alreadyNotified = entry.lastNotifyChangeKey === changeKey && entry.lastNotifyStatus === "sent";
      if ((!entry.missingSince || canRetry) && !alreadyNotified) {
        notifications.push({
          kind: "gone",
          entry: nextEntry,
          changes: [{ type: "gone" }],
          changeKey,
          previous: previous ? publicProductFields(previous) : null,
          current: null,
        });
      }
      return nextEntry;
    }

    const previousSnapshot = watchSnapshot(previous, entry);
    const currentStatus = current.stockStatus || "unknown";
    const currentCount = typeof current.stockCount === "number" ? current.stockCount : null;
    const currentPrice = productPrice(current);
    const nextEntry = {
      ...entry,
      title: current.title || entry.title,
      sourceName: current.sourceName || entry.sourceName,
      url: current.url || entry.url,
      updatedAt: timestamp,
      lastSeenAt: timestamp,
      missingSince: null,
      lastPrice: currentPrice,
      lastStockStatus: currentStatus,
      lastStockCount: currentCount,
    };

    const changes = selectWatchEvents(previousSnapshot, {
      price: currentPrice,
      stockStatus: currentStatus,
      stockCount: currentCount,
    }, entry);
    const changeKey = changes.length > 0
      ? `${formatChangeKey(changes)}:${timestamp}`
      : entry.lastNotifyChangeKey || formatSnapshotKey({
        price: currentPrice,
        stockStatus: currentStatus,
        stockCount: currentCount,
      });
    const canRetry = entry.lastNotifyStatus === "failed"
      && changes.length > 0
      && shouldRetry(entry.updatedAt, now, retryAfterMs);
    const alreadyNotified = entry.lastNotifyStatus === "sent"
      && entry.lastNotifyChangeKey === changeKey;
    if ((changes.length > 0 || canRetry) && !alreadyNotified) {
      notifications.push({
        kind: changes[0]?.type || "change",
        entry: nextEntry,
        changes,
        changeKey,
        previous: previous ? publicProductFields(previous) : null,
        current: publicProductFields(current),
      });
    }

    return nextEntry;
  });

  let nextDigestAt = lastDigestAt || null;
  if (digestEnabled) {
    if (!lastDigestAt) {
      nextDigestAt = timestamp;
    } else if (now.getTime() - new Date(lastDigestAt).getTime() >= digestIntervalMs) {
      notifications.push({
        kind: "digest",
        entries: items.filter((entry) => entry.enabled),
      });
      nextDigestAt = timestamp;
    }
  }

  return { items, notifications, lastDigestAt: nextDigestAt };
}

export async function processStockWatchNotifications({
  watchPath,
  previousProducts = [],
  currentProducts = [],
  bridgeUrl = resolveWeChatBridgeConfig().url,
  target = resolveWeChatBridgeConfig().target,
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
    digestEnabled: watchData.digestEnabled === true,
    lastDigestAt: watchData.lastDigestAt,
  });
  let items = updates.items;
  let lastDigestAt = updates.lastDigestAt;
  if (enabled) {
    for (const notification of updates.notifications) {
      if (notification.kind === "digest") {
        try {
          await sendWeChatBridgeText({
            url: bridgeUrl,
            target,
            text: formatDigestText(notification.entries),
            fetchImpl,
          });
        } catch {
          lastDigestAt = watchData.lastDigestAt || null;
        }
        continue;
      }
      items = await sendStockNotification({
        items,
        notification,
        bridgeUrl,
        target,
        now,
        fetchImpl,
      });
    }
  }

  await writeStockWatch(watchPath, {
    version: 1,
    digestEnabled: watchData.digestEnabled === true,
    lastDigestAt,
    items,
  });
  return { notificationCount: enabled ? updates.notifications.length : 0, enabled };
}

async function sendStockNotification({ items, notification, bridgeUrl, target, now, fetchImpl }) {
  const timestamp = now.toISOString();
  const { entry, current } = notification;
  try {
    await sendWeChatBridgeText({
      url: bridgeUrl,
      target,
      text: formatNotificationText(notification),
      fetchImpl,
    });
    return updateNotificationStatus(items, entry.productId, {
      lastNotifiedAt: timestamp,
      lastNotifyStatus: "sent",
      lastNotifyError: null,
      lastNotifiedPrice: current ? productPrice(current) : entry.lastPrice,
      lastNotifiedStockStatus: current?.stockStatus || "missing",
      lastNotifiedStockCount: normalizeStockCount(current?.stockCount),
      lastNotifyChangeKey: notification.changeKey,
    });
  } catch (error) {
    return updateNotificationStatus(items, entry.productId, {
      lastNotifyStatus: "failed",
      lastNotifyError: error instanceof Error ? error.message : String(error),
      lastNotifyChangeKey: notification.changeKey,
    });
  }
}

function updateNotificationStatus(items, productId, fields) {
  return items.map((entry) => entry.productId === productId ? { ...entry, ...fields } : entry);
}

function formatNotificationText(notification) {
  const { kind, current, entry, changes = [] } = notification;
  if (kind === "gone") {
    return [
      "商品消失提醒",
      `商品：${entry.title}`,
      `来源：${entry.sourceName || "未知来源"}`,
      `上次见到：${entry.lastSeenAt || "未知"}`,
      `链接：${entry.url}`,
    ].join("\n");
  }

  const changeLines = changes.map((change) => {
    if (change.type === "price_drop") {
      const target = typeof change.targetPrice === "number" ? `，阈值 ${formatPrice(change.targetPrice)}` : "";
      return `降价：${formatPrice(change.previous)} -> ${formatPrice(change.current)}${target}`;
    }
    if (change.type === "restock") {
      return `补货：${formatStock(change.previous)} -> ${formatStock(change.current)}`;
    }
    return `变化：${change.type}`;
  });
  const title = kind === "restock" ? "补货提醒" : kind === "price_drop" ? "到价提醒" : "价格/库存变动提醒";
  return [
    title,
    `商品：${current.title}`,
    `来源：${current.sourceName}`,
    ...changeLines,
    `当前价格：${formatPrice(current.price)}`,
    `当前库存：${formatStock(current)}`,
    `链接：${current.url}`,
  ].join("\n");
}

function formatDigestText(entries = []) {
  const lines = entries.map((entry) => {
    const missing = entry.missingSince ? "已消失" : formatStock({
      status: entry.lastStockStatus,
      count: entry.lastStockCount,
    });
    return `- ${entry.title} · ${entry.sourceName || "未知来源"} · ${formatPrice(entry.lastPrice)} · ${missing}`;
  });
  return ["观察区日报", `共 ${entries.length} 条`, ...lines].join("\n");
}

function shouldRetry(lastUpdatedAt, now, retryAfterMs) {
  const last = new Date(lastUpdatedAt || 0).getTime();
  return !Number.isFinite(last) || now.getTime() - last >= retryAfterMs;
}

export function selectWatchEvents(previous, current, entry = {}) {
  const changes = [];
  if (entry.missingSince) {
    changes.push({
      type: "restock",
      previous: { status: "missing", count: null },
      current: { status: current.stockStatus, count: current.stockCount },
    });
  } else if (isOutOfStockStatus(previous.stockStatus) && isInStockStatus(current.stockStatus)) {
    changes.push({
      type: "restock",
      previous: { status: previous.stockStatus, count: previous.stockCount },
      current: { status: current.stockStatus, count: current.stockCount },
    });
  }

  if (previous.hasPrice && previous.price != null && current.price != null && current.price < previous.price) {
    const targetPrice = normalizeTargetPrice(entry.targetPrice);
    const crossedTarget = targetPrice != null && previous.price > targetPrice && current.price <= targetPrice;
    const significantDrop = current.price <= previous.price * (1 - PRICE_DROP_RATIO);
    if (crossedTarget || significantDrop) {
      changes.push({
        type: "price_drop",
        previous: previous.price,
        current: current.price,
        targetPrice,
      });
    }
  }
  return changes;
}

function isInStockStatus(status) {
  return status === "in_stock" || status === "low_stock";
}

function isOutOfStockStatus(status) {
  return status === "out_of_stock";
}

function watchSnapshot(product, entry = null) {
  const hasProduct = product && typeof product === "object";
  const hasEntryPrice = entry ? Object.hasOwn(entry, "lastPrice") : false;
  return {
    hasPrice: hasProduct || hasEntryPrice,
    price: hasProduct ? productPrice(product) : entry.lastPrice ?? null,
    stockStatus: hasProduct ? product.stockStatus || "unknown" : entry.lastStockStatus || "unknown",
    stockCount: normalizeStockCount(hasProduct ? product.stockCount : entry.lastStockCount),
  };
}

function productPrice(product) {
  return typeof product?.price === "number" && Number.isFinite(product.price) ? product.price : null;
}

function normalizeStockCount(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatPrice(price) {
  return typeof price === "number" ? `¥${price}` : "价格未知";
}

function formatStock(value) {
  const status = value?.stockStatus || value?.status || "unknown";
  const count = normalizeStockCount(value?.stockCount ?? value?.count);
  const label = {
    in_stock: "有货",
    low_stock: "低库存",
    out_of_stock: "缺货",
    missing: "已消失",
    unknown: "库存未知",
  }[status] || status;
  return count == null ? label : `${label} ${count}`;
}

function formatChangeKey(changes) {
  return changes.map((change) => {
    if (change.type === "gone") return "gone";
    if (change.type === "price_drop") {
      return `price_drop:${formatKeyValue(change.previous)}>${formatKeyValue(change.current)}`;
    }
    if (change.type === "restock") {
      return [
        "restock",
        `${formatKeyValue(change.previous.status)}-${formatKeyValue(change.previous.count)}`,
        `${formatKeyValue(change.current.status)}-${formatKeyValue(change.current.count)}`,
      ].join(":");
    }
    return change.type;
  }).join("|");
}

function formatSnapshotKey(snapshot) {
  return [
    `price:${formatKeyValue(snapshot.price)}`,
    `stock:${formatKeyValue(snapshot.stockStatus)}-${formatKeyValue(snapshot.stockCount)}`,
  ].join("|");
}

function formatKeyValue(value) {
  return value == null ? "null" : String(value).replace(/[^a-z0-9._-]/giu, "_");
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

export function updateStockWatchSettings(watchData, { digestEnabled } = {}) {
  const data = normalizeWatchData(watchData);
  if (digestEnabled !== undefined) data.digestEnabled = digestEnabled === true;
  return data;
}

function normalizeTargetPrice(value) {
  const price = Number(value);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function normalizeWatchData(data) {
  const items = Array.isArray(data?.items) ? data.items.filter((item) => item?.productId) : [];
  return {
    version: 1,
    digestEnabled: data?.digestEnabled === true,
    lastDigestAt: data?.lastDigestAt || null,
    items,
  };
}
