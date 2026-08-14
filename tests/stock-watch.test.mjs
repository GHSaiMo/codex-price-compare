import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildStockWatchNotificationUpdates,
  createStockWatchEntryFromUrl,
  processStockWatchNotifications,
} from "../src/stock-watch.mjs";
import {
  DEFAULT_WECHATBRIDGE_TARGET,
  resolveWeChatBridgeConfig,
  sendWeChatBridgeText,
} from "../src/wechatbridge.mjs";

const stockWatchProducts = [
  {
    id: "ldxp-xiaoba:2mlvd7",
    title: "Gpt Free",
    sourceName: "Ai小八",
    price: 0.85,
    stockStatus: "out_of_stock",
    stockCount: 0,
    url: "https://pay.ldxp.cn/item/2mlvd7",
  },
];


assert.deepEqual(
  createStockWatchEntryFromUrl({
    products: stockWatchProducts,
    url: "https://pay.ldxp.cn/item/2mlvd7?utm_source=test#detail",
    now: new Date("2026-05-29T08:00:00.000Z"),
  }),
  {
    productId: "ldxp-xiaoba:2mlvd7",
    url: "https://pay.ldxp.cn/item/2mlvd7",
    title: "Gpt Free",
    sourceName: "Ai小八",
    enabled: true,
    targetPrice: null,
    createdAt: "2026-05-29T08:00:00.000Z",
    updatedAt: "2026-05-29T08:00:00.000Z",
    lastSeenAt: "2026-05-29T08:00:00.000Z",
    missingSince: null,
    lastPrice: 0.85,
    lastStockStatus: "out_of_stock",
    lastStockCount: 0,
    lastNotifiedAt: null,
    lastNotifyStatus: null,
    lastNotifyError: null,
    lastNotifiedPrice: null,
    lastNotifiedStockStatus: null,
    lastNotifiedStockCount: null,
    lastNotifyChangeKey: null,
  },
);
assert.throws(
  () => createStockWatchEntryFromUrl({ products: stockWatchProducts, url: "https://pay.ldxp.cn/item/not-found" }),
  /未在当前商品数据中找到这个链接/,
);
assert.deepEqual(
  buildStockWatchNotificationUpdates({
    watchItems: [{
      productId: "ldxp-xiaoba:2mlvd7",
      enabled: true,
      lastStockStatus: "out_of_stock",
      lastStockCount: 0,
      lastNotifyStatus: null,
    }],
    previousProducts: stockWatchProducts,
    currentProducts: [{
      ...stockWatchProducts[0],
      stockStatus: "in_stock",
      stockCount: 124,
    }],
    now: new Date("2026-05-29T08:30:00.000Z"),
  }).notifications.map((notification) => notification.entry.productId),
  ["ldxp-xiaoba:2mlvd7"],
);
assert.deepEqual(
  buildStockWatchNotificationUpdates({
    watchItems: [{
      productId: "ldxp-xiaoba:2mlvd7",
      enabled: true,
      lastPrice: 0.85,
      lastStockStatus: "out_of_stock",
      lastStockCount: 0,
      lastNotifyStatus: null,
    }],
    previousProducts: stockWatchProducts,
    currentProducts: [{
      ...stockWatchProducts[0],
      price: 0.95,
    }],
    now: new Date("2026-05-29T08:35:00.000Z"),
  }).notifications.map((notification) => ({
    productId: notification.entry.productId,
    changes: notification.changes,
  })),
  [],
);

assert.deepEqual(
  buildStockWatchNotificationUpdates({
    watchItems: [{
      productId: "ldxp-xiaoba:2mlvd7",
      enabled: true,
      lastPrice: 0.85,
      lastStockStatus: "in_stock",
      lastStockCount: 12,
      lastNotifyStatus: null,
    }],
    previousProducts: [{ ...stockWatchProducts[0], stockStatus: "in_stock", stockCount: 12, price: 0.85 }],
    currentProducts: [{ ...stockWatchProducts[0], stockStatus: "in_stock", stockCount: 9, price: 0.85 }],
    now: new Date("2026-05-29T08:40:00.000Z"),
  }).notifications,
  [],
);

assert.equal(
  buildStockWatchNotificationUpdates({
    watchItems: [{
      productId: "ldxp-xiaoba:2mlvd7",
      enabled: true,
      title: "Gpt Free",
      sourceName: "Ai小八",
      url: "https://pay.ldxp.cn/item/2mlvd7",
      lastSeenAt: "2026-05-01T00:00:00.000Z",
      lastNotifyStatus: null,
    }],
    previousProducts: stockWatchProducts,
    currentProducts: [],
    now: new Date("2026-05-29T08:45:00.000Z"),
  }).notifications[0]?.kind,
  "gone",
);

assert.deepEqual(
  buildStockWatchNotificationUpdates({
    watchItems: [{
      productId: "ldxp-xiaoba:2mlvd7",
      enabled: true,
      missingSince: "2026-05-29T08:45:00.000Z",
      lastNotifyChangeKey: "gone:2026-05-29T08:45:00.000Z",
      lastNotifyStatus: "sent",
    }],
    previousProducts: [],
    currentProducts: [],
    now: new Date("2026-05-29T09:45:00.000Z"),
  }).notifications,
  [],
);

assert.equal(
  buildStockWatchNotificationUpdates({
    watchItems: [{
      productId: "ldxp-xiaoba:2mlvd7",
      enabled: true,
      lastPrice: 140,
      lastStockStatus: "in_stock",
      lastStockCount: 3,
      lastNotifyStatus: null,
    }],
    previousProducts: [{ ...stockWatchProducts[0], price: 140, stockStatus: "in_stock", stockCount: 3 }],
    currentProducts: [{ ...stockWatchProducts[0], price: 120, stockStatus: "in_stock", stockCount: 3 }],
    now: new Date("2026-05-29T08:50:00.000Z"),
  }).notifications[0]?.kind,
  "price_drop",
);

assert.deepEqual(
  buildStockWatchNotificationUpdates({
    watchItems: [{
      productId: "ldxp-xiaoba:2mlvd7",
      enabled: true,
      lastPrice: 140,
      lastStockStatus: "in_stock",
      lastStockCount: 3,
      targetPrice: 120,
      lastNotifyStatus: null,
    }],
    previousProducts: [{ ...stockWatchProducts[0], price: 140, stockStatus: "in_stock", stockCount: 3 }],
    currentProducts: [{ ...stockWatchProducts[0], price: 130, stockStatus: "in_stock", stockCount: 3 }],
    now: new Date("2026-05-29T08:55:00.000Z"),
  }).notifications,
  [],
);

assert.equal(
  buildStockWatchNotificationUpdates({
    watchItems: [{
      productId: "ldxp-xiaoba:2mlvd7",
      enabled: true,
      lastPrice: 140,
      lastStockStatus: "in_stock",
      lastStockCount: 3,
      targetPrice: 120,
      lastNotifyStatus: null,
    }],
    previousProducts: [{ ...stockWatchProducts[0], price: 140, stockStatus: "in_stock", stockCount: 3 }],
    currentProducts: [{ ...stockWatchProducts[0], price: 119, stockStatus: "in_stock", stockCount: 3 }],
    now: new Date("2026-05-29T09:00:00.000Z"),
  }).notifications[0]?.kind,
  "price_drop",
);

assert.equal(DEFAULT_WECHATBRIDGE_TARGET, "");
assert.deepEqual(resolveWeChatBridgeConfig({}), {
  url: "http://127.0.0.1:5033/",
  target: "",
});
let bridgeRequest = null;
const bridgeResult = await sendWeChatBridgeText({
  text: "测试通知",
  target: "test-contact",
  fetchImpl: async (url, options) => {
    bridgeRequest = { url, options };
    return new Response('{"ok":true}', { status: 200 });
  },
});
assert.equal(bridgeRequest.url, "http://127.0.0.1:5033/");
assert.deepEqual(JSON.parse(bridgeRequest.options.body), {
  target: "test-contact",
  text: "测试通知",
});
assert.deepEqual(bridgeResult, { target: "test-contact", response: '{"ok":true}' });
await assert.rejects(
  sendWeChatBridgeText({
    text: "测试通知",
    fetchImpl: async () => new Response("bridge unavailable", { status: 503 }),
  }),
  /bridge unavailable/,
);

const watchTestDir = await mkdtemp(join(tmpdir(), "codex-price-compare-"));
try {
  const watchPath = join(watchTestDir, "stock-watch.json");
  const entry = createStockWatchEntryFromUrl({
    products: stockWatchProducts,
    url: stockWatchProducts[0].url,
    now: new Date("2026-05-29T08:00:00.000Z"),
  });
  await writeFile(watchPath, JSON.stringify({ version: 1, items: [entry] }));
  let notificationPayload = null;
  const result = await processStockWatchNotifications({
    watchPath,
    previousProducts: stockWatchProducts,
    currentProducts: [{ ...stockWatchProducts[0], stockStatus: "in_stock", stockCount: 12 }],
    bridgeUrl: "http://127.0.0.1:5033/",
    target: "test-contact",
    now: new Date("2026-05-29T08:30:00.000Z"),
    fetchImpl: async (_url, options) => {
      notificationPayload = JSON.parse(options.body);
      return new Response("OK", { status: 200 });
    },
  });
  assert.deepEqual(result, { notificationCount: 1, enabled: true });
  assert.equal(notificationPayload.target, "test-contact");
  assert.match(notificationPayload.text, /补货/);
  assert.deepEqual(Object.keys(notificationPayload).sort(), ["target", "text"]);
  const savedWatch = JSON.parse(await readFile(watchPath, "utf8"));
  assert.equal(savedWatch.items[0].lastNotifyStatus, "sent");
} finally {
  await rm(watchTestDir, { recursive: true, force: true });
}
