import { createReadStream } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

import { refreshProducts } from "./src/refresh.mjs";

const PORT = 49173;
const ADMIN_PORT = 49174;
const DEFAULT_REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const ROOT = fileURLToPath(new URL(".", import.meta.url));
const sourcesPath = join(ROOT, "data/sources.json");
const metaPath = join(ROOT, "data/meta.json");
const refreshSettingsPath = join(ROOT, "data/refresh-settings.json");
const knownAdapters = new Set(["ldxp", "acg", "dujiao"]);
let refreshTimer = null;
let refreshInProgress = false;
let refreshIntervalMs = DEFAULT_REFRESH_INTERVAL_MS;

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
};

function resolvePath(requestUrl, defaultFile, port) {
  const { pathname } = new URL(requestUrl, `http://127.0.0.1:${port}`);
  const decodedPath = decodeURIComponent(pathname);
  const normalizedPath = normalize(decodedPath).replace(/^(\.\.[/\\])+/, "");
  const relativePath = normalizedPath === "/" ? defaultFile : normalizedPath.slice(1);
  return join(ROOT, relativePath);
}

async function existingFileOrDefault(filePath, defaultFile) {
  try {
    const fileStat = await stat(filePath);
    if (fileStat.isFile()) return filePath;
  } catch {
    return join(ROOT, defaultFile);
  }
  return join(ROOT, defaultFile);
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function tokenFromUrl(urlValue) {
  const url = new URL(urlValue);
  const match = url.pathname.match(/\/shop\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

async function readRequestJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function loadRefreshSettings() {
  try {
    const settings = JSON.parse(await readFile(refreshSettingsPath, "utf8"));
    const intervalMs = Number(settings.intervalMs);
    if (Number.isFinite(intervalMs) && intervalMs >= 60 * 1000) {
      refreshIntervalMs = intervalMs;
    }
  } catch {
    await writeRefreshSettings();
  }
}

async function writeRefreshSettings() {
  await writeFile(refreshSettingsPath, `${JSON.stringify({ intervalMs: refreshIntervalMs }, null, 2)}\n`);
}

async function updateRefreshMeta(nextRefreshAt) {
  try {
    const meta = JSON.parse(await readFile(metaPath, "utf8"));
    meta.nextRefreshAt = nextRefreshAt;
    await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
  } catch (error) {
    console.error(`刷新状态写入失败：${error.message}`);
  }
}

function scheduleNextRefresh(delayMs = refreshIntervalMs) {
  if (refreshTimer) clearTimeout(refreshTimer);
  const nextRefreshAt = new Date(Date.now() + delayMs).toISOString();
  void updateRefreshMeta(nextRefreshAt);
  refreshTimer = setTimeout(runScheduledRefresh, delayMs);
  return nextRefreshAt;
}

async function runScheduledRefresh() {
  if (refreshInProgress) {
    scheduleNextRefresh(60 * 1000);
    return;
  }

  refreshInProgress = true;
  const nextRefreshAt = new Date(Date.now() + refreshIntervalMs).toISOString();
  try {
    const meta = await refreshProducts({ nextRefreshAt });
    console.log(`自动刷新完成：${meta.itemCount} 条商品，成功 ${meta.successCount}/${meta.sourceCount} 个信息源`);
    if (meta.errors.length > 0) console.log(JSON.stringify(meta.errors, null, 2));
  } catch (error) {
    console.error(`自动刷新失败：${error.message}`);
    await updateRefreshMeta(nextRefreshAt);
  } finally {
    refreshInProgress = false;
    scheduleNextRefresh(refreshIntervalMs);
  }
}

async function refreshStatus() {
  let meta = {};
  try {
    meta = JSON.parse(await readFile(metaPath, "utf8"));
  } catch {
    meta = {};
  }
  return {
    intervalMs: refreshIntervalMs,
    intervalMinutes: Math.round(refreshIntervalMs / 60000),
    nextRefreshAt: meta.nextRefreshAt || null,
    generatedAt: meta.generatedAt || null,
    refreshInProgress,
  };
}

async function handleRefreshStatus(response) {
  sendJson(response, 200, await refreshStatus());
}

async function handleRefreshSettings(request, response) {
  try {
    const body = await readRequestJson(request);
    const intervalMinutes = Number(body.intervalMinutes);
    if (!Number.isFinite(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 1440) {
      throw new Error("刷新间隔需为 1 到 1440 分钟");
    }
    refreshIntervalMs = Math.round(intervalMinutes) * 60 * 1000;
    await writeRefreshSettings();
    scheduleNextRefresh(refreshIntervalMs);
    sendJson(response, 200, await refreshStatus());
  } catch (error) {
    sendJson(response, 400, { message: error.message });
  }
}

async function handleRefreshNow(response) {
  if (refreshInProgress) {
    sendJson(response, 409, { message: "刷新正在进行中", ...(await refreshStatus()) });
    return;
  }

  refreshInProgress = true;
  const nextRefreshAt = new Date(Date.now() + refreshIntervalMs).toISOString();
  try {
    const meta = await refreshProducts({ nextRefreshAt });
    console.log(`手动刷新完成：${meta.itemCount} 条商品，成功 ${meta.successCount}/${meta.sourceCount} 个信息源`);
    refreshInProgress = false;
    scheduleNextRefresh(refreshIntervalMs);
    sendJson(response, 200, await refreshStatus());
  } catch (error) {
    await updateRefreshMeta(nextRefreshAt);
    refreshInProgress = false;
    scheduleNextRefresh(refreshIntervalMs);
    sendJson(response, 500, { message: error.message });
  } finally {
    refreshInProgress = false;
  }
}

async function addSource(request, response) {
  try {
    const body = await readRequestJson(request);
    const name = String(body.name || "").trim();
    const url = new URL(String(body.url || "").trim());
    const adapter = String(body.adapter || "").trim();
    const token = String(body.token || tokenFromUrl(url.href)).trim();
    const apiBase = String(body.apiBase || "").trim();

    if (!name) throw new Error("店铺名不能为空");
    if (!knownAdapters.has(adapter)) throw new Error(`未知适配器: ${adapter}`);
    if (adapter === "ldxp" && !token) throw new Error("ldxp 店铺需要 token");

    const sourcesConfig = JSON.parse(await readFile(sourcesPath, "utf8"));
    const id = `${adapter}-${slugify(`${url.hostname}-${token || name}`)}`;
    if (sourcesConfig.sources.some((source) => source.id === id || source.url === url.href)) {
      throw new Error("店铺已存在");
    }

    const source = {
      id,
      name,
      adapter,
      enabled: true,
      url: url.href,
      ...(adapter === "ldxp" ? { token } : {}),
      ...(apiBase ? { apiBase } : {}),
      ...(adapter === "dujiao" && url.hostname === "kelaode.vip" ? { apiBase: "https://api.kelaode.vip/" } : {}),
    };
    sourcesConfig.sources.push(source);
    await writeFile(sourcesPath, `${JSON.stringify(sourcesConfig, null, 2)}\n`);
    sendJson(response, 201, { source });
  } catch (error) {
    sendJson(response, 400, { message: error.message });
  }
}

function createStaticServer(defaultFile, port, allowApi = false) {
  return createServer(async (request, response) => {
    if (!request.url) {
      response.writeHead(400);
      response.end("Bad Request");
      return;
    }

    const { pathname } = new URL(request.url, `http://127.0.0.1:${port}`);
    if (allowApi && request.method === "GET" && pathname === "/api/refresh") {
      await handleRefreshStatus(response);
      return;
    }
    if (allowApi && request.method === "POST" && pathname === "/api/refresh") {
      await handleRefreshNow(response);
      return;
    }
    if (allowApi && request.method === "POST" && pathname === "/api/refresh-settings") {
      await handleRefreshSettings(request, response);
      return;
    }
    if (allowApi && request.method === "POST" && pathname === "/api/sources") {
      await addSource(request, response);
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD, POST" });
      response.end("Method Not Allowed");
      return;
    }

    const filePath = await existingFileOrDefault(resolvePath(request.url, defaultFile, port), defaultFile);
    const contentType = contentTypes[extname(filePath)] || "application/octet-stream";
    response.writeHead(200, {
      "content-type": contentType,
      "cache-control": "no-store",
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    createReadStream(filePath).pipe(response);
  });
}

const server = createStaticServer("index.html", PORT);
const adminServer = createStaticServer("admin.html", ADMIN_PORT, true);

await loadRefreshSettings();
scheduleNextRefresh(5 * 1000);

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Codex Price Compare: http://127.0.0.1:${PORT}`);
});

adminServer.listen(ADMIN_PORT, "127.0.0.1", () => {
  console.log(`Codex Price Compare Admin: http://127.0.0.1:${ADMIN_PORT}`);
});
