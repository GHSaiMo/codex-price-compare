import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

function stripInlineComment(value) {
  let quote = null;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if ((char === '"' || char === "'") && value[i - 1] !== "\\") {
      quote = quote === char ? null : quote || char;
    }
    if (char === "#" && quote === null && /\s/.test(value[i - 1] || "")) {
      return value.slice(0, i).trimEnd();
    }
  }
  return value.trim();
}

function unquote(value) {
  if (value.length < 2) return value;
  const quote = value[0];
  if ((quote !== '"' && quote !== "'") || value[value.length - 1] !== quote) return value;
  const inner = value.slice(1, -1);
  return quote === '"' ? inner.replaceAll('\\"', '"').replaceAll("\\n", "\n") : inner;
}

export function parseDotEnv(raw) {
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const assignment = trimmed.startsWith("export ") ? trimmed.slice(7).trimStart() : trimmed;
    const equalsIndex = assignment.indexOf("=");
    if (equalsIndex <= 0) continue;
    const key = assignment.slice(0, equalsIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    env[key] = unquote(stripInlineComment(assignment.slice(equalsIndex + 1)));
  }
  return env;
}

export async function loadDotEnv({ path = new URL(".env", root), target = process.env } = {}) {
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return {};
  }
  const parsed = parseDotEnv(raw);
  for (const [key, value] of Object.entries(parsed)) {
    if (target[key] === undefined) target[key] = value;
  }
  return parsed;
}
