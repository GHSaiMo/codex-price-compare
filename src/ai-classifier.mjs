const LOCAL_ENDPOINT = process.env.CLASSIFIER_ENDPOINT || "http://127.0.0.1:49175/classify";
const TIMEOUT_MS = Number(process.env.CLASSIFIER_TIMEOUT_MS) || 2000;

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
  // 后端已独立部署至 edge-slm-service，此处仅做健康探测
  if (await isClassifierAlive()) {
    logger("[AI Client] 已连接到独立端侧分类服务 (端口 49175)");
    return true;
  }
  return false;
}

export function stopClassifierDaemon() {
  // 独立服务模式下无需联动关闭
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
