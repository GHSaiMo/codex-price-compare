export const DEFAULT_WECHATBRIDGE_URL = "http://127.0.0.1:5033/";
export const DEFAULT_WECHATBRIDGE_TARGET = "陶九镇";

export function resolveWeChatBridgeConfig(env = process.env) {
  return {
    url: env.WECHATBRIDGE_URL || DEFAULT_WECHATBRIDGE_URL,
    target: env.WECHATBRIDGE_TARGET || DEFAULT_WECHATBRIDGE_TARGET,
  };
}

export async function sendWeChatBridgeText({
  text,
  url,
  target,
  fetchImpl = fetch,
} = {}) {
  const config = resolveWeChatBridgeConfig();
  const endpoint = url || config.url;
  const recipient = target || config.target;
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ target: recipient, text }),
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(raw || `WeChatBridge HTTP ${response.status}`);
  }
  return { target: recipient, response: raw };
}
