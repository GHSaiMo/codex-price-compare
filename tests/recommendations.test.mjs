import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isPrivateOrSpecialIp,
  validatePublicUrl,
  checkRateLimit,
  recordSubmission,
  clearRateLimitsForTesting,
  readRecommendations,
  writeRecommendations,
  addRecommendation,
  updateRecommendationStatus,
  deleteRecommendation,
  extractMetadataFromHtml,
  decodeHtmlEntities,
} from "../src/recommendations.mjs";

console.log("Testing recommendations module...");

// 1. IP checks for SSRF protection
assert.equal(isPrivateOrSpecialIp("127.0.0.1"), true, "127.0.0.1 should be private");
assert.equal(isPrivateOrSpecialIp("127.255.255.254"), true, "127.x.x.x should be private");
assert.equal(isPrivateOrSpecialIp("10.0.1.2"), true, "10.x.x.x should be private");
assert.equal(isPrivateOrSpecialIp("192.168.0.1"), true, "192.168.x.x should be private");
assert.equal(isPrivateOrSpecialIp("172.16.0.1"), true, "172.16.x.x should be private");
assert.equal(isPrivateOrSpecialIp("172.31.255.255"), true, "172.31.x.x should be private");
assert.equal(isPrivateOrSpecialIp("169.254.169.254"), true, "169.254.x.x (AWS metadata) should be private");
assert.equal(isPrivateOrSpecialIp("0.0.0.0"), true, "0.0.0.0 should be private");
assert.equal(isPrivateOrSpecialIp("::1"), true, "::1 should be private");
assert.equal(isPrivateOrSpecialIp("fe80::1"), true, "fe80:: link-local should be private");
assert.equal(isPrivateOrSpecialIp("fc00::1"), true, "fc00:: unique local should be private");
assert.equal(isPrivateOrSpecialIp("::ffff:127.0.0.1"), true, "::ffff:127.0.0.1 should be private");

// Public IPs should pass
assert.equal(isPrivateOrSpecialIp("8.8.8.8"), false, "8.8.8.8 should be public");
assert.equal(isPrivateOrSpecialIp("1.1.1.1"), false, "1.1.1.1 should be public");
assert.equal(isPrivateOrSpecialIp("114.114.114.114"), false, "114.114.114.114 should be public");

// 2. URL validation & SSRF protection
await assert.rejects(
  async () => await validatePublicUrl("javascript:alert(1)"),
  /仅支持 HTTP 或 HTTPS 链接/,
  "Should reject javascript scheme"
);
await assert.rejects(
  async () => await validatePublicUrl("data:text/html,test"),
  /仅支持 HTTP 或 HTTPS 链接/,
  "Should reject data scheme"
);
await assert.rejects(
  async () => await validatePublicUrl("http://127.0.0.1/admin"),
  /禁止提交内网或保留 IP 地址/,
  "Should reject loopback IP"
);
await assert.rejects(
  async () => await validatePublicUrl("http://localhost:49174/"),
  /禁止提交内网或本地主机地址/,
  "Should reject localhost"
);
await assert.rejects(
  async () => await validatePublicUrl("http://169.254.169.254/latest/meta-data"),
  /禁止提交内网或保留 IP 地址/,
  "Should reject cloud metadata"
);

const validUrl = await validatePublicUrl("https://example.com/shop/item?id=123");
assert.equal(validUrl.protocol, "https:");
assert.equal(validUrl.hostname, "example.com");

// 3. Rate limiting
clearRateLimitsForTesting();
const testIp = "203.0.113.42";
const now = 10000000;

// First submission
assert.equal(checkRateLimit(testIp, now).allowed, true);
recordSubmission(testIp, now);

// Consecutive submission within 30s
const tooFast = checkRateLimit(testIp, now + 5000);
assert.equal(tooFast.allowed, false);
assert.match(tooFast.reason, /提交过于频繁/);

// Second submission after 31s
assert.equal(checkRateLimit(testIp, now + 31000).allowed, true);
recordSubmission(testIp, now + 31000);

// Third submission after another 31s
assert.equal(checkRateLimit(testIp, now + 62000).allowed, true);
recordSubmission(testIp, now + 62000);

// Fourth submission within the same hour
const exceeded = checkRateLimit(testIp, now + 95000);
assert.equal(exceeded.allowed, false);
assert.match(exceeded.reason, /已达到每小时提交次数上限/);

// After 1 hour, allowed again
assert.equal(checkRateLimit(testIp, now + 3600001).allowed, true);

// 4. Persistence & CRUD in temporary file
const tempDir = await mkdtemp(join(tmpdir(), "rec-test-"));
const tempFile = join(tempDir, "recommendations.json");

try {
  // Empty file initially
  const initial = await readRecommendations(tempFile);
  assert.deepEqual(initial, { version: 1, items: [] });

  // Add recommendation
  const added = await addRecommendation(tempFile, {
    url: "https://shop.example.com/products/1",
    clientIp: "1.2.3.4",
    userAgent: "Mozilla/5.0",
    title: "优质测试店铺",
    description: "全网最低价",
  });
  assert.ok(added.id);
  assert.equal(added.url, "https://shop.example.com/products/1");
  assert.equal(added.domain, "shop.example.com");
  assert.equal(added.title, "优质测试店铺");
  assert.equal(added.status, "pending");

  const stored = await readRecommendations(tempFile);
  assert.equal(stored.items.length, 1);
  assert.equal(stored.items[0].id, added.id);

  // Update status to accepted
  const updated = await updateRecommendationStatus(tempFile, added.id, "accepted");
  assert.equal(updated.status, "accepted");

  // Invalid status should reject
  await assert.rejects(
    async () => await updateRecommendationStatus(tempFile, added.id, "invalid_status"),
    /无效的状态/
  );

  // Delete recommendation
  const removed = await deleteRecommendation(tempFile, added.id);
  assert.equal(removed.id, added.id);

  const afterDelete = await readRecommendations(tempFile);
  assert.equal(afterDelete.items.length, 0);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

// 5. HTML metadata extraction
const htmlSample = `
<!DOCTYPE html>
<html>
<head>
  <title>优选小店 &amp; 极速充值 - Codex Shop</title>
  <meta name="description" content="全网最优惠的Plus会员代充服务 &quot;诚信为本&quot;">
</head>
<body><h1>Shop</h1></body>
</html>
`;
const extracted = extractMetadataFromHtml(htmlSample);
assert.equal(extracted.title, "优选小店 & 极速充值 - Codex Shop");
assert.equal(extracted.description, '全网最优惠的Plus会员代充服务 "诚信为本"');

// OG Description fallback test
const ogHtml = `
<html>
<head>
  <title>OpenGraph Shop</title>
  <meta property="og:description" content="OG描述测试">
</head>
</html>
`;
const ogExtracted = extractMetadataFromHtml(ogHtml);
assert.equal(ogExtracted.title, "OpenGraph Shop");
assert.equal(ogExtracted.description, "OG描述测试");

// 6. End-to-End HTTP Server Integration Test
const httpTempDir = await mkdtemp(join(tmpdir(), "rec-http-test-"));
const httpRecFile = join(httpTempDir, "recommendations.json");

try {
  const server = http.createServer(async (req, res) => {
    const urlObj = new URL(req.url, "http://127.0.0.1");
    const sendJson = (status, payload) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    };

    if (req.method === "POST" && urlObj.pathname === "/api/recommendations") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");

      // Honeypot
      if (body._hp && String(body._hp).trim()) {
        sendJson(200, { ok: true });
        return;
      }

      // Timing
      const renderTime = Number(body._t);
      if (!renderTime || Date.now() - renderTime < 1500) {
        sendJson(400, { message: "提交过快，请稍后重试" });
        return;
      }

      // URL validation & SSRF
      try {
        const validated = await validatePublicUrl(String(body.url || ""));
        const newEntry = await addRecommendation(httpRecFile, {
          url: validated.href,
          clientIp: "127.0.0.1",
          userAgent: "TestAgent",
          title: "测试标题",
          description: "测试描述",
        });
        sendJson(200, { ok: true, id: newEntry.id });
      } catch (err) {
        sendJson(400, { message: err.message });
      }
      return;
    }

    if (req.method === "GET" && urlObj.pathname === "/api/recommendations") {
      const data = await readRecommendations(httpRecFile);
      sendJson(200, data);
      return;
    }

    const recMatch = urlObj.pathname.match(/^\/api\/recommendations\/([^/]+)$/);
    if (req.method === "PATCH" && recMatch) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      try {
        const updated = await updateRecommendationStatus(httpRecFile, decodeURIComponent(recMatch[1]), body.status);
        sendJson(200, { item: updated });
      } catch (err) {
        sendJson(err.statusCode || 400, { message: err.message });
      }
      return;
    }

    if (req.method === "DELETE" && recMatch) {
      try {
        const removed = await deleteRecommendation(httpRecFile, decodeURIComponent(recMatch[1]));
        sendJson(200, { removed });
      } catch (err) {
        sendJson(err.statusCode || 400, { message: err.message });
      }
      return;
    }

    sendJson(404, { message: "Not Found" });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  // Test 6.1: Honeypot drop
  const hpRes = await fetch(`${baseUrl}/api/recommendations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: "https://example.com/honeypot",
      _hp: "bot-payload",
      _t: Date.now() - 5000,
    }),
  });
  assert.equal(hpRes.status, 200);
  const hpData = await hpRes.json();
  assert.equal(hpData.ok, true);
  const hpSaved = await readRecommendations(httpRecFile);
  assert.equal(hpSaved.items.length, 0, "Honeypot submission must NOT be stored");

  // Test 6.2: Automated timing check (<1500ms)
  const timingRes = await fetch(`${baseUrl}/api/recommendations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: "https://example.com/timing",
      _hp: "",
      _t: Date.now() - 500,
    }),
  });
  assert.equal(timingRes.status, 400);

  // Test 6.3: SSRF blocked
  const ssrfRes = await fetch(`${baseUrl}/api/recommendations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: "http://127.0.0.1:8080/secret",
      _hp: "",
      _t: Date.now() - 5000,
    }),
  });
  assert.equal(ssrfRes.status, 400);

  // Test 6.4: Valid submission
  const validRes = await fetch(`${baseUrl}/api/recommendations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: "https://example.com/good-shop",
      _hp: "",
      _t: Date.now() - 5000,
    }),
  });
  assert.equal(validRes.status, 200);
  const validData = await validRes.json();
  assert.ok(validData.id);

  // Test 6.5: Admin GET list
  const listRes = await fetch(`${baseUrl}/api/recommendations`);
  assert.equal(listRes.status, 200);
  const listData = await listRes.json();
  assert.equal(listData.items.length, 1);
  assert.equal(listData.items[0].id, validData.id);

  // Test 6.6: Admin PATCH status
  const patchRes = await fetch(`${baseUrl}/api/recommendations/${validData.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "accepted" }),
  });
  assert.equal(patchRes.status, 200);
  const patchData = await patchRes.json();
  assert.equal(patchData.item.status, "accepted");

  // Test 6.7: Admin DELETE
  const delRes = await fetch(`${baseUrl}/api/recommendations/${validData.id}`, {
    method: "DELETE",
  });
  assert.equal(delRes.status, 200);
  const finalList = await readRecommendations(httpRecFile);
  assert.equal(finalList.items.length, 0);

  await new Promise((resolve) => server.close(resolve));
} finally {
  await rm(httpTempDir, { recursive: true, force: true });
}

console.log("All recommendation module tests passed!");
