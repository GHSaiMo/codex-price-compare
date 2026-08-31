import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  classifyProduct,
  normalizeAcgProduct,
  normalizeDujiaoProduct,
  normalizeLdxpProduct,
  refineCodexPlanSubtype,
  sortProductsForDisplay,
} from "../src/cleaning.mjs";

const root = new URL("../", import.meta.url);
const rules = JSON.parse(await readFile(new URL("data/rules.json", root), "utf8"));
const productsData = JSON.parse(await readFile(new URL("data/products.json", root), "utf8"));

assert.deepEqual(
  classifyProduct("Codex接码 ( 美区 ) 单次接码", "只能用于codex登录", rules),
  {
    brand: "codex",
    category: "sms",
    subtype: "codex_sms",
    confidence: 0.95,
    tags: ["codex", "sms"],
    matchReasons: ["命中接码服务词: codex接码", "命中接码服务词: 单次接码"],
  },
);
assert.equal(
  classifyProduct("Codex接码 ( 美区 ) 单次接码", "适用于Free/Plus/Pro接码", rules).category,
  "sms",
);
assert.equal(
  classifyProduct("codex接码，美国实卡（一般可绑3个号）", "此商品为Codex接码额度卡，适用于Free/Plus/Pro接码", rules).subtype,
  "codex_sms",
);
assert.equal(
  classifyProduct("Gpt短效码🔥包接到", "", rules).category,
  "sms",
);
assert.equal(
  classifyProduct("Gpt短效码🔥包接到", "", rules).subtype,
  "codex_sms",
);
assert.equal(
  classifyProduct("【请看店铺公告】美国长效接码codex 注册通用🔥1-10天【质保不来码】PLUS", "", rules).category,
  "sms",
);
assert.equal(
  classifyProduct("【请看店铺公告】美国长效接码codex 注册通用🔥1-10天【质保不来码】PLUS", "", rules).subtype,
  "codex_sms",
);
assert.equal(
  classifyProduct("美国实卡长效接码codex绑定注册通用🔥20-30天【质保不来码】PLUS接码codex接码", "", rules).category,
  "sms",
);
assert.equal(
  classifyProduct("美国实卡长效接马codex绑定注册通用🔥20-30天【质保不来马】PLUS接马codex接马", "", rules).category,
  "sms",
);
assert.equal(
  classifyProduct("CDK 美国实卡codex 单次接马 可以api对接 自动化codex绑定 PLUS接马codex接马", "注意注意：这是单次的 直接绑定可以下载josn 发货格式：CDK 兑换地址： https://cdk.sms688.cc/ 多号码自动轮换 绑定成功可以直接导出json文件 看清楚这是单次绑定 CDK发货 兑换网站兑换 如遇库存不足，需要大量可以联系客服。", rules).category,
  "sms",
);
assert.equal(
  classifyProduct("CDK 美国实卡codex 单次接马 可以api对接 自动化codex绑定 PLUS接马codex接马", "", rules).subtype,
  "codex_sms",
);
assert.equal(
  classifyProduct("【高质量】Plus/codex接马 短效接马 美区（美卡百分百接马）源头可对接", "万号真实成功率94%！！！ 没有验证码之前不会过期不会失效 全自动发卡取码系统，拍下发送卡密和兑换地址，自助操作即可，无需人工 Codex接码，美区，100%一次通过✅", rules).category,
  "sms",
);
assert.equal(
  classifyProduct("【高质量】Plus/codex接马 短效接马 美区（美卡百分百接马）源头可对接", "", rules).subtype,
  "codex_sms",
);
assert.equal(
  classifyProduct("ChatG plus Codex 接马 【单次接马】【智利】", "单次接码 看清楚 在下单 无售后", rules).category,
  "sms",
);
assert.equal(
  classifyProduct("ChatG plus Codex 接马 【单次接马】【智利】", "", rules).subtype,
  "codex_sms",
);
assert.equal(
  classifyProduct("CDK 美国实卡codex 10次接马 可以api对接 自动化codex绑定 PLUS接马codex接马", "", rules).category,
  "sms",
);
assert.equal(
  classifyProduct("CDK 美国实卡codex 10次接马 可以api对接 自动化codex绑定 PLUS接马codex接马", "", rules).subtype,
  "codex_sms",
);
assert.equal(
  classifyProduct("G接马free号 有RT，附送微软长效邮箱", "", rules).category,
  "codex",
);
assert.equal(
  classifyProduct("G接马free号 有RT，附送微软长效邮箱", "", rules).subtype,
  "free",
);
assert.equal(
  classifyProduct("【福利价】GPT Plus（直卡渠道）| 美区长效接码 | 谷歌账号家宽IP注册", "", rules).category,
  "codex",
);
assert.equal(
  classifyProduct("【福利价】GPT Plus（直卡渠道）| 美区长效接码 | 谷歌账号家宽IP注册", "", rules).subtype,
  "plus",
);
assert.equal(
  classifyProduct("【福利价】GPT Plus（直卡渠道）| 美区长效接马 | 谷歌账号家宽IP注册", "", rules).category,
  "codex",
);
assert.equal(
  classifyProduct("【福利价】GPT Plus（直卡渠道）| 美区长效接马 | 谷歌账号家宽IP注册", "", rules).subtype,
  "plus",
);
assert.equal(
  classifyProduct("谷歌账号注册的ChatGPT Plus｜已使用美区实卡长效接码 （后期随时用）", "", rules).subtype,
  "plus",
);
assert.equal(
  classifyProduct("plus pro邀请额度增加 自行使用卖出无售后", "卡密激活 plus和pro额度增加 邀请 自行使用 自行确认自己账号邀请是否有资格 如果自己codex页面不显示邀请获取多少奖励就是0", rules).category,
  "other",
);
assert.equal(
  classifyProduct("ChatGPT Plus 邀请额度", "", rules).category,
  "other",
);
assert.equal(
  classifyProduct("gmail 短效谷歌 接码邮箱（GPT注册专用）", "", rules).category,
  "other",
);
assert.equal(
  classifyProduct("gmail 短效谷歌 接马邮箱（GPT注册专用）", "", rules).category,
  "other",
);
assert.equal(
  classifyProduct("Gmail 接码 （两次码|OpenAI业务|看清楚商品说明）", "", rules).category,
  "other",
);
assert.equal(
  classifyProduct("谷歌接码邮箱（GPT注册专用）", "", rules).category,
  "other",
);
assert.equal(
  classifyProduct("Pro 邀请资格 自行使用卖出无售后", "codex 邀请额度增加", rules).category,
  "other",
);
assert.equal(
  classifyProduct("【美区30天T-Mobile实体卡】", "ChatGPT接码，期限内可无限次接码", rules).category,
  "sms",
);
assert.equal(
  classifyProduct("【groHeavy1个月成品】转直充丨补差价", "", rules).category,
  "other",
);
assert.equal(
  classifyProduct("反代教程【不要下单，直接点开看就行】记得看到最后", "json直接导入反代软件就能用，反代后使用codex，完全体gpt", rules).category,
  "other",
);
assert.equal(
  classifyProduct("📚 ChatGPT 土区开通稳定订阅教程【帮您少踩坑】", "", rules).category,
  "other",
);
assert.equal(
  classifyProduct("icloud 隐私邮箱 只关注可不可以注册GPT", "iCloud隐私邮箱，发货形式为邮箱----取码url，自行开通plus后,取件链接失效概不负责", rules).category,
  "other",
);
assert.equal(
  normalizeLdxpProduct({
    goods_key: "s9njn2",
    name: "icloud 隐私邮箱 只关注可不可以注册GPT",
    description: "iCloud隐私邮箱，发货形式为邮箱----取码url,自行开通plus后,取件链接失效概不负责",
    price: "0.18",
    extend: { stock_count: "20" },
    link: "/item/s9njn2",
  }, { id: "ldxp-test", name: "test", url: "https://pay.ldxp.cn/shop/test", adapter: "ldxp" }, rules),
  null,
);
assert.equal(
  classifyProduct("iCloud邮箱子号--指纹浏览器注册，已注册GPT，带有试用资格", "", rules).category,
  "other",
);
assert.equal(
  classifyProduct("谷歌临时邮箱 注册gpt专用", "", rules).category,
  "other",
);
assert.equal(
  normalizeLdxpProduct({
    goods_key: "jftyl3",
    name: "📚 ChatGPT 土区开通稳定订阅教程【帮您少踩坑】",
    description: "",
    price: "1.00",
    extend: { stock_count: "99" },
    link: "/item/jftyl3",
  }, { id: "ldxp-test", name: "test", url: "https://pay.ldxp.cn/shop/test", adapter: "ldxp" }, rules),
  null,
);
assert.equal(
  classifyProduct("ChatGPT Plus 成品号（看教程还不会使用的别拍）", "", rules).category,
  "codex",
);
assert.equal(
  classifyProduct("ChatGPT Plus 成品号（看教程还不会使用的别拍）", "", rules).subtype,
  "plus",
);
for (const title of [
  "【GPT-K12充值】理论2年，可用codex，无需接码",
  "【GPT-K12充值】理论2年，可用codex",
  "【GPT-K12充值】质保首登，无需接码，可用codex",
  "ChatGPT K12充值 理论2年 可用codex",
]) {
  assert.equal(classifyProduct(title, "", rules).category, "other");
  assert.equal(
    normalizeLdxpProduct({
      goods_key: "k12-test",
      name: title,
      description: "",
      price: "39.90",
      extend: { stock_count: "4" },
      link: "/item/k12-test",
    }, { id: "ldxp-test", name: "test", url: "https://pay.ldxp.cn/shop/test", adapter: "ldxp" }, rules),
    null,
  );
}
for (const title of [
  "谷歌GPT K12 成品1个｜Sub2API/CPA JSON可选｜首登质保｜可刷AT",
  "《精品》谷歌GPTK12/json成品/可刷AT/基本能用完周限100-150刀",
]) {
  assert.equal(classifyProduct(title, "", rules).category, "codex");
  assert.equal(classifyProduct(title, "", rules).subtype, "free");
}

assert.equal(
  classifyProduct("CHATGPT FREE号 （已经接过码）", "RT JSON 包含账号密码", rules).category,
  "codex",
);
assert.equal(
  classifyProduct("CHATGPT FREE号 （已经接过码）", "RT JSON 包含账号密码", rules).subtype,
  "free",
);
assert.equal(
  classifyProduct("【顶级月卡】CodexAPI 300刀额度/天", "", rules).subtype,
  "api",
);
assert.equal(
  classifyProduct("plus--【codex可用】--该商品质保30天", "", rules).subtype,
  "plus",
);
assert.equal(
  classifyProduct("G pro plus 菲区充值 （质保一个月）", "", rules).category,
  "codex",
);
assert.equal(
  classifyProduct("G pro plus 菲区充值 （质保一个月）", "", rules).subtype,
  "plus",
);
assert.equal(
  classifyProduct(
    "G pro plus 菲区充值 （质保一个月）",
    "菲律宾官方代充 plus 1个月 质保跟随openai官方",
    rules,
  ).subtype,
  "plus",
);
assert.equal(
  classifyProduct("ChatGPT Pro 20x 月卡 正价官方直充", "codex 额度刷新", rules).subtype,
  "pro_20x",
);
assert.equal(
  classifyProduct("ChatGPT Pro 5x 月卡 正价官方直充", "codex 额度刷新", rules).subtype,
  "pro_5x",
);
assert.equal(
  classifyProduct("ChatGPT Pro 成品号", "", rules).subtype,
  "pro_5x",
);
for (const title of [
  "Claude Pro 成品号/代充【质保一个月】美区",
  "【IOS美区】CLAUDE Pro 官方充值（月卡） (卡密可囤)",
  "Claude-Pro 直充月卡",
]) {
  assert.equal(classifyProduct(title, "", rules).category, "other");
  assert.equal(
    normalizeLdxpProduct({
      goods_key: "claude-pro-test",
      name: title,
      description: "ChatGPT Codex 可用",
      price: "169.00",
      extend: { stock_count: "8" },
      link: "/item/claude-pro-test",
    }, { id: "ldxp-test", name: "test", url: "https://pay.ldxp.cn/shop/test", adapter: "ldxp" }, rules),
    null,
  );
}
for (const title of [
  "Openai Codex 10美金额度🔥卡俄斯x1",
  "Openai Codex 100美金额度🔥创世纪x1",
  "Openai Codex 500美金额度🔥洛基x1 200并发x1",
  "100刀-ChatGPT Codex纯Pro线路-不限时",
  "200刀-ChatGPT Codex纯Pro线路-不限时",
  "🇺🇸 美国私人住宅IP ｜ 独享原生 ｜ 年付套餐",
]) {
  assert.equal(classifyProduct(title, "", rules).category, "other");
}
assert.equal(
  classifyProduct("ChatGPT Plus 月卡 正价官方直充", "稳定性仅次于纯Pro线路", rules).subtype,
  "plus",
);
assert.equal(
  classifyProduct("Perplexity Pro max功能都有，破解版软件，只支持安卓系统", "ChatGPT 分类", rules).category,
  "other",
);
assert.equal(
  classifyProduct("微软长效-outlook-【gr/o2双令牌号】", "刷新令牌取件", rules).category,
  "other",
);
assert.equal(
  classifyProduct("GROK【普号|直登成品｜域名邮箱】只保首登", "", rules).category,
  "grok",
);
assert.equal(
  classifyProduct("GROK【普号|直登成品｜域名邮箱】只保首登", "", rules).subtype,
  "free",
);
assert.equal(
  classifyProduct(
    "【Grok 普号】【帐密+sso】成品｜域名邮箱】无保---不支持grok build,量大联系",
    "GROK【 普号 |直登成品】域名邮箱 三段格式 帐号+密码+sso grok普号 没有会员 1个月 质保",
    rules,
  ).subtype,
  "free",
);
assert.equal(
  classifyProduct("grok普号(福利)", "", rules).subtype,
  "free",
);
assert.equal(
  classifyProduct("grok 普号（7天体验）", "", rules).subtype,
  "free",
);
assert.equal(
  classifyProduct("grok 普号（7天体验）", "", rules).durationLabel,
  "7D",
);
assert.equal(
  classifyProduct("Super Grok 7天会员号---带SSO--质保订阅，最长可用15天，稳定供货", "", rules).subtype,
  "m12",
);
assert.equal(
  classifyProduct("supergrok尝鲜版（7-10天有效期特惠价）", "", rules).subtype,
  "m12",
);
assert.equal(
  classifyProduct("Grok Super正规直充卡密（两个月）", "", rules).subtype,
  "m12",
);
assert.equal(
  classifyProduct("SuperGrok 一个月成品号", "", rules).subtype,
  "m12",
);
assert.equal(
  classifyProduct("Grok Super直充卡密（3个月）", "", rules).subtype,
  "m3",
);
assert.equal(
  classifyProduct("Supergrok Heavy月卡(可直充可成品，质保3天订阅）", "质保3天订阅！！！不质保封号", rules).subtype,
  "m12",
);
assert.equal(
  classifyProduct("Super gro heavy 速刷号成品（质保30分钟内首登，大概率活3天！介意不要下单）", "", rules).category,
  "grok",
);
assert.equal(
  classifyProduct("Super gro heavy 速刷号成品（质保30分钟内首登，大概率活3天！介意不要下单）", "", rules).subtype,
  "m12",
);
assert.equal(
  classifyProduct("Super gro heavy 速刷号成品（质保30分钟内首登，大概率活3天！介意不要下单）", "", rules).durationLabel,
  "1M",
);
assert.equal(
  classifyProduct("【质保30分钟首登)】Gro Heavy成品号 活2-3天", "", rules).category,
  "grok",
);
assert.equal(
  classifyProduct("【质保30分钟首登)】Gro Heavy成品号 活2-3天", "", rules).subtype,
  "m12",
);
assert.equal(
  classifyProduct("Supergro Heavy 成品！(成品质保订阅24h，不质保封号)", "", rules).category,
  "grok",
);
assert.equal(
  classifyProduct("Supergro Heavy 成品！(成品质保订阅24h，不质保封号)", "", rules).subtype,
  "m12",
);
assert.equal(
  classifyProduct("Supergro Heavy 成品！(成品质保订阅24h，不质保封号)", "", rules).durationLabel,
  "1M",
);
assert.equal(
  classifyProduct("Super G r o k Heavy 特殊渠道月卡成品号2（质保首登，首登成功后账号问题不会有任何售后和补偿，现货）", "", rules).subtype,
  "m12",
);
assert.equal(
  classifyProduct("Supergr0k Heavy月卡(质保2h内首登）", "", rules).subtype,
  "m12",
);
assert.equal(
  classifyProduct("gro-Heavy 1 个月成品 已稳11天｜质保发货10分钟内首登（不接受不要买）散户不建议买！", "", rules).subtype,
  "m12",
);
assert.equal(
  classifyProduct("Super gro heavy一年（质保首登，直充质保会员到账）", "Super gro heavy一年官方价值3000美刀/年", rules).subtype,
  "y1",
);
assert.equal(
  classifyProduct("Super gro heavy一年（质保首登，直充质保会员到账）", "", rules).durationLabel,
  "1Y",
);
assert.equal(
  classifyProduct("SuperGrok Heavy12个月年卡质保订阅7天，可开发票", "", rules).subtype,
  "y1",
);
assert.equal(
  classifyProduct("SuperGrok Heavy12个月年卡质保订阅7天，可开发票", "", rules).durationLabel,
  "1Y",
);
assert.equal(
  classifyProduct("【IOS美区】gro Supergro Heavy 官方充值（月卡） (ID直充)", "", rules).subtype,
  "m12",
);
assert.equal(
  classifyProduct("Super gr0k heavy成品（质保一周订阅）", "supergr0k heavy谷歌内购成品 质保1周", rules).category,
  "grok",
);
assert.equal(
  classifyProduct("Super gr0k heavy成品（质保一周订阅）", "supergr0k heavy谷歌内购成品 质保1周", rules).subtype,
  "m12",
);
assert.equal(
  classifyProduct("Super gr0k heavy成品（质保一周订阅）", "supergr0k heavy谷歌内购成品 质保1周", rules).durationLabel,
  "1M",
);
assert.equal(
  classifyProduct("X-Twitter Premium+自助卡密（赠送Super Grok）", "", rules).category,
  "grok",
);
assert.equal(
  classifyProduct("X-Twitter Premium+自助卡密（赠送Super Grok）", "", rules).subtype,
  "m12",
);
assert.equal(
  classifyProduct("X-Twitter Premium+自助卡密（赠送Super Grok）", "", rules).durationLabel,
  "1M",
);
assert.equal(
  classifyProduct("绝版 gork super 1年成品，", "一年x会员绑定成品Grok账号", rules).category,
  "grok",
);
assert.equal(
  classifyProduct("绝版 gork super 1年成品，", "一年x会员绑定成品Grok账号", rules).subtype,
  "y1",
);
assert.equal(
  classifyProduct("绝版 gork super 1年成品，", "一年x会员绑定成品Grok账号", rules).durationLabel,
  "1Y",
);
assert.equal(
  classifyProduct("Super Grok 1.5视频模型平替", "", rules).category,
  "other",
);
assert.equal(
  classifyProduct("【请看店铺公告】Bug Team 没被封就能一直用 240+的额度", "转换网址 http://xgrok.xdo.icu:18363/", rules).category,
  "other",
);
assert.equal(
  classifyProduct("Bug Team 没被封就能一直用", "GROK 描述里写了也没用", rules).category,
  "other",
);
assert.equal(
  classifyProduct("X（Twitter） Premium会员直充卡密", "", rules).category,
  "other",
);
assert.equal(
  classifyProduct("随机地区2020--2024年邮箱【包GCP资格】（适合做piexl，家庭组，挖矿,注册GPT）", "", rules).category,
  "other",
);
assert.equal(
  classifyProduct("美区 Apple ID 成品号 可注册GPT", "", rules).category,
  "other",
);
assert.equal(
  classifyProduct("苹果ID账号带邮箱，适合注册ChatGPT", "", rules).category,
  "other",
);
assert.equal(
  classifyProduct("ChatGPT GO 会员账号 成品号", "", rules).category,
  "codex",
);
assert.equal(
  classifyProduct("ChatGPT GO 会员账号 成品号", "", rules).subtype,
  "free",
);
for (const title of [
  "【印区卡冲】Gpt go 卡冲（质保一个月）",
  "【IOS】GPT GO官方充值 仅质保不掉订阅，封号无售后",
]) {
  assert.equal(classifyProduct(title, "", rules).category, "codex");
  assert.equal(classifyProduct(title, "", rules).subtype, "free");
}
assert.equal(
  classifyProduct("ChatGPT Google Voice 账号", "", rules).subtype,
  "unknown",
);
assert.equal(
  classifyProduct("paypal实卡手机号", "", rules).category,
  "other",
);
assert.equal(
  classifyProduct("gpt接码（美卡，无质保，介意勿拍）", "", rules).category,
  "sms",
);
assert.equal(
  classifyProduct("G接马，美国实卡（25min内可多次验证）", "", rules).category,
  "sms",
);
assert.equal(
  classifyProduct("G接马，美国实卡（25min内可多次验证）", "", rules).subtype,
  "codex_sms",
);
assert.equal(
  classifyProduct("G接码，美国实卡（25min内可多次验证）", "", rules).category,
  "sms",
);
assert.equal(
  classifyProduct("【接码】gpt plus/free短效接码专用| 美区卡 | 99%接码成功率，质保接码成功", "", rules).category,
  "sms",
);
assert.equal(
  classifyProduct("【接码】gpt plus/free短效接码专用| 美区卡 | 99%接码成功率，质保接码成功", "", rules).subtype,
  "codex_sms",
);
assert.equal(
  classifyProduct("【接码】gpt plus/free短效接码专用| 美区卡 | 99%接码成功率，质保接码成功", "", rules).tags.includes("sms"),
  true,
);
assert.equal(
  classifyProduct("GPT普号|Free Plan成品✅|rt 格式|自行转换|不会用勿拍|不支持接码登录", "", rules).category,
  "codex",
);
assert.equal(
  classifyProduct("GPT普号|Free Plan成品✅|rt 格式|自行转换|不会用勿拍|不支持接码登录", "", rules).subtype,
  "free",
);
assert.equal(
  classifyProduct("福利网页Plus号,无法反代,不能直接登录codex.如需使用自行接码", "", rules).category,
  "codex",
);
assert.equal(
  classifyProduct("福利网页Plus号,无法反代,不能直接登录codex.如需使用自行接码", "", rules).subtype,
  "plus",
);
assert.equal(
  classifyProduct("GPT普号|Free Plan成品✅|账密直登+RT|长效邮箱|带接码地址|适合业务", "", rules).subtype,
  "free",
);
assert.equal(
  classifyProduct("Codex|账密直登+RT|Codex/GPT已经过手机验证解锁✅|长效邮箱|带接码地址【接码成本上涨，无奈涨价】", "", rules).subtype,
  "free",
);
assert.equal(
  classifyProduct("Gpt Fre 🔥100个（已接码）| outlook.com | 日本", "", rules).subtype,
  "free",
);
assert.equal(
  classifyProduct("gpt free 优质货已接码 可升级plus", "", rules).subtype,
  "free",
);
assert.equal(
  classifyProduct("Gpt Free（codex已接码 | 高额度 | 刷新RT | 非PLUS）| outlook | 美国 | 长效邮", "", rules).subtype,
  "free",
);
assert.equal(
  classifyProduct("Gpt Free（codex已接码 | 高额度 | 刷新RT | 非plus）| outlook | 美国 | 长效邮", "", rules).subtype,
  "free",
);
assert.equal(
  classifyProduct("gpt free 优质货已接码 可升级puls", "", rules).subtype,
  "free",
);
assert.equal(
  classifyProduct("gpt free（90％可开plus）", "", rules).subtype,
  "free",
);
assert.equal(
  classifyProduct("gmail 邮箱 Free 已开通2fa, 百分百0元优惠，开plus专用", "", rules).category,
  "codex",
);
assert.equal(
  classifyProduct("Gpt Free（codex已接码 | Plus升级专用 | 高额度）| outlook | 美国 | 长效邮箱", "", rules).subtype,
  "free",
);
assert.equal(
  classifyProduct("Gpt Free（codex已接码 | Plus升级专用 | 高额度）| outlook | 美国 | 长效邮箱", "", rules).matchReasons.some((reason) => reason.includes("Plus升级专用") || reason.includes("plus升级专用")),
  true,
);
assert.equal(
  classifyProduct("Free号 Plus升级专用", "codex 可用", rules).subtype,
  "free",
);
assert.equal(
  classifyProduct("gmail 邮箱 Free 已开通2fa, 百分百0元优惠，开plus专用", "", rules).subtype,
  "free",
);
assert.equal(
  classifyProduct("Gmail 邮箱，已开通 2FA，0 元优惠，开 Plus 专用", "", rules).subtype,
  "free",
);
assert.equal(
  classifyProduct("GPT Free 的 RT｜已接码｜支持 sub / cpa  / JSON 3个号=5小时plus", "", rules).subtype,
  "free",
);
assert.equal(
  classifyProduct("GPT Free 成品号｜已接码｜可刷新 RT｜支持 sub / cpa  / JSON 3个号=5小时plus", "", rules).subtype,
  "free",
);
assert.equal(
  classifyProduct("gptplus稳定cdk成品账密（需接码质保首登）", "", rules).subtype,
  "plus",
);
assert.equal(
  classifyProduct("GPT puls 成品号 质保首登", "", rules).subtype,
  "plus",
);
assert.equal(
  classifyProduct("GPT半成品账号 质保首登", "", rules).subtype,
  "plus",
);
assert.equal(
  classifyProduct("codex丨菲区代充丨带账单丨质保", "", rules).subtype,
  "plus",
);
assert.equal(
  classifyProduct("codex 1个月丨菲区代充丨卡充带账单丨质保丨无法覆盖", "", rules).subtype,
  "plus",
);
assert.equal(
  classifyProduct("ChatGPT土区直充月卡", "", rules).subtype,
  "plus",
);
assert.equal(
  classifyProduct("【日抛】PLUS未接码-仅网页-icloud📭（质保三小时内首登）", "ChatGPT Codex 可用", rules).subtype,
  "plus",
);
assert.equal(
  classifyProduct("gptplus稳定cdk成品账密（需接码质保首登）", "", rules).category,
  "codex",
);
assert.equal(
  classifyProduct("可达鸭GPT 额度卡 5个号", "", rules).subtype,
  "plus",
);
assert.equal(
  classifyProduct("可达鸭GPT 额度卡 10个号", "", rules).subtype,
  "plus",
);
assert.equal(
  classifyProduct("gpt team【成品号json反代专用】", "", rules).subtype,
  "free",
);
assert.equal(
  classifyProduct(
    "【5x team车 8月26日21点发车】周限制，质保下单后4小时使用，额度最少400刀，401可找回",
    "1. 本商品为 GPT Team 成品 JSON，谷歌邮箱注册。",
    rules,
  ).subtype,
  "free",
);
assert.equal(
  classifyProduct(
    "【5x team车 8月26日21点发车】周限制，质保下单后4小时使用，额度最少400刀，401可找回",
    "1. 本商品为 GPT Team 成品 JSON，谷歌邮箱注册。",
    rules,
  ).category,
  "codex",
);
assert.equal(
  classifyProduct("Codex Team 月权益【车位】（正规车位）【可与plus并存，缓解额度不够用问题】", "", rules).subtype,
  "free",
);
assert.equal(
  classifyProduct("GPT Plus新号CDK充值（pix渠道）", "请勿使用team空间的token充值", rules).subtype,
  "plus",
);
assert.equal(
  classifyProduct("GPt Plus 充值CDK kakao 新渠道 自动充值非成品需自备账号，自己账号有team不能冲", "", rules).subtype,
  "plus",
);
assert.equal(
  classifyProduct("GPt Plus 充值CDK kakao 新渠道 自动充值非成品需自备账号，自己账号有team不能冲", "", rules).matchReasons.some((reason) => reason.includes("plus")),
  true,
);
assert.equal(
  classifyProduct("GPT成品号（三天内封号换新号，30天内质保掉订阅）", "", rules).subtype,
  "plus",
);
assert.equal(
  classifyProduct("GPT成品号（三天内封号换新号，中转可用）", "", rules).subtype,
  "plus",
);
assert.equal(
  classifyProduct("GPT PLUS 镜像站(天卡)", "", rules).category,
  "other",
);
assert.equal(
  classifyProduct("VISA 0 刀虚拟卡 485954 卡密有效期2个小时kiro别拍拍错不退", "不保证绑GPT不会被拒卡", rules).category,
  "other",
);
assert.equal(
  classifyProduct("0.1x 倍率Codex官方中转API 10美元=100美元", "Codex官方中转API 纯Plus号池0.1x倍率", rules).category,
  "other",
);
assert.equal(
  classifyProduct("0.1x 倍率 Codex官方中转API 50美元=500美元额度", "", rules).category,
  "other",
);
assert.equal(
  normalizeLdxpProduct({
    goods_key: "xa9hn6",
    name: "VISA 0 刀虚拟卡 485954 卡密有效期2个小时kiro别拍拍错不退",
    description: "不保证绑GPT不会被拒卡，这与个人手法有关",
    price: "9.90",
    extend: { stock_count: "12" },
    link: "/item/xa9hn6",
  }, { id: "ldxp-test", name: "test", url: "https://pay.ldxp.cn/shop/test", adapter: "ldxp" }, rules),
  null,
);
assert.equal(
  normalizeLdxpProduct({
    goods_key: "bgakju",
    name: "0.1x 倍率Codex官方中转API 10美元=100美元",
    description: "Codex官方中转API 纯Plus号池0.1x倍率",
    price: "10.00",
    extend: { stock_count: "5" },
    link: "/item/bgakju",
  }, { id: "ldxp-test", name: "test", url: "https://pay.ldxp.cn/shop/test", adapter: "ldxp" }, rules),
  null,
);
assert.equal(
  normalizeLdxpProduct({
    goods_key: "e16fey",
    name: "GPT PLUS 镜像站(天卡)",
    description: "",
    price: "9.90",
    extend: { stock_count: "12" },
    link: "/item/e16fey",
  }, { id: "ldxp-test", name: "test", url: "https://pay.ldxp.cn/shop/test", adapter: "ldxp" }, rules),
  null,
);
assert.equal(
  classifyProduct("全新微软邮箱，已注册好OpenAI（不含plus）", "", rules).category,
  "codex",
);
assert.equal(
  classifyProduct("全新微软邮箱，已注册好OpenAI（不含plus）", "", rules).subtype,
  "free",
);
assert.equal(
  classifyProduct("全新微软邮箱，已注册好OpenAI（不含 plus）", "", rules).subtype,
  "free",
);
assert.equal(
  classifyProduct("OpenAI 微软邮箱 不含Plus 长效", "", rules).subtype,
  "free",
);

const ldxp = normalizeLdxpProduct(
  {
    link: "https://pay.ldxp.cn/item/58iqfn",
    goods_key: "58iqfn",
    name: "codex接码！超级稳定，不出码支持换号！",
    price: 1.98,
    category: { name: "ChatGPT" },
    user: { nickname: "AI小铺", token: "echo_dream" },
    extend: { stock_count: 0 },
  },
  { name: "AI小铺", url: "https://pay.ldxp.cn/shop/echo_dream", adapter: "ldxp" },
  rules,
);
assert.equal(ldxp.category, "sms");
assert.equal(ldxp.stockStatus, "out_of_stock");
assert.equal(ldxp.stockCount, 0);

const highPriceLdxp = normalizeLdxpProduct(
  {
    link: "https://pay.ldxp.cn/item/high-price",
    goods_key: "high-price",
    name: "ChatGPT Plus 土区直充",
    price: 2000,
    category: { name: "ChatGPT" },
    extend: { stock_count: 8 },
  },
  { name: "AI小铺", url: "https://pay.ldxp.cn/shop/echo_dream", adapter: "ldxp" },
  rules,
);
assert.equal(highPriceLdxp, null);
assert.deepEqual(
  productsData.items
    .filter((item) => typeof item.price === "number" && item.price >= 2000)
    .map((item) => ({ url: item.url, price: item.price })),
  [],
);
assert.deepEqual(
  productsData.items
    .filter((item) => /claude[\s-]*pro/i.test(item.title || ""))
    .map((item) => item.url),
  [],
);

const acg = normalizeAcgProduct(
  {
    id: 51,
    name: "【试用款】CodexAPI 30刀额度 日卡",
    price: 1.68,
    stock: 56,
    category: { name: "TC中转站" },
  },
  { name: "ACG测试源", url: "https://acg.example/", adapter: "acg" },
  rules,
);
assert.equal(acg.category, "codex");
assert.equal(acg.subtype, "api");
assert.equal(acg.url, "https://acg.example/item/51");

const dujiao = normalizeDujiaoProduct(
  {
    id: 27,
    slug: "gpt-plus-1-2",
    title: { "zh-CN": "【土区】GPT PLUS 1个月自助充值CDK" },
    description: { "zh-CN": "Codex 额度未刷新可等待" },
    price_amount: "105.00",
    stock_status: "low_stock",
    is_sold_out: false,
    auto_stock_available: 2,
    category: { name: { "zh-CN": "gpt" } },
  },
  { name: "Spark-zone", url: "https://spark-zone.org/", adapter: "dujiao" },
  rules,
);
assert.equal(dujiao.subtype, "plus");
assert.equal(dujiao.stockStatus, "low_stock");

assert.deepEqual(
  sortProductsForDisplay([
    { price: 9, stockStatus: "out_of_stock" },
    { price: 5, stockStatus: "in_stock" },
    { price: 7, stockStatus: "low_stock" },
  ]).map((item) => item.price),
  [5, 7, 9],
);

assert.deepEqual(
  refineCodexPlanSubtype("【日抛】plus 未接码", "plus", rules).subtype,
  "plus",
);
assert.deepEqual(
  refineCodexPlanSubtype("chatgpt plus 月卡 正价官方直充", "plus", rules).subtype,
  "plus",
);
assert.equal(
  refineCodexPlanSubtype("ChatGPT GO 会员账号 成品号", "go", rules).subtype,
  "free",
);
assert.equal(
  refineCodexPlanSubtype("chatgpt pro 20x 月卡", "pro", rules).subtype,
  "pro_20x",
);
assert.equal(
  refineCodexPlanSubtype("ChatGPT Pro 成品号", "pro", rules).subtype,
  "pro_5x",
);
assert.equal(
  refineCodexPlanSubtype("Codex额度补充包（10美元codex额度补充包对应250额度）", "pro", rules).subtype,
  "unknown",
);

const creditPackDesc = "CODEX额度补充包，10美元官方直充（需要账号本身已经是plus或pro订阅） 写在前面：充值成品号，脚本号，反代，破限，频繁共享，包括但不限于上述原因导致的封号不提供任何质保，正价实充，只保功能不保封号。 充值步骤： 购买后会得到一个CDK，去指定平台完成充值操作即可。 对应的额度如下：10刀=250额度";
assert.deepEqual(
  classifyProduct("Codex额度补充包（10美元codex额度补充包对应250额度）", creditPackDesc, rules),
  {
    brand: "codex",
    category: "codex",
    subtype: "unknown",
    confidence: 0.68,
    tags: ["unknown"],
    matchReasons: ["命中Codex锚点词: codex"],
  },
);
assert.equal(
  classifyProduct("Codex 点数额度充值 (Free账号勿下)", "", rules).subtype,
  "unknown",
);

// Grok 规避词变体测试
assert.equal(
  classifyProduct("G rok Super heavy 速刷只接大量｜质保发货10分钟内首登（不接受不要买）散户不建议买！", "", rules).category,
  "grok",
);
assert.equal(
  classifyProduct("gro Super heavy速刷成品号|无质保 一个月(源头)【安卓IOS通用】无bot", "", rules).category,
  "grok",
);
assert.equal(
  classifyProduct("gro Super heavy速刷成品号|无质保 一个月(源头)【安卓IOS通用】无bot", "", rules).subtype,
  "m12",
);
assert.equal(
  classifyProduct("Super gro heavy成品30天订阅质保，不质保封号", "", rules).subtype,
  "m12",
);
assert.equal(
  classifyProduct("Supergro Heavy月卡谷歌内购成品号，质保订阅24小时，可开发票", "", rules).subtype,
  "m12",
);
assert.equal(
  classifyProduct("【直充】X-Premium+Super gro一个月自助直充卡密【质保一个月】", "", rules).category,
  "grok",
);
assert.equal(
  classifyProduct("【直充】X-Premium+Super gro一个月自助直充卡密【质保一个月】", "", rules).subtype,
  "m12",
);
assert.equal(
  classifyProduct("Super G r o k Heavy 特殊渠道月卡成品号2（质保首登，首登成功后账号问题不会有任何售后和补偿，现货）", "", rules).subtype,
  "m12",
);
assert.equal(
  classifyProduct("Supergr0k Heavy月卡(质保2h内首登）", "", rules).subtype,
  "m12",
);
assert.equal(
  classifyProduct("gro普号（新号）", "", rules).subtype,
  "free",
);
assert.equal(
  classifyProduct("gro普号（库存）", "", rules).subtype,
  "free",
);
assert.equal(
  classifyProduct("【gro 普号】【帐密+sso】成品｜域名邮箱】无保---不支持gro build,量大联系", "", rules).subtype,
  "free",
);
assert.equal(
  classifyProduct("gro4.6 build号 质保一周", "", rules).subtype,
  "free",
);
assert.equal(
  classifyProduct("chatgpt group buy 拼车", "", rules).category,
  "codex",
);


