import { rename, unlink, writeFile } from "node:fs/promises";
import { normalize } from "node:path";
import { fileURLToPath } from "node:url";

export function toFilePath(targetPath) {
  if (targetPath instanceof URL) {
    return fileURLToPath(targetPath);
  }
  if (typeof targetPath === "string" && targetPath.startsWith("file://")) {
    return fileURLToPath(new URL(targetPath));
  }
  return normalize(String(targetPath));
}

export async function writeAtomic(targetPath, content) {
  const filePath = toFilePath(targetPath);
  const tempPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  try {
    await writeFile(tempPath, content, "utf8");
    await rename(tempPath, filePath);
  } catch (error) {
    await unlink(tempPath).catch(() => {});
    throw error;
  }
}

export async function writeJsonAtomic(targetPath, data) {
  const content = `${JSON.stringify(data, null, 2)}\n`;
  await writeAtomic(targetPath, content);
}
