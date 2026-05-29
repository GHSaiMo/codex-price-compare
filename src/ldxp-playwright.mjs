import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_LOCAL_PROFILE = ".playwright-ldxp-profile";
const DEFAULT_REMOTE_PROFILE = "/tmp/codex-price-compare-ldxp-profile";
const DEFAULT_REMOTE_CWD = "/root/codex-price-compare";

const workerSource = String.raw`
const { chromium } = await import("playwright");

const payload = JSON.parse(Buffer.from(process.argv[1], "base64").toString("utf8"));
const source = payload.source;
const base = new URL(source.url);

async function postJson(page, path, body) {
  const target = new URL(path, base).href;
  const result = await page.evaluate(async ({ target, body }) => {
    const response = await fetch(target, {
      method: "POST",
      headers: {
        "accept": "application/json, text/plain, */*",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      credentials: "include",
    });
    return {
      status: response.status,
      contentType: response.headers.get("content-type") || "",
      text: await response.text(),
    };
  }, { target, body });

  if (result.status < 200 || result.status >= 300) {
    throw new Error("HTTP " + result.status + " " + target);
  }
  try {
    return JSON.parse(result.text);
  } catch {
    throw new Error("Playwright 返回非 JSON: " + target + " " + result.text.replace(/\s+/g, " ").slice(0, 120));
  }
}

const context = await chromium.launchPersistentContext(payload.userDataDir, {
  channel: payload.channel,
  headless: payload.headless,
  viewport: { width: 1280, height: 900 },
  locale: "zh-CN",
});

try {
  const page = context.pages()[0] || await context.newPage();
  await page.goto(source.url, { waitUntil: "domcontentloaded", timeout: payload.timeoutMs });
  if (payload.manualWaitMs > 0) {
    await page.waitForTimeout(payload.manualWaitMs);
  }

  const info = await postJson(page, "/shopApi/Shop/info", { token: source.token });
  if (info.code !== 1) throw new Error(info.msg || "店铺信息读取失败");

  const shop = info.data;
  const goodsTypes = Array.isArray(shop.goods_type_sort) ? shop.goods_type_sort : ["card"];
  const goodsLists = [];

  for (const goodsType of goodsTypes) {
    let current = 1;
    while (current <= 20) {
      const data = await postJson(page, "/shopApi/Shop/goodsList", {
        token: source.token,
        keywords: "",
        category_id: 0,
        goods_type: goodsType,
        current,
        pageSize: 50,
      });
      if (data.code !== 1) throw new Error(data.msg || "商品列表读取失败");
      const list = data.data?.list || [];
      goodsLists.push(...list);
      if (list.length < 50) break;
      current += 1;
    }
  }

  console.log(JSON.stringify({ shop, goods: goodsLists }));
} finally {
  await context.close();
}
`;

function boolFromEnv(value, defaultValue) {
  if (value === undefined) return defaultValue;
  return !["0", "false", "no", "off"].includes(String(value).trim().toLowerCase());
}

function summarizeWorkerError(error) {
  const text = `${error.message || error}`;
  const usefulLine = text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => (
      /^Error: /.test(line)
      || /^browserType\./.test(line)
      || /^Timeout/.test(line)
      || /^Windows /.test(line)
    ));
  return (usefulLine || text.split("\n")[0] || "未知错误")
    .replace(/^Error:\s*/, "")
    .slice(0, 240);
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export function buildLdxpPlaywrightRunners(env = process.env) {
  const runners = [{ id: "local", kind: "local" }];
  const sshHost = String(env.LDXP_PLAYWRIGHT_VPS_HOST || env.FALLBACK_SSH_HOST || "").trim();
  if (sshHost) runners.push({ id: "vps", kind: "ssh", host: sshHost });

  const windowsHost = String(env.LDXP_WINDOWS_TAILSCALE_IP || "").trim();
  if (windowsHost) {
    runners.push({ id: "windows", kind: "windows-tailscale", host: windowsHost });
  }
  return runners;
}

export function buildLdxpPlaywrightPayload(source, runner, env = process.env) {
  return {
    source,
    channel: String(env.LDXP_PLAYWRIGHT_CHANNEL || "chrome"),
    headless: boolFromEnv(env.LDXP_PLAYWRIGHT_HEADLESS, false),
    manualWaitMs: Number(env.LDXP_PLAYWRIGHT_MANUAL_WAIT_MS || 0),
    timeoutMs: Number(env.LDXP_PLAYWRIGHT_TIMEOUT_MS || 60000),
    remoteCwd: String(env.LDXP_PLAYWRIGHT_REMOTE_CWD || DEFAULT_REMOTE_CWD),
    userDataDir: runner.kind === "ssh"
      ? String(env.LDXP_PLAYWRIGHT_REMOTE_PROFILE || DEFAULT_REMOTE_PROFILE)
      : String(env.LDXP_PLAYWRIGHT_PROFILE || DEFAULT_LOCAL_PROFILE),
  };
}

async function runLocalWorker(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64");
  const { stdout } = await execFileAsync(process.execPath, [
    "-e",
    workerSource,
    encoded,
  ], { maxBuffer: 50 * 1024 * 1024 });
  return JSON.parse(stdout);
}

async function runSshWorker(runner, payload) {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64");
  const encodedSource = Buffer.from(workerSource).toString("base64");
  const remoteCwd = payload.remoteCwd || DEFAULT_REMOTE_CWD;
  const command = `cd ${shellQuote(remoteCwd)} && ${[
    "node",
    "-e",
    `eval(Buffer.from(${shellQuote(encodedSource)}, "base64").toString("utf8"))`,
    encodedPayload,
  ].map(shellQuote).join(" ")}`;
  const { stdout } = await execFileAsync("ssh", [runner.host, command], {
    maxBuffer: 50 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function runWindowsProbe(runner) {
  await execFileAsync("ping", ["-c", "1", "-W", "2", runner.host], { maxBuffer: 1024 * 1024 });
  throw new Error(`Windows ${runner.host} 可达，但未配置可远程执行 Playwright 的通道`);
}

export async function fetchLdxpViaPlaywright(source, env = process.env) {
  const errors = [];
  for (const runner of buildLdxpPlaywrightRunners(env)) {
    try {
      const payload = buildLdxpPlaywrightPayload(source, runner, env);
      if (runner.kind === "local") return await runLocalWorker(payload);
      if (runner.kind === "ssh") return await runSshWorker(runner, payload);
      if (runner.kind === "windows-tailscale") return await runWindowsProbe(runner, payload);
    } catch (error) {
      errors.push(`${runner.id}: ${summarizeWorkerError(error)}`);
    }
  }
  throw new Error(`Playwright ldxp 采集失败：${errors.join(" | ")}`);
}
