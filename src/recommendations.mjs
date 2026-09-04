import dns from "node:dns/promises";
import { readFile } from "node:fs/promises";
import { writeJsonAtomic } from "./fs-atomic.mjs";

export const DEFAULT_RECOMMENDATIONS_DATA = { version: 1, items: [] };

export function isPrivateOrSpecialIp(ip) {
  if (!ip || typeof ip !== "string") return true;
  let target = ip.trim();
  if (target.startsWith("::ffff:")) {
    target = target.slice(7);
  }

  // IPv4 check
  if (target.includes(".")) {
    const parts = target.split(".").map((p) => parseInt(p, 10));
    if (parts.length !== 4 || parts.some((n) => isNaN(n) || n < 0 || n > 255)) {
      return true;
    }
    const [a, b, c, d] = parts;
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // 127.0.0.0/8
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 Link-Local
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 Carrier-grade NAT
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // TEST-NET-1
    if (a === 198 && (b === 18 || b === 19)) return true; // Benchmarking
    if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
    if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
    if (a >= 224) return true; // Multicast & Reserved (224.0.0.0+)
    return false;
  }

  // IPv6 check
  const lower = target.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (
    lower.startsWith("fe8") ||
    lower.startsWith("fe9") ||
    lower.startsWith("fea") ||
    lower.startsWith("feb")
  ) {
    return true; // fe80::/10 link-local
  }
  if (lower.startsWith("fc") || lower.startsWith("fd")) {
    return true; // fc00::/7 unique local
  }
  return false;
}

export async function validatePublicUrl(targetUrl) {
  if (typeof targetUrl !== "string" || !targetUrl.trim()) {
    throw new Error("链接地址不能为空");
  }
  const trimmed = targetUrl.trim();
  if (trimmed.length > 300) {
    throw new Error("链接地址长度超出限制 (最多 300 字符)");
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("无效的链接格式");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("仅支持 HTTP 或 HTTPS 链接");
  }

  const hostname = parsed.hostname;
  if (!hostname || hostname === "localhost") {
    throw new Error("禁止提交内网或本地主机地址");
  }

  // If already IP literal
  if (/^[\d.]+$/.test(hostname) || hostname.includes(":")) {
    if (isPrivateOrSpecialIp(hostname)) {
      throw new Error("禁止提交内网或保留 IP 地址");
    }
  } else {
    try {
      const addresses = await dns.lookup(hostname, { all: true });
      if (!addresses || addresses.length === 0) {
        throw new Error("域名无法解析");
      }
      for (const addr of addresses) {
        if (isPrivateOrSpecialIp(addr.address)) {
          throw new Error(`域名解析到保留或内网地址 (${addr.address})，已被系统拦截`);
        }
      }
    } catch (err) {
      if (err.message && err.message.includes("已被系统拦截")) {
        throw err;
      }
      throw new Error(`域名解析失败: ${err.message || "无法访问"}`);
    }
  }

  return parsed;
}

export function decodeHtmlEntities(text) {
  if (!text) return "";
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractMetadataFromHtml(html) {
  let title = "";
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch && titleMatch[1]) {
    title = decodeHtmlEntities(titleMatch[1].trim()).slice(0, 100);
  }

  let description = "";
  const descMatch =
    html.match(
      /<meta[^>]+(?:name=["']description["']|property=["']og:description["'])[^>]+content=["']([^"']*)["']/i
    ) ||
    html.match(
      /<meta[^>]+content=["']([^"']*)["'][^>]+(?:name=["']description["']|property=["']og:description["'])/i
    );
  if (descMatch && descMatch[1]) {
    description = decodeHtmlEntities(descMatch[1].trim()).slice(0, 200);
  }

  return { title, description };
}

export async function fetchPageMetadata(targetUrl) {
  try {
    let currentUrl = targetUrl;
    let redirects = 0;
    const maxRedirects = 3;

    while (redirects <= maxRedirects) {
      const parsed = await validatePublicUrl(currentUrl);

      const response = await fetch(parsed.href, {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        },
        redirect: "manual",
        signal: AbortSignal.timeout(5000),
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) break;
        currentUrl = new URL(location, currentUrl).href;
        redirects++;
        continue;
      }

      if (!response.ok) {
        return {
          title: "",
          description: "",
          status: response.status,
        };
      }

      const reader = response.body?.getReader();
      if (!reader) {
        return { title: "", description: "" };
      }

      const chunks = [];
      let totalBytes = 0;
      const maxBytes = 100 * 1024;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        totalBytes += value.length;
        if (totalBytes >= maxBytes) {
          reader.cancel().catch(() => {});
          break;
        }
      }

      const html = Buffer.concat(chunks).toString("utf8");
      const { title, description } = extractMetadataFromHtml(html);

      return {
        title,
        description,
        status: response.status,
      };
    }

    return { title: "", description: "" };
  } catch (err) {
    return {
      title: "",
      description: "",
      fetchError: err.message,
    };
  }
}

const ipMap = new Map();
const MAX_PER_WINDOW = 3;
const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MIN_INTERVAL_MS = 30 * 1000; // 30 seconds

export function checkRateLimit(clientIp, now = Date.now()) {
  const record = ipMap.get(clientIp);
  if (!record) return { allowed: true };

  if (now - record.windowStart > WINDOW_MS) {
    return { allowed: true };
  }

  if (now - record.lastSubmitted < MIN_INTERVAL_MS) {
    const waitSec = Math.ceil((MIN_INTERVAL_MS - (now - record.lastSubmitted)) / 1000);
    return {
      allowed: false,
      reason: `提交过于频繁，请等待 ${waitSec} 秒后再试`,
      retryAfterSeconds: waitSec,
    };
  }

  if (record.count >= MAX_PER_WINDOW) {
    const waitMin = Math.ceil((WINDOW_MS - (now - record.windowStart)) / 60000);
    return {
      allowed: false,
      reason: `已达到每小时提交次数上限，请等待 ${waitMin} 分钟后再试`,
      retryAfterSeconds: waitMin * 60,
    };
  }

  return { allowed: true };
}

export function recordSubmission(clientIp, now = Date.now()) {
  const record = ipMap.get(clientIp);
  if (!record || now - record.windowStart > WINDOW_MS) {
    ipMap.set(clientIp, {
      count: 1,
      windowStart: now,
      lastSubmitted: now,
    });
  } else {
    record.count += 1;
    record.lastSubmitted = now;
  }
}

export function clearRateLimitsForTesting() {
  ipMap.clear();
}

export async function readRecommendations(filePath) {
  try {
    const content = await readFile(filePath, "utf8");
    const parsed = JSON.parse(content);
    if (!parsed || !Array.isArray(parsed.items)) {
      return { version: 1, items: [] };
    }
    return parsed;
  } catch (err) {
    if (err.code === "ENOENT") {
      return { version: 1, items: [] };
    }
    throw err;
  }
}

export async function writeRecommendations(filePath, data) {
  const safeData = {
    version: 1,
    items: Array.isArray(data?.items) ? data.items : [],
  };
  await writeJsonAtomic(filePath, safeData);
}

export async function addRecommendation(
  filePath,
  { url, clientIp = "unknown", userAgent = "", title = "", description = "" }
) {
  const data = await readRecommendations(filePath);
  const parsed = new URL(url);
  const now = new Date().toISOString();
  const newEntry = {
    id: `rec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    url: parsed.href,
    domain: parsed.hostname,
    title: String(title || "").slice(0, 100),
    description: String(description || "").slice(0, 200),
    clientIp: String(clientIp || "unknown").slice(0, 64),
    userAgent: String(userAgent || "").slice(0, 200),
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };
  data.items.unshift(newEntry);
  await writeRecommendations(filePath, data);
  return newEntry;
}

export async function updateRecommendationStatus(filePath, id, status) {
  if (!["pending", "accepted", "ignored"].includes(status)) {
    const err = new Error(`无效的状态: ${status}`);
    err.statusCode = 400;
    throw err;
  }
  const data = await readRecommendations(filePath);
  const item = data.items.find((it) => it.id === id);
  if (!item) {
    const err = new Error("未找到对应推荐记录");
    err.statusCode = 404;
    throw err;
  }
  item.status = status;
  item.updatedAt = new Date().toISOString();
  await writeRecommendations(filePath, data);
  return item;
}

export async function deleteRecommendation(filePath, id) {
  const data = await readRecommendations(filePath);
  const index = data.items.findIndex((it) => it.id === id);
  if (index === -1) {
    const err = new Error("未找到对应推荐记录");
    err.statusCode = 404;
    throw err;
  }
  const [removed] = data.items.splice(index, 1);
  await writeRecommendations(filePath, data);
  return removed;
}
