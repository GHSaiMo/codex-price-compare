import { readFile, writeFile } from "node:fs/promises";
import { queryLocalClassifier } from "../src/ai-classifier.mjs";

const PRODUCTS_PATH = new URL("../data/products.json", import.meta.url);
const AUDIT_LOG_PATH = new URL("../data/ai-audit-log.json", import.meta.url);

async function main() {
  console.log("=== AI 端侧分类器 Unknown 商品审计工具 ===");
  let raw;
  try {
    raw = JSON.parse(await readFile(PRODUCTS_PATH, "utf8"));
  } catch (e) {
    console.error("读取 products.json 失败:", e.message);
    process.exit(1);
  }

  const items = raw.items || [];
  const unknowns = items.filter((it) => it.subtype === "unknown");
  console.log(`当前全库商品总数: ${items.length}，其中 unknown 商品数: ${unknowns.length}`);

  if (unknowns.length === 0) {
    console.log("太棒了！当前没有任何 unknown 商品。");
    return;
  }

  console.log("\n正在尝试连接本地 AI 分类服务 (http://127.0.0.1:49175/classify) 进行审计...");
  const results = [];
  let successCount = 0;

  for (const it of unknowns) {
    const aiResult = await queryLocalClassifier(it.title, it.descriptionText);
    if (aiResult) {
      successCount++;
      results.push({
        id: it.id,
        title: it.title,
        source: it.sourceName,
        ruleCategory: it.category,
        ruleSubtype: it.subtype,
        aiCategory: aiResult.category,
        aiSubtype: aiResult.subtype,
        rawAI: aiResult.raw,
      });
      console.log(`  ✓ [AI判定成功] ${it.title.slice(0, 30)}... -> ${aiResult.category}/${aiResult.subtype}`);
    } else {
      results.push({
        id: it.id,
        title: it.title,
        source: it.sourceName,
        ruleCategory: it.category,
        ruleSubtype: it.subtype,
        aiResult: "SERVICE_UNAVAILABLE_OR_TIMEOUT",
      });
    }
  }

  if (successCount === 0) {
    console.log("\n⚠️ 未检测到本地运行中的 AI 分类守护进程。");
    console.log("如需启动守护服务，请在终端执行：");
    console.log("  cd /Users/hal9000/Projects/codex-classifier-grpo && uv run python scripts/server_endpoint.py");
  } else {
    console.log(`\n审计完成！已成功通过 AI 预测 ${successCount}/${unknowns.length} 个 unknown 商品。`);
    await writeFile(AUDIT_LOG_PATH, `${JSON.stringify({ auditedAt: new Date().toISOString(), total: unknowns.length, successCount, results }, null, 2)}\n`);
    console.log(`审计明细日志已保存至 data/ai-audit-log.json，后续可随时让 Agent 读取验收。`);
  }
}

main().catch(console.error);
