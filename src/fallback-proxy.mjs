import { execFile, spawn } from "node:child_process";
import { connect } from "node:net";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_LOCAL_HOST = "127.0.0.1";
const DEFAULT_LOCAL_PORT = 7891;
const DEFAULT_REQUEST_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 1000;
const HTTP_FALLBACK_STATUSES = new Set([403, 408, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524]);
const PROTECTIVE_ERROR_PATTERNS = [
  /HTTP 4(?:03|08|29)\b/,
  /HTTP 5\d\d\b/,
  /WAF/i,
  /blocked/i,
  /http_bot/i,
  /http_custom/i,
  /非 JSON/,
  /fetch failed/i,
];

export function buildFallbackProxyConfig(env = process.env) {
  const sshHost = String(env.FALLBACK_SSH_HOST || "").trim();
  const localHost = String(env.FALLBACK_PROXY_LOCAL_HOST || DEFAULT_LOCAL_HOST).trim();
  const localPort = Number(env.FALLBACK_PROXY_LOCAL_PORT || DEFAULT_LOCAL_PORT);
  const proxyUrl = String(env.FALLBACK_PROXY_URL || `socks5h://${localHost}:${localPort}`).trim();
  const requestAttempts = positiveInteger(env.FALLBACK_PROXY_REQUEST_ATTEMPTS, DEFAULT_REQUEST_ATTEMPTS);
  const retryDelayMs = nonNegativeInteger(env.FALLBACK_PROXY_RETRY_DELAY_MS, DEFAULT_RETRY_DELAY_MS);

  if (!sshHost && !env.FALLBACK_PROXY_URL) return { enabled: false };
  return {
    enabled: true,
    ...(sshHost ? { sshHost } : {}),
    localHost,
    localPort,
    proxyUrl,
    requestAttempts,
    retryDelayMs,
  };
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export function shouldUseFallbackForError(error) {
  if (Number.isInteger(error?.status)) {
    return HTTP_FALLBACK_STATUSES.has(error.status);
  }
  return true;
}

export function shouldProtectRefreshResult({
  previousItemCount = 0,
  nextItemCount = 0,
  sourceCount = 0,
  failureCount = 0,
  errors = [],
} = {}) {
  if (previousItemCount <= 0) return false;
  const failureRate = sourceCount > 0 ? failureCount / sourceCount : 0;
  const itemDropRate = nextItemCount / previousItemCount;
  const hasProtectiveError = errors.some((error) => (
    PROTECTIVE_ERROR_PATTERNS.some((pattern) => pattern.test(String(error.message || "")))
  ));

  return hasProtectiveError && (failureRate >= 0.35 || itemDropRate < 0.75);
}

export function createHttpError(status, url) {
  const error = new Error(`HTTP ${status}`);
  error.status = status;
  error.url = String(url);
  return error;
}

function parseJsonResponse(responseBody, url) {
  try {
    return JSON.parse(responseBody);
  } catch {
    const preview = responseBody.replace(/\s+/g, " ").slice(0, 120);
    throw new Error(`fallback 返回非 JSON: ${String(url)} ${preview}`);
  }
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function canConnect(host, port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (result) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.once("timeout", () => done(false));
  });
}

async function waitForPort(host, port, timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await canConnect(host, port)) return true;
    await wait(100);
  }
  return false;
}

function splitCurlOutput(output) {
  const marker = "\n__HTTP_STATUS__:";
  const markerIndex = output.lastIndexOf(marker);
  if (markerIndex === -1) throw new Error("fallback curl 缺少 HTTP 状态");
  return {
    body: output.slice(0, markerIndex),
    status: Number(output.slice(markerIndex + marker.length).trim()),
  };
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export class FallbackProxyContext {
  constructor(config = buildFallbackProxyConfig(), dependencies = {}) {
    this.config = config;
    this.execFileAsync = dependencies.execFileAsync || execFileAsync;
    this.wait = dependencies.wait || wait;
    this.child = null;
    this.ownsTunnel = false;
  }

  get enabled() {
    return this.config.enabled === true;
  }

  async ensureTunnel() {
    if (!this.enabled || !this.config.sshHost) return;
    if (await canConnect(this.config.localHost, this.config.localPort)) return;

    this.child = spawn("ssh", [
      "-N",
      "-D",
      `${this.config.localHost}:${this.config.localPort}`,
      this.config.sshHost,
    ], {
      stdio: "ignore",
    });
    this.ownsTunnel = true;

    const ready = await waitForPort(this.config.localHost, this.config.localPort);
    if (!ready) {
      await this.close();
      throw new Error(`fallback SSH 代理启动失败: ${this.config.sshHost}`);
    }
  }

  async runCommand(command, args, options) {
    const attempts = positiveInteger(this.config.requestAttempts, DEFAULT_REQUEST_ATTEMPTS);
    const retryDelayMs = nonNegativeInteger(this.config.retryDelayMs, DEFAULT_RETRY_DELAY_MS);
    let lastError;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.execFileAsync(command, args, options);
      } catch (error) {
        lastError = error;
        if (attempt < attempts) await this.wait(retryDelayMs * attempt);
      }
    }

    throw lastError;
  }

  async fetchJson(url, { method = "GET", headers = {}, body = null } = {}) {
    if (this.config.sshHost) {
      return this.fetchJsonOverSsh(url, { method, headers, body });
    }

    await this.ensureTunnel();

    const args = [
      "-sS",
      "-m",
      "60",
      "-x",
      this.config.proxyUrl,
      "-w",
      "\n__HTTP_STATUS__:%{http_code}",
    ];
    for (const [name, value] of Object.entries(headers)) {
      args.push("-H", `${name}: ${value}`);
    }
    if (method !== "GET") args.push("-X", method);
    if (body !== null) args.push("--data", body);
    args.push(String(url));

    const { stdout } = await this.runCommand("curl", args, { maxBuffer: 20 * 1024 * 1024 });
    const { body: responseBody, status } = splitCurlOutput(stdout);
    if (status < 200 || status >= 300) throw createHttpError(status, url);
    return parseJsonResponse(responseBody, url);
  }

  async fetchJsonOverSsh(url, { method = "GET", headers = {}, body = null } = {}) {
    const args = [
      "curl",
      "--compressed",
      "-sS",
      "-m",
      "60",
      "-w",
      "\n__HTTP_STATUS__:%{http_code}",
    ];
    for (const [name, value] of Object.entries(headers)) {
      args.push("-H", `${name}: ${value}`);
    }
    if (method !== "GET") args.push("-X", method);
    if (body !== null) args.push("--data", body);
    args.push(String(url));

    const command = args.map(shellQuote).join(" ");
    const { stdout } = await this.runCommand("ssh", [this.config.sshHost, command], {
      maxBuffer: 20 * 1024 * 1024,
    });
    const { body: responseBody, status } = splitCurlOutput(stdout);
    if (status < 200 || status >= 300) throw createHttpError(status, url);
    return parseJsonResponse(responseBody, url);
  }

  async close() {
    if (!this.child || !this.ownsTunnel) return;
    const child = this.child;
    this.child = null;
    this.ownsTunnel = false;
    if (child.exitCode !== null || child.signalCode !== null) return;

    await new Promise((resolve) => {
      child.once("exit", resolve);
      child.kill("SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        resolve();
      }, 1000);
    });
  }
}
