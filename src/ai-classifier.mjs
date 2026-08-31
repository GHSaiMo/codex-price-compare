/**
 * 本地端侧 AI 小模型分类服务管理器（伴生进程 + 优雅降级客户端）
 * 当系统启动时可伴生拉起 codex-classifier-grpo 的 HTTP 守护服务；
 * 当退出时自动联动回收。
 */

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const LOCAL_ENDPOINT = process.env.CLASSIFIER_ENDPOINT || "http://127.0.0.1:49175/classify";
const CLASSIFIER_PROJECT_DIR = process.env.CLASSIFIER_PROJECT_DIR || "/Users/hal9000/Projects/codex-classifier-grpo";
const TIMEOUT_MS = Number(process.env.CLASSIFIER_TIMEOUT_MS) || 2000;

let sidecarProcess = null;

export async function isClassifierAlive() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 600);
    const resp = await fetch(LOCAL_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "ping", description: "" }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    return resp.ok;
  } catch {
    return false;
  }
}

export async function ensureClassifierDaemon(logger = console.log) {
  if (process.env.ENABLE_AI_SIDECAR === "false") {
    return false;
  }

  // 1. 先探测是否已有常驻服务
  if (await isClassifierAlive()) {
    logger("[AI Sidecar] 检测到已有本地分类服务运行中 (端口 49175)");
    return true;
  }

  logger("[AI Sidecar] 正在启动端侧 AI 分类伴生进程 (Qwen2.5-0.5B-LoRA on Metal)...");
  try {
    sidecarProcess = spawn("uv", ["run", "python", "scripts/server_endpoint.py"], {
      cwd: CLASSIFIER_PROJECT_DIR,
      stdio: "ignore",
      detached: false,
      env: {
        ...process.env,
        NO_PROXY: "",
        no_proxy: "",
      },
    });

    sidecarProcess.on("error", (err) => {
      logger(`[AI Sidecar] 启动伴生进程出错: ${err.message}`);
      sidecarProcess = null;
    });

    sidecarProcess.on("exit", (code, sig) => {
      if (sidecarProcess) {
        logger(`[AI Sidecar] 伴生进程已退出 (code: ${code}, signal: ${sig})`);
        sidecarProcess = null;
      }
    });

    // 2. 等待最多 8 秒直到就绪
    const start = Date.now();
    while (Date.now() - start < 8000) {
      await sleep(300);
      if (await isClassifierAlive()) {
        logger(`[AI Sidecar] 端侧小模型已就绪 (耗时 ${Date.now() - start}ms)`);
        return true;
      }
    }
    logger("[AI Sidecar] 等待端侧小模型就绪超时，系统将继续使用纯规则模式");
    return false;
  } catch (err) {
    logger(`[AI Sidecar] 拉起伴生进程失败: ${err.message}`);
    return false;
  }
}

export function stopClassifierDaemon(logger = console.log) {
  if (sidecarProcess) {
    try {
      logger("[AI Sidecar] 正在关闭端侧分类伴生进程...");
      sidecarProcess.kill("SIGTERM");
    } catch {}
    sidecarProcess = null;
  }
}

export async function queryLocalClassifier(title, descriptionText = "") {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    
    const resp = await fetch(LOCAL_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, description: descriptionText }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data && data.success && data.prediction) {
      return {
        category: data.prediction.category,
        subtype: data.prediction.subtype,
        raw: data.raw,
      };
    }
    return null;
  } catch {
    // 优雅降级：若本地服务未启动或超时，不影响主链路
    return null;
  }
}
