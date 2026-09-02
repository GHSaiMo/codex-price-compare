import { readdir, readFile } from "node:fs/promises";
import { writeJsonAtomic } from "./fs-atomic.mjs";

const DEFAULT_HISTORY = { version: 1, items: {} };
const HISTORY_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const MIN_POINT_INTERVAL_MS = 50 * 60 * 1000;
const MAX_BACKFILL_FILES = 28;

export function createHistoryPoint(product, at = new Date()) {
  return {
    t: at instanceof Date ? at.toISOString() : String(at),
    p: typeof product?.price === "number" && Number.isFinite(product.price) ? product.price : null,
    s: product?.stockStatus || "unknown",
    c: typeof product?.stockCount === "number" && Number.isFinite(product.stockCount) ? product.stockCount : null,
  };
}

export function appendHistoryPoints(history, {
  productIds = [],
  products = [],
  now = new Date(),
  minIntervalMs = MIN_POINT_INTERVAL_MS,
} = {}) {
  const data = normalizeHistory(history);
  const productMap = new Map(products.filter((item) => item?.id).map((item) => [item.id, item]));
  const timestamp = now instanceof Date ? now : new Date(now);
  for (const productId of productIds) {
    const product = productMap.get(productId);
    if (!product) continue;
    const point = createHistoryPoint(product, timestamp);
    const series = data.items[productId] || { points: [] };
    const last = series.points[series.points.length - 1];
    if (last && !shouldAppendPoint(last, point, timestamp, minIntervalMs)) continue;
    series.points = [...series.points, point];
    data.items[productId] = series;
  }
  return data;
}

export function pruneHistory(history, {
  now = new Date(),
  retentionMs = HISTORY_RETENTION_MS,
  keepIds = null,
} = {}) {
  const data = normalizeHistory(history);
  const cutoff = now.getTime() - retentionMs;
  const allowed = keepIds ? new Set(keepIds) : null;
  const items = {};
  for (const [productId, series] of Object.entries(data.items)) {
    if (allowed && !allowed.has(productId)) continue;
    const points = (series?.points || []).filter((point) => {
      const time = new Date(point.t).getTime();
      return Number.isFinite(time) && time >= cutoff;
    });
    if (points.length > 0) items[productId] = { points };
  }
  return { version: 1, items };
}

export function summarizeHistory(points = []) {
  const priced = points.filter((point) => typeof point?.p === "number");
  if (priced.length === 0) {
    return { count: points.length, low: null, high: null, last: points[points.length - 1] || null };
  }
  let low = priced[0];
  let high = priced[0];
  for (const point of priced) {
    if (point.p < low.p) low = point;
    if (point.p > high.p) high = point;
  }
  return {
    count: points.length,
    low: low.p,
    high: high.p,
    last: points[points.length - 1],
  };
}

export async function readPriceHistory(path) {
  try {
    return normalizeHistory(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return structuredClone(DEFAULT_HISTORY);
  }
}

export async function writePriceHistory(path, history) {
  await writeJsonAtomic(path, normalizeHistory(history));
}

export async function updateWatchPriceHistory({
  historyPath,
  backupDir = null,
  productIds = [],
  products = [],
  now = new Date(),
} = {}) {
  let history = await readPriceHistory(historyPath);
  const ids = [...new Set(productIds.filter(Boolean))];
  const needsBackfill = ids.filter((id) => (history.items[id]?.points?.length || 0) < 8);
  if (backupDir && needsBackfill.length > 0) {
    history = await backfillHistoryFromBackups({
      history,
      backupDir,
      productIds: needsBackfill,
      now,
    });
  }
  history = appendHistoryPoints(history, { productIds: ids, products, now });
  history = pruneHistory(history, { now, keepIds: ids });
  await writePriceHistory(historyPath, history);
  return history;
}

export async function backfillHistoryFromBackups({
  history,
  backupDir,
  productIds = [],
  now = new Date(),
  maxFiles = MAX_BACKFILL_FILES,
} = {}) {
  const data = normalizeHistory(history);
  const ids = [...new Set(productIds.filter(Boolean))];
  if (!backupDir || ids.length === 0) return data;

  let names = [];
  try {
    names = (await readdir(backupDir)).filter((name) => name.endsWith("-products.json"));
  } catch {
    return data;
  }

  const snapshots = names
    .map((name) => ({ name, at: parseBackupNameDate(name) }))
    .filter((entry) => entry.at)
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  const picked = pickEvenlySpaced(snapshots, maxFiles);

  for (const snapshot of picked) {
    let products;
    try {
      products = JSON.parse(await readFile(new URL(snapshot.name, backupDir), "utf8"))?.items || [];
    } catch {
      continue;
    }
    for (const product of products) {
      if (!ids.includes(product.id)) continue;
      const point = createHistoryPoint(product, snapshot.at);
      const series = data.items[product.id] || { points: [] };
      const last = series.points[series.points.length - 1];
      if (last && last.t === point.t) continue;
      series.points.push(point);
      data.items[product.id] = series;
    }
  }

  for (const productId of ids) {
    const series = data.items[productId];
    if (!series) continue;
    series.points.sort((a, b) => String(a.t).localeCompare(String(b.t)));
  }
  return pruneHistory(data, { now, keepIds: ids });
}

function parseBackupNameDate(filename) {
  const match = String(filename || "").match(/^(\d{4}-\d{2}-\d{2}T)(\d{2})-(\d{2})-(\d{2})-(\d{3}Z)-/);
  if (!match) return null;
  const date = new Date(`${match[1]}${match[2]}:${match[3]}:${match[4]}.${match[5]}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function shouldAppendPoint(last, next, now, minIntervalMs) {
  if (last.p !== next.p || last.s !== next.s || last.c !== next.c) return true;
  const lastTime = new Date(last.t).getTime();
  return !Number.isFinite(lastTime) || now.getTime() - lastTime >= minIntervalMs;
}

function pickEvenlySpaced(items, maxCount) {
  if (items.length <= maxCount) return items;
  const picked = [];
  const lastIndex = items.length - 1;
  for (let i = 0; i < maxCount; i += 1) {
    const index = Math.round((i * lastIndex) / (maxCount - 1));
    if (picked.length === 0 || picked[picked.length - 1] !== items[index]) {
      picked.push(items[index]);
    }
  }
  return picked;
}

function normalizeHistory(data) {
  const items = {};
  if (data?.items && typeof data.items === "object") {
    for (const [productId, series] of Object.entries(data.items)) {
      const points = Array.isArray(series?.points) ? series.points.filter((point) => point?.t) : [];
      if (points.length > 0) items[productId] = { points };
    }
  }
  return { version: 1, items };
}
