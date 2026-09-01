# Agent 维护说明

## 更新网站源

当用户提出“更新网站源”“新增卡网源”“同步书签里的店铺”等类似需求时，默认按下面流程处理。

1. 从用户浏览器书签栏的“卡网”文件夹查找候选网站源。
   - 只处理“卡网”文件夹下面的一级书签。
   - 不默认递归子文件夹，除非用户明确要求。
   - 记录每个一级书签的名称和 URL，和 `data/sources.json` 中已有源去重。

2. 优先使用项目现有 adapter 尝试读取。
   - 先判断候选站点是否符合已有平台结构。
   - 当前源配置在 `data/sources.json`。
   - 采集入口和 adapter 映射在 `src/refresh.mjs`。
   - 数据清洗和分类逻辑在 `src/cleaning.mjs`。
   - 如果站点可被已有 adapter 支持，只更新 `data/sources.json`。

3. 如果读取不到商品数据，按页面结构重新匹配。
   - 先查看页面公开 HTML、脚本接口、网络请求和商品列表结构。
   - 优先复用现有 adapter 的公共逻辑。
   - 只有结构确实不同，才新增或扩展 adapter。
   - 不依赖登录态、验证码、私有接口或非公开数据。

4. 清洗数据并更新项目目录。
   - 输出字段应和现有商品结构保持一致，包括名称、价格、库存、链接、来源、分类等。
   - 新增源后运行刷新流程生成最新 `data/products.json`、`data/meta.json` 等项目数据。
   - 检查 unknown 商品，必要时更新 `data/rules.json` 或 `src/cleaning.mjs` 的分类规则。

5. 验证。
   - 运行 `npm test`。
   - 运行语法检查：

```bash
node --check server.mjs && node --check src/cleaning.mjs && node --check app.js && node --check admin.js && node --check theme.js && node --check source-sort.js && node --check sources.js
```

## 注意事项

- 不要自动启动或重启开发服务；如果需要刷新运行中的页面，请先提示用户。
- 不要把明显无关的商品强行归入 Codex / ChatGPT 分类。
- 不要添加需要账号登录、绕过限制或抓取非公开信息的数据源。
- 编辑 Markdown 文档默认使用中文。

## 端侧 AI 分类器机制与演进（两步走规划）

为了解决卡网黑话（如“接马”、“质保首接”、“带team勿拍”、“可开+”等）导致正则规则与测试用例无限膨胀的问题，本项目已规划并接入端侧轻量 AI 分类模型。

### 第一步：端侧小模型无损兜底（当前状态）
1. **模型独立项目位置**：`/Users/hal9000/Projects/edge-slm-service`
2. **基座与适配器**：`Qwen2.5-0.5B-Instruct-4bit` + MLX LoRA（使用 Apple Silicon Metal 原生加速）。
3. **工作模式**：
   - 保留现有的 `src/cleaning.mjs` 规则作为第一道微秒级 Fast-Path；
   - **独立服务架构**：后端服务由 `edge-slm-service` 独立托管（端口 49175），本项目仅作为 HTTP 客户端请求，不再同步拉起子进程；
   - **按需触发**：采集和重分类时只在遇到 `subtype === "unknown"` 的商品时才触发 AI 推理，绝大部分普通标品依旧毫秒级秒过；
   - 客户端模块 `src/ai-classifier.mjs` 提供 `queryLocalClassifier(title, description)` 接口；
   - 若端侧服务未就绪，系统自动静默降级为传统规则结果，保证主采集链路 100% 稳定性。
4. **模型实测表现**（在 125 条从未见过的真实测试集上）：
   - JSON 格式合规率：100%
   - 一级大类准确率：99.2%
   - 全匹配（Category + Subtype）准确率：96.0%（Plus/Free/20x 等核心分类均为 100%）

### 第二步：验收与正则瘦身重构（后续工作）
在后续周期由 Agent 进行验收时，执行以下核验流程：
1. **收集未知样本**：通过 `node scripts/check-unknowns.mjs` 或查看 `data/products.json` 中 `subtype === "unknown"` 的商品；
2. **测试模型判定**：使用小模型对积累的未知商品进行批处理识别并比对人工直觉；
3. **沉淀数据集**：将有效样本追加到 `codex-classifier-grpo/data/` 并一键执行训练增量微调；
4. **精简 cleaning.mjs**：当小模型长期稳定后，逐步剔除 `cleaning.mjs` 中冗余繁琐的 `strip*Context` 和黑话词表，将清洗代码从 700 行精简至 100 行内。

