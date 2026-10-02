# Agent 维护说明

## 1. 运行态感知与环境路由 (NAS-First 架构准则)

> [!IMPORTANT]
> **生产常驻环境**：本项目生产常驻服务托管于局域网 **飞牛 NAS (192.168.50.39)**。
> - **NAS 服务路径**：`/vol1/1000/apps/codex-price-compare`
> - **SSH 访问契约**：`ssh nas`（连接 `192.168.50.39:2022`，用户 `jiuzai`，认证私钥 `~/.ssh/nas_ed25519`）
> - **NAS 进程守护**：systemd 服务 `codex-price-compare`（监听 `0.0.0.0:49173` 与管理端 `49174`，Mac 本地通过透明中继桥映射 `127.0.0.1:49173` / `49174`）
> - **Mac 本地目录**：`/Users/hal9000/Websites/codex-price-compare`（仅作代码同步与开发副本，非线上运行进程）
> - **回退代理配置**：`.env` 中 `FALLBACK_PROXY_URL=http://127.0.0.1:7890`
> - **微信变动通知**：`.env` 中 `WECHATBRIDGE_URL=http://127.0.0.1:5033/`

### 核心操作原则（必须严格遵守）：

1. **修改与生效默认以 NAS 为主 (NAS-First)**：
   - 以后修改本项目（包括分类规则、词表补充、白名单维护、清洗逻辑、网站源等），**核心是修改和作用于 NAS 上托管运行的实际进程与数据**。
   - 所有变更必须保证第一时间在 NAS 环境生效，严禁出现“只改了 Mac 本地或仅推送到 GitHub，而遗漏了 NAS 实际运行态”的情况。
   - 变更流程标准动作：在本地或 NAS 修改验证后推送到 GitHub，必须立即通过 `ssh nas "cd /vol1/1000/apps/codex-price-compare && git pull"` 同步到 NAS。
2. **服务重启与热重载目标为 NAS 端**：
   - 用户访问的 `http://127.0.0.1:49173/` 实际为 NAS 服务的局域网中继映射。
   - **任何服务重启操作，目标一律为 NAS 端的 systemd 服务**：
     ```bash
     ssh nas "sudo systemctl restart codex-price-compare"
     ```
   - 状态检查与日志流：
     ```bash
     ssh nas "systemctl status codex-price-compare --no-pager"
     ```
3. **Mac 端定位：保持代码同步即可**：
   - Mac 本地仓库用于辅助开发、语法检查与测试套件回归（`npm test`）。
   - Mac 端无需常驻运行生产服务进程，只要保持与 GitHub / NAS 的代码同步即可。
4. **探活与线上真实数据验证**：
   - 每次规则修改或商品调整后，验证必须直接针对 NAS 映射的端点验证：
     ```bash
     # 探活检查
     curl -s http://127.0.0.1:49173/
     curl -s http://127.0.0.1:49174/
     # 检查实际商品数据是否已在 NAS 线上数据中生效
     curl -s http://127.0.0.1:49173/data/products.json | grep -F "目标关键词"
     ```
5. **网络出网与代理契约**：
   - 国内大部分卡网直接通过直连 fetch 出网；
   - 触发 Cloudflare/WAF 阻断的海外源通过回退代理 `127.0.0.1:7890` 出网。

---

## 2. 更新网站源

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

---

## 3. 个例商品手工直录/覆盖维护 (Manual Overrides)

当遇到卖家黑话（如“G 成品号”、“屎黄手搓品”）、无标准关键词或命名极不规范，但人工确认应归入某一分类（或需强制排除）的商品时，**严禁为了单一特例修改全局正则/大词库**（防止引发大规模误伤与规则污染），应直接通过手工直录白名单/黑名单机制维护。

### 3.1 配置文件与分类路径

* **配置文件**：[`data/rules.json`](file:///Users/hal9000/Websites/codex-price-compare/data/rules.json)
* **目标字段**：`manualOverrides[category][subtype]`

各主流品类对应路径：
* **Codex**：
  * Plus：`manualOverrides.codex.plus`
  * 5x Pro：`manualOverrides.codex.pro_5x`
  * 20x Pro：`manualOverrides.codex.pro_20x`
  * 普号：`manualOverrides.codex.free`
  * API：`manualOverrides.codex.api`
* **SMS (接码)**：`manualOverrides.sms.codex_sms`
* **Grok**：`manualOverrides.grok.m1` / `m3` / `m12` / `free`
* **Gemini**：`manualOverrides.gemini.gmail` / `m3` / `m12` / `m18`
* **手工排除 (黑名单)**：`manualOverrides.other.unknown`

### 3.2 支持录入的格式

数组内支持以下维度（分类器短路优先，赋予 `confidence: 1.0`）：
1. **完整标题字符串（推荐，最常用）**：
   * 例：`"(质保30天)手搓一卡一指纹G 成品号 - 屎黄手搓品"`
   * 清洗器会自动去除 HTML 标签，并对首尾空格、内部连续空格以及英文字母大小写进行归一化容错。
2. **商品链接 / URL**：
   * 例：`"https://wzyp.cn/item/y477uj"`
   * 当卖家频繁微调标题导致标题匹配失效时，直接填入商品链接或关键路径。
3. **商品全局 ID**：
   * 例：`"ldxp-ft7:y477uj"`
4. **对象高级定义（可选）**：
   * 例：`{ "title": "...", "reason": "人工指定", "durationDays": 30, "durationLabel": "1M" }`

### 3.3 Agent 操作规范流程

当用户要求“把【XXX】商品加入到 XX 分类”或“把【XXX】排除”时，Agent 按以下流程执行：

1. **查重并追加配置**：
   * 读取 [`data/rules.json`](file:///Users/hal9000/Websites/codex-price-compare/data/rules.json)，在目标 `manualOverrides[category][subtype]` 数组中追加该商品的完整标题或 URL（避免重复添加）。
   * 若涉及新特征词或正则匹配逻辑，同步更新 `data/rules.json` 及 `src/cleaning.mjs`。
2. **本地测试与代码提交推送**：
   * 运行测试套件与语法检查：
     ```bash
     npm test && node --check src/cleaning.mjs
     ```
   * 提交并推送到 GitHub 远程仓库：
     ```bash
     git add -A && git commit -m "..." && git push origin main
     ```
3. **NAS 同步与全库热生效（必须执行的核心步）**：
   * 无论在本地做何种变更，必须立即同步到 NAS 端并在 NAS 上触发重分类与生效：
     ```bash
     ssh nas "cd /vol1/1000/apps/codex-price-compare && git pull && node --input-type=module -e \"import fs from 'node:fs'; import { reclassifyProductItems } from './src/refresh.mjs'; import { sortProductsForDisplay } from './src/cleaning.mjs'; const rules = JSON.parse(fs.readFileSync('data/rules.json', 'utf8')); const products = JSON.parse(fs.readFileSync('data/products.json', 'utf8')); products.items = sortProductsForDisplay(reclassifyProductItems(products.items, rules)); fs.writeFileSync('data/products.json', JSON.stringify(products, null, 2) + '\n', 'utf8');\""
     ```
   * 若修改了服务层逻辑或 `cleaning.mjs` 模块代码，需同步重启 NAS 端常驻服务：
     ```bash
     ssh nas "sudo systemctl restart codex-price-compare"
     ```
4. **线上前台探活验证与汇报**：
   * 通过 `curl http://127.0.0.1:49173/data/products.json | grep -F "目标关键词"` 确认数据已在 NAS 线上端点生效。
   - 告知用户已完成录入并在 NAS 生产端同步生效。

---

## 注意事项

- **生产服务在 NAS**：不要在 Mac 本地启动或常驻开发服务争抢中继端口；重启服务一律指重启 NAS 端的 systemd 服务（`ssh nas "sudo systemctl restart codex-price-compare"`）。
- **Mac 端定位**：Mac 本地仅作为工作区与代码备份，保持 `git pull` 与 GitHub 同步即可。
- 不要把明显无关的商品强行归入 Codex / ChatGPT 分类。
- 不要添加需要账号登录、绕过限制或抓取非公开信息的数据源。
- 编辑 Markdown 文档默认使用中文。
