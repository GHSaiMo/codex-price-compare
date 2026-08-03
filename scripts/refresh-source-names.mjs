import { readFile, writeFile } from "node:fs/promises";
import { loadDotEnv } from "../src/env.mjs";

await loadDotEnv();

const sourcesPath = new URL("../data/sources.json", import.meta.url);
const productsPath = new URL("../data/products.json", import.meta.url);
const sourcesConfig = JSON.parse(await readFile(sourcesPath, "utf8"));
const productsConfig = JSON.parse(await readFile(productsPath, "utf8"));
const proxy = process.env.FALLBACK_PROXY_URL || "";
const write = process.argv.includes("--write");

async function fetchWithProxy(url, options = {}) {
  const headers = options.headers || {};
  const body = options.body;
  const method = options.method || "GET";
  try {
    const response = await fetch(url, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(15000),
    });
    const text = await response.text();
    return { ok: response.ok, status: response.status, text, via: "direct" };
  } catch (error) {
    if (!proxy) throw error;
  }
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  const args = ["-sS", "-x", proxy, "-m", "20", "-w", "\n__HTTP_STATUS__:%{http_code}"];
  for (const [key, value] of Object.entries(headers)) args.push("-H", key + ": " + value);
  if (method !== "GET") args.push("-X", method);
  if (body) args.push("--data-binary", body);
  args.push(url);
  const { stdout } = await execFileAsync("curl", args, { maxBuffer: 5000000 });
  const marker = "\n__HTTP_STATUS__:";
  const index = stdout.lastIndexOf(marker);
  const text = index >= 0 ? stdout.slice(0, index) : stdout;
  const status = index >= 0 ? Number(stdout.slice(index + marker.length)) : 0;
  return { ok: status >= 200 && status < 300, status, text, via: "proxy" };
}

function cleanName(value) {
  if (!value) return null;
  let text = String(value).replace(/\s+/g, " ").trim();
  if (!text) return null;

  // ACG storefront titles often look like "购物 - 店名".
  text = text.replace(/^购物\s*[-—–|]\s*/u, "").trim();

  const rejected = new Set([
    "访问受限",
    "403",
    "404",
    "Just a moment...",
    "Attention Required! | Cloudflare",
  ]);
  if (rejected.has(text)) return null;
  if (/^购物$/u.test(text)) return null;
  return text || null;
}

function extractTitle(html) {
  const match = String(html || "").match(/<title[^>]*>([^<]*)<\/title>/i);
  return cleanName(match?.[1]);
}

function pickJsonName(data) {
  if (!data || typeof data !== "object") return null;
  const candidates = [
    data?.data?.nickname,
    data?.data?.name,
    data?.data?.shop_name,
    data?.data?.title,
    data?.data?.site_name,
    data?.nickname,
    data?.name,
    data?.shop_name,
    data?.title,
  ];
  for (const candidate of candidates) {
    const cleaned = cleanName(candidate);
    if (cleaned) return cleaned;
  }
  return null;
}

async function fetchLdxpName(source) {
  const url = new URL("/shopApi/Shop/info", source.url).href;
  const response = await fetchWithProxy(url, {
    method: "POST",
    headers: {
      accept: "application/json, text/plain, */*",
      "content-type": "application/json",
    },
    body: JSON.stringify({ token: source.token }),
  });
  try {
    const data = JSON.parse(response.text);
    return { name: pickJsonName(data), status: response.status, via: response.via, msg: data?.msg || "" };
  } catch {
    return { name: null, status: response.status, via: response.via, msg: response.text.replace(/\s+/g, " ").slice(0, 120) };
  }
}

async function fetchAcgName(source) {
  const response = await fetchWithProxy(source.url, {
    headers: { accept: "text/html,application/xhtml+xml" },
  });
  return { name: extractTitle(response.text), status: response.status, via: response.via, msg: "" };
}

async function fetchDujiaoName(source) {
  const apiBase = new URL(source.apiBase || source.url);
  const candidates = [
    new URL("/api/v1/public/shop", apiBase).href,
    new URL("/api/v1/public/info", apiBase).href,
    new URL("/api/v1/public/site", apiBase).href,
    source.url,
  ];
  let last = null;
  for (const url of candidates) {
    try {
      const response = await fetchWithProxy(url, { headers: { accept: "application/json,text/html,*/*" } });
      last = response;
      try {
        const data = JSON.parse(response.text);
        const name = pickJsonName(data);
        if (name) return { name, status: response.status, via: response.via, msg: "" };
      } catch {
        const title = extractTitle(response.text);
        if (title) return { name: title, status: response.status, via: response.via, msg: "" };
      }
    } catch (error) {
      last = { status: 0, via: "error", text: error.message };
    }
  }
  return { name: null, status: last?.status || 0, via: last?.via || "error", msg: last?.text ? String(last.text).slice(0, 120) : "" };
}

const productNames = new Map();
for (const item of productsConfig.items || []) {
  if (!item.sourceId || !item.sourceName) continue;
  if (!productNames.has(item.sourceId)) productNames.set(item.sourceId, new Set());
  productNames.get(item.sourceId).add(item.sourceName);
}

const results = [];
for (const source of sourcesConfig.sources) {
  try {
    let fetched;
    if (source.adapter === "ldxp") fetched = await fetchLdxpName(source);
    else if (source.adapter === "acg") fetched = await fetchAcgName(source);
    else if (source.adapter === "dujiao") fetched = await fetchDujiaoName(source);
    else fetched = { name: null, status: 0, via: "skip", msg: "unsupported adapter" };
    results.push({
      id: source.id,
      adapter: source.adapter,
      old: source.name,
      fetched: fetched.name,
      productNames: [...(productNames.get(source.id) || [])],
      status: fetched.status,
      via: fetched.via,
      msg: fetched.msg,
    });
  } catch (error) {
    results.push({
      id: source.id,
      adapter: source.adapter,
      old: source.name,
      fetched: null,
      productNames: [...(productNames.get(source.id) || [])],
      status: 0,
      via: "error",
      msg: error.message,
    });
  }
}

function chooseName(entry) {
  if (entry.fetched) return entry.fetched;
  // Only trust product-derived names for ldxp, where refresh already stores shop.nickname.
  if (entry.adapter === "ldxp" && entry.productNames.length === 1) {
    const candidate = cleanName(entry.productNames[0]);
    if (candidate && candidate !== entry.old) return candidate;
  }
  return null;
}

const updates = [];
for (const entry of results) {
  const next = chooseName(entry);
  const flag = next && next !== entry.old ? "UPDATE" : entry.fetched ? "same" : "fail";
  console.log([
    flag.padEnd(6),
    entry.adapter.padEnd(7),
    entry.id.padEnd(28),
    JSON.stringify(entry.old),
    "=>",
    JSON.stringify(next || entry.fetched),
    "status=" + entry.status,
    entry.via,
    entry.msg || "",
    entry.productNames.length ? "products=" + JSON.stringify(entry.productNames) : "",
  ].join(" "));
  if (next && next !== entry.old) updates.push({ id: entry.id, old: entry.old, next });
}

console.log("---");
console.log("updates=" + updates.length);
for (const update of updates) console.log("- " + update.id + ": " + update.old + " => " + update.next);

if (write) {
  const byId = new Map(updates.map((item) => [item.id, item.next]));
  sourcesConfig.sources = sourcesConfig.sources.map((source) => (
    byId.has(source.id) ? { ...source, name: byId.get(source.id) } : source
  ));
  await writeFile(sourcesPath, JSON.stringify(sourcesConfig, null, 2) + "\n");
  console.log("wrote " + updates.length + " source names");
}
