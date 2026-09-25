# Agent 维护说明

## 1. 运行态感知与环境路由 (Runtime & Host Manifest)

> [!IMPORTANT]
> **生产常驻环境**：本项目生产常驻服务已正式迁移并托管于局域网 **飞牛 NAS (192.168.50.39)**。
> - **NAS 服务路径**：`/vol1/1000/apps/codex-price-compare`
> - **NAS 进程守护**：systemd 服务 `codex-price-compare`（监听 `0.0.0.0:49173`，本地透明中继映射 `127.0.0.1:49173`）
> - **Mac 本地目录**：`/Users/hal9000/Websites/codex-price-compare`（作为离线开发、数据源爬取与规则验证备份）

### Agent 行为准则 (必须遵守)：

1. **意图路由与确认机制**：
   - 若用户需求涉及 **“排查价格看板线上报错”、“更新 NAS 生产环境商品数据”、“重启服务” 或 “热修复线上站点”**，Agent 应**直接定位为 NAS 生产环境**，调用 `nas-ops` 技能通过 SSH 访问 NAS。
   - 若用户需求为 **“新增卡网源”、“修改爬虫/分类逻辑”、“测试分类器”** 但未明确指明环境，Agent **必须先询问用户确认**：
     > “当前本项目常驻运行于 NAS (192.168.50.39) 生产环境。请问您是希望**直接修改并刷新 NAS 线上服务与数据**，还是**在 Mac 本地进行调试开发**？”
2. **NAS 生产环境操作流 (nas-ops)**：
   - 远程日志查看：`ssh nas "journalctl -u codex-price-compare -n 50 -f"`
   - 重启线上站点：`ssh nas "echo jz0305 | sudo -S systemctl restart codex-price-compare"`
   - 探活检查：`curl -s http://127.0.0.1:49173/`
3. **Git 版本控制双端同步**：
   - NAS 端拥有完整 Git 仓库与 GitHub SSH 免密推送权限。
   - 在 NAS 端更新数据或代码后：
     `ssh nas "cd /vol1/1000/apps/codex-price-compare && git add . && git commit -m '...' && git push origin main"`
   - 随后在 Mac 本地目录拉取同步：
     `cd /Users/hal9000/Websites/codex-price-compare && git pull origin main`
4. **网络出网分流与反爬风控契约**：
   - NAS 系统默认关闭 TUN 虚拟网卡，默认出网路由 100% 绑定物理网卡 `enp2s0`。
   - **国内流量与卡网抓取**：天然直接走南京电信家庭宽带公网 IP（`117.89.232.186`）出网，物理级杜绝国内卡网平台的阿里云 ESA / 阿里云盾 WAF 滑块风控。
   - **海外流量与代理能力**：`sing-box` 常驻监听本地混合代理端口 `0.0.0.0:7890`（支持 HTTP/SOCKS5），需出海的容器/任务显式配置代理出网，规则集位于 `/opt/sing-box/rules/`。

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

## 注意事项

- 不要自动启动或重启开发服务；如果需要刷新运行中的页面，请先提示用户。
- 不要把明显无关的商品强行归入 Codex / ChatGPT 分类。
- 不要添加需要账号登录、绕过限制或抓取非公开信息的数据源。
- 编辑 Markdown 文档默认使用中文。
