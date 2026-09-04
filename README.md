# Codex 比价

一个轻量的 Codex / ChatGPT、Grok 与 Gemini 相关商品信息聚合与比价工具，汇总多个公开卡网店铺的实时库存与价格。

> 本站仅汇总公开商品信息供参考，不代表对任何店铺或商品质量作出背书。

在线体验：https://codex.jiuge.space

## 页面预览

![Codex 比价主页面截图](assets/codex-price-compare-home.png)

## 项目特性

- **多平台聚合**：汇总多家卡网公开商品数据，统一展示商品标题、价格、库存及来源店铺。
- **三模式分类**：
  - **Codex**：支持 Free、Plus（默认聚焦）、5x、20x、SMS 分类。
  - **Grok**：支持 Free、1M（默认聚焦）、3M、1Y 分类。
  - **Gemini**：支持 1Y、18M（默认聚焦）、Others 分类。
- **便捷筛选与排序**：支持关键词搜索、店铺筛选、价格升降序切换及“包含缺货”开关。
- **同款聚合对比**：同款商品折叠展示，并标识多店铺低价与库存。
- **后台管理与监控**：
  - 提供店铺源健康检测（冷却、跳过、异常停用及自愈）。
  - 支持设置自动刷新周期与一键手动触发刷新。
  - 支持重点商品价格与库存观察，变动时支持微信通道告警。
- **轻量原生运行**：纯原生 Node.js，无需数据库、无需打包构建即可开箱即用。

## 快速开始

### 环境要求

- Node.js 18+（无数据库、无需前端构建）

### 安装与运行

```bash
# 安装依赖
npm install

# 启动服务（前台 49173 / 后台 49174）
npm start
```

启动后访问：
- **前台比价页**：`http://127.0.0.1:49173/`
- **店铺列表**：`http://127.0.0.1:49173/sources.html`
- **后台管理**：`http://127.0.0.1:49174/`

### 常用命令

```bash
# 手动抓取刷新数据
npm run refresh

# 运行自动化测试
npm test
```

## 数据与配置

### 配置文件

- `data/sources.json`：配置店铺列表（包含店铺标识、名称、URL、adapter 适配器及启用状态）。
- `data/rules.json`：商品分类与品牌锚点关键词、时长匹配及排除词规则。
- `data/refresh-settings.json`：配置自动刷新周期（毫秒）。
- `.env`：服务运行与调度环境变量（参考 `.env.example`）。

### 刷新调度与防风控策略

针对 `ldxp`（链动小铺）类站点，系统内置防风控调度机制：
- **核心轮休**：在后台管理勾选“核心”店铺后，核心店铺每轮隔轮抓取并分配固定配额，非核心店铺按游标轮转抓取。
- **自动冷却**：触发 WAF / 403 / 429 会自动进入 6 小时冷却，并保留旧数据防止列表被空覆盖。
- **采集模式**：默认使用 Playwright 浏览器上下文，复用本地持久化 profile；支持代理重试及 VPS 远程调度。

常用环境变量：

| 环境变量 | 说明 | 默认值 |
| --- | --- | --- |
| `LDXP_MAX_SOURCES_PER_RUN` | 单轮最大抓取店铺数 | `15` |
| `LDXP_DELAY_MIN_MS` / `MAX_MS` | 店铺抓取随机延时区间（毫秒） | `8000` / `25000` |
| `LDXP_DOMAIN_COOLDOWN_HOURS` | 触发风控后的域名冷却时长（小时） | `6` |
| `FALLBACK_PROXY_URL` | 直连失败时的回退代理地址 | `http://127.0.0.1:7890` |
| `STOCK_NOTIFY_ENABLED` | 开启微信库存/价格变动通知（需配套 WeChatBridge） | `0` |
| `WECHATBRIDGE_URL` | 本机 WeChatBridge 服务地址 | `http://127.0.0.1:5033/` |
| `WECHATBRIDGE_TARGET` | 微信通知接收人 | - |

## 项目结构

```text
.
├── admin.html              # 后台管理页面
├── admin.js                # 后台管理逻辑
├── app.js                  # 前台主页面逻辑
├── assets/
│   ├── logo.svg            # 站点图标
│   └── codex-price-compare-home.png # 主页面预览图
├── data/
│   ├── rules.json          # 分类与过滤规则
│   ├── sources.json        # 店铺数据源配置
│   ├── meta.json           # 运行时抓取元信息（已忽略）
│   └── products.json       # 运行时商品数据（已忽略）
├── index.html              # 前台主页面
├── scripts/refresh-products.mjs # 刷新入口脚本
├── server.mjs              # 本地 HTTP 服务与 API
├── source-sort.js          # 店铺排序公共逻辑
├── sources.html            # 店铺列表页面
├── src/                    # 核心模块（清洗、分类、调度、通知）
├── styles.css              # 页面样式
└── tests/                  # 自动化测试
```

## 店铺与规则维护

- **添加新店铺**：编辑 `data/sources.json` 新增店铺对象（包含 `id`、`name`、`adapter`、`url`、`token` 等字段）。目前支持 `ldxp`、`acg`、`dujiao` 等适配器。
- **分类规则调整**：若后台出现 `unknown` 未分类商品，编辑 `data/rules.json` 添加对应的分类识别词（如 `plus`、`sms`、`pro` 等），修改后运行 `npm test` 校验。

## 免责声明

本站仅汇总公开商品信息供参考，不代表对任何店铺或商品质量作出背书。用户应自行判断商品来源、履约风险与合规风险。

## License

本项目基于 [MIT License](LICENSE) 开源。
