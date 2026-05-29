import { refreshProducts } from "../src/refresh.mjs";

const meta = await refreshProducts();

console.log(`生成 ${meta.itemCount} 条商品，成功 ${meta.successCount}/${meta.sourceCount} 个信息源`);
if (meta.protected) {
  if (meta.skippedByCooldown) console.log("本轮处于冷却期，已跳过外部请求。");
  console.log(`已保护旧数据：${meta.protectionReason || "刷新冷却中，保留现有 products.json"}`);
  if (meta.cooldown?.until) console.log(`冷却至：${meta.cooldown.until}`);
}
if (meta.errors.length > 0) {
  console.log(JSON.stringify(meta.errors, null, 2));
}
