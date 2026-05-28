import { refreshProducts } from "../src/refresh.mjs";

const meta = await refreshProducts();

console.log(`生成 ${meta.itemCount} 条商品，成功 ${meta.successCount}/${meta.sourceCount} 个信息源`);
if (meta.errors.length > 0) {
  console.log(JSON.stringify(meta.errors, null, 2));
}
