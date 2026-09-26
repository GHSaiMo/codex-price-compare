export function textOf(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "object") {
    return value["zh-CN"] || value["zh_CN"] || value.cn || value.en || value["en-US"] || "";
  }
  return "";
}

export function stripHtml(value) {
  return textOf(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesTerm(haystack, term) {
  const normalizedHaystack = String(haystack || "").toLowerCase();
  const normalizedTerm = term.toLowerCase();
  // go 需要完整词边界，避免 google / good 误命中。
  if (normalizedTerm === "go") {
    return /(^|[^a-z0-9])go(?=$|[^a-z0-9])/.test(normalizedHaystack);
  }
  // gro 限制右侧边界不能直接接英文单词，避免 group / grow / gross 等词误命中。
  if (normalizedTerm === "gro") {
    return /(^|[^a-z0-9])gro(?=[^a-z]|$)/.test(normalizedHaystack);
  }
  // grok / gork / gr0k 限制边界，保留 grok4.5 这类标题与错拼别名。
  if (normalizedTerm === "grok" || normalizedTerm === "gork" || normalizedTerm === "gr0k") {
    return /(^|[^a-z0-9])(grok|gork|gr0k)/.test(normalizedHaystack);
  }
  // 规避变体：G rok / G r o k / g r 0 k 等带空格拼写
  if (normalizedTerm === "g rok" || normalizedTerm === "g r o k") {
    return /(^|[^a-z0-9])g\s+r\s*[o0]\s*k(?=$|[^a-z0-9]|\d)/.test(normalizedHaystack);
  }
  return normalizedHaystack.includes(normalizedTerm);
}

function matchedTerms(haystack, terms) {
  return terms.filter((term) => includesTerm(haystack, term));
}

function firstMatchedSubtype(haystack, subtypeTerms = {}) {
  return Object.entries(subtypeTerms).find(([, terms]) => {
    return matchedTerms(haystack, terms).length > 0;
  })?.[0] || "unknown";
}

function titleReasonTermsForSubtype(rules, subtype) {
  return [
    ...new Set([
      ...(rules.titleSubtypeTerms?.[subtype] || []),
      ...(rules.subtypeTerms?.[subtype] || []),
    ]),
  ];
}

function explicitPlanSubtype(haystack, subtypeTerms = {}, rules = {}) {
  // 标题里的 free/plus/pro/go 明确套餐词优先。如果包含 team 则优先归为 free。
  // 这里只认核心套餐词，不直接复用 subtypeTerms 全量词表。
  if (matchedTerms(haystack, ["team", "free", "fre", "free号", "普号", "普通号", "普通账号", "普通帐号", "bug free", "bug free号"]).length > 0) {
    return "free";
  }
  const hasPlus = matchedTerms(haystack, ["plus", "puls"]).length > 0;
  const has5x = matchedTerms(haystack, rules?.pro5xTerms || ["5x", "5倍"]).length > 0;
  const has20x = matchedTerms(haystack, rules?.pro20xTerms || ["20x", "20倍"]).length > 0;
  const hasPro = matchedTerms(haystack, ["pro", "5x", "20x"]).length > 0;

  if (hasPlus) {
    // 包含 plus 且无明确 5x / 20x 交付词时，优先归为 plus（如 "G pro plus" 无5x归入plus）
    if (!has5x && !has20x) {
      return "plus";
    }
    return "pro";
  }

  if (hasPro) {
    return "pro";
  }

  if (matchedTerms(haystack, ["go"]).length > 0) {
    return "go";
  }

  return "unknown";
}

function stripPlusUpgradeContext(text) {
  return text
    .replace(/(?:可|自行|自己|如需|支持)?\s*(?:升级|开通|开|充值)\s*(?:plus|puls)/gi, " ")
    .replace(/(?:非|不是|并非)\s*[-_]?\s*(?:plus|puls)/gi, "")
    .replace(/(?:不含|没有|无)\s*[-_]?\s*(?:plus|puls)/gi, "")
    .replace(/[=＝]\s*[0-9一二三四五六七八九十两]+\s*小时\s*(?:plus|puls)/gi, "")
    .replace(/(?:plus|puls|pro|free)\s*(?:[/／]\s*(?:plus|puls|pro|free|codex|gpt))*\s*接[码马]/gi, " ")
    .replace(/(?:chatg|chatgpt|gpt)\s+(?:plus|puls)\s+codex\s+接[码马]/gi, " ");
}

function stripTeamWarningContext(text) {
  return text
    .replace(/(?:自己账号|账号)?\s*(?:有|带|含)?\s*team\s*(?:不能|不可|无法|请勿|禁止|别|禁)\s*(?:冲|充|使用)?/gi, " ")
    .replace(/(?:请勿|不要|禁|不支持|不能|无法)\s*(?:使用|带|有)?\s*team/gi, " ")
    .replace(/(?:非|不是|并非|不含|没有|无)\s*[-_]?\s*team/gi, " ");
}

function stripHypotheticalPlusContext(text) {
  return text
    .replace(/(?:如果|若|如|假设|倘若|遇到|若遇|如有|若有)[^。！!？?\n]{0,30}(?:出现|存在|是|发生)?[^。！!？?\n]{0,20}(?:不是|并非|不含|没有|无)\s*[-_]?(?:plus|puls)(?:的情况|的问题)?/gi, " ")
    .replace(/(?:如果|若|如|假设|倘若|遇到|若遇|如有|若有|出现)[^。！!？?\n]{0,50}(?:不是|并非|不含|没有|无)\s*[-_]?(?:plus|puls)[^。！!？?\n]{0,50}(?:换号|换|补|补偿|赔|退|处理|售后|包换|包退|联系)/gi, " ")
    .replace(/除非\s*(?:出现|存在)?[^。！!？?\n]{0,30}(?:不是|并非|不含|没有|无)\s*[-_]?(?:plus|puls)/gi, " ");
}

function stripPlanPrerequisiteContext(text) {
  return text
    .replace(
      /(?:(?:需|需要)\s*(?:自备)?\s*(?:账号|帐号)?\s*(?:本身)?\s*(?:已经是|已有|已开通|需是|需要是|需要|需|是)?|自备\s*(?:账号|帐号)?\s*(?:本身)?\s*(?:已经是|已有|已开通|需是|需要是|需要|需|是)?|(?:账号|帐号)\s*(?:本身)?\s*(?:已经是|已有|已开通|需是|需要是)|(?:本身)\s*(?:已经是|已有|已开通|需是|需要是)|已经是|已有|已开通)\s*(?:plus|puls|pro)(?:[或/与及和、\s]+(?:plus|puls|pro))*\s*(?:订阅|会员|账号|帐号)?/gi,
      " ",
    )
    .replace(/[（(]\s*(?:gpt\s*)?(?:free|Free)\s*账号(?:勿|请勿|无法|不能|不可)[下拍购买].*?[)）]/gi, " ")
    .replace(/(?:需知[：:]\s*)?(?:gpt\s*)?(?:free|Free)\s*账号(?:勿|请勿|无法|不能|不可|禁止|别)\s*(?:下拍|下单|购买|充值|使用|升级)/gi, " ")
    .replace(/[（(]\s*(?:free|Free)账号勿[下拍].*?[)）]/gi, " ")
    .replace(/(?:free|Free)账号勿[下拍]/gi, " ");
}

function matchFreeUpgradePurpose(text) {
  return text.match(
    /(?:(?:开通?|升级)\s*(?:plus|puls)|(?:plus|puls)\s*(?:开通?|升级))\s*专用/i,
  )?.[0] || "";
}

function matchNonPlusNegation(text) {
  return text.match(/(?:非|不是|并非|不含)\s*[-_]?\s*(?:plus|puls)/i)?.[0] || "";
}

function hasSmsNegation(text) {
  return /不支持.{0,8}接[码马]|不能.{0,8}接[码马]|无法.{0,8}接[码马]|禁止.{0,8}接[码马]|如需.{0,8}接[码马]|(?:需要|需)\s*(?:自行|自己|手机|自己手机)?\s*接[码马]|自行接[码马]|自己接[码马]|接[码马]可登|接[码马]登录|接[码马]以后|不含接[码马]|无接[码马]|没绑手机|未绑手机|需绑卡|需绑手机|官方充值|直充/.test(text);
}

function hasStrongSmsServiceSignal(text) {
  return (
    /(?:短效|长效|单次|\d+次|一次性)?接[码马]专用/.test(text)
    || /短效接[码马]|长效接[码马]|短效[码马]|长效[码马]|单次接[码马]|单次[码马]|\d+次接[码马]|\d+次[码马]|一次性接[码马]|一次性[码马]/.test(text)
    || /接[码马]成功率|质保接[码马]成功|质保不来[码马]|不出[码马]支持换号|包接到|质保首[码马]|质保首接|保首接[码马]/.test(text)
    || /(?:可|支持|自助|自动)换号|\d+次自助换号|换号\d+次|换号码|无限换号/.test(text)
    || /(?:全)?自动(?:发卡)?(?:取[码马]|接[码马])|自助(?:取[码马]|接[码马])|无限取[码马]|接[码马]服务/.test(text)
    || /(?:plus|puls|pro|free|gpt|chatg|codex|g)[\s/／]+(?:plus|puls|pro|free|gpt|chatg|codex|g)*[\s/／]*接[码马]|(?:plus|puls|pro|free|gpt|chatg|codex|g)接[码马]/.test(text)
    || /接手机验证[码马]|手机验证[码马]|短信接[码马]|短信验证[码马]?|接[码马]验证|手机接[码马]/.test(text)
    || /(?:实卡|实体卡|虚拟卡|美卡).{0,10}(?:多次|单次|\d+次)?验证|可多次验证|多次验证/.test(text)
    || /(?:实卡|实体卡).{0,12}接[码马]/.test(text)
    || /(?:自动化|自动)?codex绑定|绑定codex/.test(text)
    || /【(?:单次|短效|长效)?接[码马]】|t-mobile/.test(text)
    || /(?:美国|美区|us|实体|虚拟)?实卡.{0,20}(?:可绑|[一二两三四\d]绑|绑号|有效期|可注册)/i.test(text)
    || /(?:可绑\s*\d+(?:-\d+)?个?号|[一二两三四\d]绑)/.test(text)
    || /接不到退款|秒接/.test(text)
  );
}

export function isTutorialProduct(title) {
  const text = String(title || "").trim();
  if (!text) return false;

  // 1. 明确的教程标签括号：【教程】、[教程]、(教程) 等，排除账号卖点/免责括号（如【带教程】、【看教程】）
  const bracketMatches = text.match(/[【\[(（][^】\])）]*?[】\])）]/g) || [];
  for (const b of bracketMatches) {
    const inner = b.slice(1, -1).trim();
    if (/教程/.test(inner)) {
      if (!/(?:带|送|含|附|包|配|有|赠送|提供|无|不提供|没有|看|请看|参考|阅读|不会|未阅读)/.test(inner)) {
        return true;
      }
    }
  }

  // 2. 剥离账号商品中常见的教程说明/赠品/免责声明
  const stripped = text
    .replace(/[（(][^）)]*?教程[^）)]*?[)）]/gi, " ")
    .replace(/[【\[][^】\]]*?(?:带|送|含|附|包|配|有|赠送|提供|无|不提供|没有|看|请看|参考|阅读|不会|未阅读)\s*(?:视频|图文|详细|使用|登录|新手|充值|反代|反向代理|注册)?\s*教程[^】\]]*?[】\]]/gi, " ")
    .replace(/(?:带|送|含|附|包|配|有|赠送|提供|无|不提供|没有|无需|不需要)\s*(?:视频|图文|详细|使用|登录|新手|充值|反代|反向代理|注册)?\s*教程/gi, " ")
    .replace(/(?:看|看下|请看|阅读|参考|搞不懂|不懂)\s*(?:视频|图文|详细|使用|登录|新手)?\s*教程/gi, " ");

  // 3. 常见独立教程特征词
  if (/(?:反代|反向代理|订阅|开通|注册|登录|使用|充值|接[码马]|导入|sub2api|sub2|视频|图文|新手|小白|保姆级)\s*教程/i.test(stripped)) {
    return true;
  }

  // 4. 以教程开头或以教程结尾
  if (/^教程(?=$|\s|[:：])/i.test(stripped)) {
    return true;
  }
  if (/教程\s*(?:（.*）|\(.*\)|\{.*\}|【.*】|\[.*\])*\s*$/i.test(stripped)) {
    return true;
  }

  return false;
}

export function isCreditQuotaProduct(title) {
  const text = String(title || "").toLowerCase().trim();
  if (!text) return false;
  if (/(?:非|not|no)\s*[-_]?\s*api/.test(text)) return true;
  if (/(?:^|[^a-z0-9$刀美])\d+\s*额度/.test(text)) return true;
  if (/(?:官方充值|直充|充值).{0,8}(?:codex|gpt)?.{0,8}额度|额度.{0,8}(?:官方充值|直充|充值)/.test(text)) return true;
  return false;
}

function isFinishedAccountSmsMention(text) {
  // Plus/Free 成品号会写“美区长效接码/已使用...接码”，这是账号卖点而不是接码服务本身。
  return (
    /已使用.{0,12}(?:长效|短效|单次)?接[码马]/.test(text)
    || /(?:成品|直卡|现货|账号注册|谷歌账号|google\s*账号|rt\s*文件|首登|free号|plus号|pro号|账号|帐号|有\s*rt).{0,24}(?:长效|短效|单次)?接[码马]/.test(text)
    || /(?:长效|短效|单次)?接[码马].{0,24}(?:成品|直卡|现货|账号注册|谷歌账号|google\s*账号|rt\s*文件|首登|free号|plus号|pro号|账号|帐号|有\s*rt)/.test(text)
  ) && !/(?:质保不来[码马]|注册通用|接[码马]专用|单次接[码马]|短效[码马]|包接到|质保接[码马]成功|接[码马]成功率|接不到退款|秒接|接[码马]验证|换号码|无限换号|同一账[号户])/i.test(text);
}

function isSmsServiceProduct(titleOnly, smsMatches, accountStateMatches) {
  return (
    smsMatches.length > 0
    && accountStateMatches.length === 0
    && !hasSmsNegation(titleOnly)
    && hasStrongSmsServiceSignal(titleOnly)
    && !isFinishedAccountSmsMention(titleOnly)
  );
}

function normalizePrice(value) {
  const price = Number.parseFloat(value);
  return Number.isFinite(price) ? price : null;
}

const DEFAULT_PRICE_FLOORS = {
  "codex:pro_5x": 150,
  "codex:pro_20x": 100,
};

export function isBlockedPrice(price, category, subtype, rules = {}) {
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) return true;
  if (price >= 2000) return true;

  if (category && subtype) {
    const key = `${category}:${subtype}`;
    const floor = rules.priceFloors?.[key] ?? DEFAULT_PRICE_FLOORS[key];
    if (typeof floor === "number" && price < floor) {
      return true;
    }
  }

  return false;
}

export function resolveAcgPrice(raw) {
  const price = normalizePrice(raw.price);
  const userPrice = normalizePrice(raw.user_price);

  if (price !== null && userPrice !== null) {
    // 正常情况下零售价 price >= userPrice（或两者相等）。
    // 若会员价显著大于零售价（例如 2 倍及以上），说明零售标价存在漏输 0 或倒挂失误，优先采纳 user_price
    if (userPrice >= price * 2) {
      return userPrice;
    }
    return price;
  }

  return price ?? userPrice ?? null;
}

function normalizeStockStatus(stockCount, explicitStatus, isSoldOut = false) {
  if (isSoldOut || explicitStatus === "out_of_stock" || stockCount === 0) return "out_of_stock";
  if (explicitStatus === "low_stock") return "low_stock";
  if (explicitStatus === "in_stock") return "in_stock";
  if (typeof stockCount === "number" && stockCount > 0 && stockCount <= 5) return "low_stock";
  if (typeof stockCount === "number" && stockCount > 0) return "in_stock";
  return "unknown";
}

function buildResult(category, subtype, confidence, tags, matchReasons, extra = {}) {
  return {
    brand: category === "grok" ? "grok" : (category === "gemini" ? "gemini" : "codex"),
    category,
    subtype,
    confidence,
    tags: [...new Set(tags)],
    matchReasons,
    ...extra,
  };
}

export function refineCodexPlanSubtype(haystack, subtype, rules = {}) {
  if (subtype === "plus" || subtype === "plus_trial" || subtype === "plus_ready" || subtype === "plus_topup") {
    return { subtype: "plus", parent: "plus", matches: [] };
  }

  if (subtype === "go") {
    return { subtype: "free", parent: "free", matches: [] };
  }

  if (subtype === "pro") {
    const heavyMatches = matchedTerms(haystack, rules.pro20xTerms || []);
    if (heavyMatches.length > 0) {
      return { subtype: "pro_20x", parent: "pro", matches: heavyMatches };
    }
    const standardMatches = matchedTerms(haystack, rules.pro5xTerms || []);
    if (standardMatches.length > 0) {
      return { subtype: "pro_5x", parent: "pro", matches: standardMatches };
    }
    const plusMatches = matchedTerms(haystack, ["plus", "puls"]);
    if (plusMatches.length > 0) {
      return { subtype: "plus", parent: "plus", matches: plusMatches };
    }
    if (matchedTerms(haystack, ["pro"]).length > 0) {
      return { subtype: "pro_5x", parent: "pro", matches: ["pro"] };
    }
    return { subtype: "unknown", parent: "unknown", matches: [] };
  }

  return { subtype, parent: subtype, matches: [] };
}

function finalizeCodexPlanResult(result, haystack, rules) {
  if (!result || result.category !== "codex") return result;
  const refined = refineCodexPlanSubtype(haystack, result.subtype, rules);
  if (refined.subtype === result.subtype) return result;
  const tags = refined.subtype === "unknown"
    ? ["unknown"]
    : [...new Set([refined.parent, refined.subtype, ...(result.tags || [])])];
  return {
    ...result,
    subtype: refined.subtype,
    confidence: refined.subtype === "unknown" ? Math.min(result.confidence, 0.68) : result.confidence,
    tags,
    matchReasons: [
      ...(result.matchReasons || []),
      ...refined.matches.slice(0, 2).map((term) => `命中交付词: ${term}`),
    ],
  };
}

function stripNoiseDurationText(text, noiseTerms = []) {
  let output = text;
  for (const term of noiseTerms) {
    output = output.split(term.toLowerCase()).join(" ");
  }
  return output.replace(/\s+/g, " ").trim();
}

function stripGrokWarrantyNoiseText(text) {
  let output = text;
  output = output.replace(/(?:大概率|大概|只能|只|能|可|保)?\s*活\s*\d+(?:\s*[-~～至到]\s*\d+)?\s*天/gi, " ");
  output = output.replace(/已稳定?\s*\d+\s*天/gi, " ");
  output = output.replace(/(?:成品质保|质保|保)?\s*订阅\s*\d+\s*(?:h|小时|天|周)/gi, " ");
  output = output.replace(/质保\s*(?:订阅)?\s*(?:一|1|两|2)\s*周(?:订阅)?/gi, " ");
  output = output.replace(/(?:成品)?质保\s*\d+\s*(?:h|小时|天)(?:订阅)?/gi, " ");
  output = output.replace(/\d+\s*(?:分钟|小时|h|m|天|周|月|个\s*月)\s*(?:质保|保|售后)/gi, " ");
  output = output.replace(/质保\s*(?:发货\s*)?\d+\s*(?:分钟|小时|h|m|天)(?:内)?(?:首登|激活)?/gi, " ");
  output = output.replace(/保\s*\d+\s*(?:分钟|小时|h|m|天)(?:内)?(?:首登|激活)/gi, " ");
  return output.replace(/\s+/g, " ").trim();
}

function durationMeta(subtype, matches = []) {
  if (subtype === "m1") {
    return { subtype: "m1", durationDays: 30, durationLabel: "1M", matches };
  }
  if (subtype === "m3") {
    return { subtype: "m3", durationDays: 90, durationLabel: "3M", matches };
  }
  if (subtype === "m12" || subtype === "y1") {
    return { subtype: "m12", durationDays: 365, durationLabel: "12M", matches };
  }
  return { subtype: "others", durationDays: null, durationLabel: "Others", matches };
}

function matchGrokDuration(text, durationTerms = {}) {
  const ordered = [
    ["m12", durationTerms.m12 || durationTerms.y1 || []],
    ["m3", durationTerms.m3 || []],
    ["m1", durationTerms.m1 || []],
  ];

  for (const [subtype, terms] of ordered) {
    const matches = matchedTerms(text, terms);
    if (matches.length > 0) {
      return durationMeta(subtype, matches);
    }
  }

  const yearMatch = text.match(/(?:^|[^a-z0-9])(?:(\d+)\s*年|(\d+)\s*(?:个\s*)?年|一年|年卡|(\d+)\s*year|one\s*year)(?=$|[^a-z0-9])/i);
  if (yearMatch) {
    return durationMeta("m12", [yearMatch[0].trim()]);
  }

  const monthMatch = text.match(/(\d+|一|两|二|三|四|五|六|七|八|九|十|十二|半)\s*(?:个\s*)?月/);
  if (monthMatch) {
    const numMap = { "半": 0.5, "一": 1, "两": 2, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10, "十二": 12 };
    const months = numMap[monthMatch[1]] ?? Number(monthMatch[1]);
    if (Number.isFinite(months)) {
      if (months <= 1) return durationMeta("m1", [monthMatch[0]]);
      if (months <= 3) return durationMeta("m3", [monthMatch[0]]);
      if (months > 3) return durationMeta("m12", [monthMatch[0]]);
    }
  }

  const weekMatch = text.match(/(\d+|一|两|二|三|四)\s*(?:个\s*)?周/);
  if (weekMatch) {
    const weekMap = { "一": 1, "两": 2, "二": 2, "三": 3, "四": 4 };
    const weeks = weekMap[weekMatch[1]] ?? Number(weekMatch[1]);
    if (Number.isFinite(weeks)) {
      const days = weeks * 7;
      if (days <= 31) return durationMeta("m1", [weekMatch[0]]);
      if (days <= 90) return durationMeta("m3", [weekMatch[0]]);
      return durationMeta("m12", [weekMatch[0]]);
    }
  }

  const dayMatch = text.match(/(\d+)\s*天/);
  if (dayMatch) {
    const days = Number(dayMatch[1]);
    if (Number.isFinite(days)) {
      if (days <= 31) return durationMeta("m1", [dayMatch[0]]);
      if (days <= 90) return durationMeta("m3", [dayMatch[0]]);
      if (days > 90) return durationMeta("m12", [dayMatch[0]]);
    }
  }

  return { subtype: "others", durationDays: null, durationLabel: "Others", matches: [] };
}

function classifyGrokProduct(titleText, descriptionText, rules) {
  const titleOnly = titleText.toLowerCase();
  const combined = `${titleText} ${descriptionText}`.toLowerCase();
  const exclusionMatches = matchedTerms(combined, rules.grokExclusionTerms || [])
    .filter((term) => {
      if (term === "x premium" || term === "twitter premium") {
        return matchedTerms(titleOnly, rules.grokAnchorTerms || []).length === 0;
      }
      return true;
    });
  if (exclusionMatches.length > 0) {
    return buildResult(
      "other",
      "unknown",
      0,
      [],
      exclusionMatches.slice(0, 2).map((term) => `命中Grok排除词: ${term}`),
    );
  }

  // 标题未出现 Grok 锚点时直接忽略，避免描述里的 xgrok 域名等误归类。
  const anchorMatches = matchedTerms(titleOnly, rules.grokAnchorTerms || []);
  if (anchorMatches.length === 0) {
    return buildResult("other", "unknown", 0, [], []);
  }

  const cleanedTitleForNoise = stripGrokWarrantyNoiseText(stripNoiseDurationText(titleOnly, rules.grokNoiseDurationTerms || []));
  const cleanedCombinedForNoise = stripGrokWarrantyNoiseText(stripNoiseDurationText(combined, rules.grokNoiseDurationTerms || []));

  const freeMatches = matchedTerms(cleanedTitleForNoise, rules.grokFreeTerms || []);
  const paidMatches = matchedTerms(titleOnly, rules.grokPaidTerms || []);

  const titleDuration = matchGrokDuration(cleanedTitleForNoise, rules.grokDurationTerms || {});
  const combinedDuration = matchGrokDuration(cleanedCombinedForNoise, rules.grokDurationTerms || {});

  const explicitDuration = ["m1", "m3", "m12"].includes(titleDuration.subtype)
    ? titleDuration
    : (["m1", "m3", "m12"].includes(combinedDuration.subtype) ? combinedDuration : null);

  // 1. 如果是明确的付费 Grok（命中 heavy / supergrok 等付费词），或者具有付费时长 (m12, m3, m1) 且无明确普号词
  const isPaidGrok = paidMatches.length > 0 || (explicitDuration !== null && freeMatches.length === 0);
  if (isPaidGrok) {
    // 若无明确时长，付费 Grok 默认按 1M 处理
    const finalDuration = explicitDuration || {
      subtype: "m1",
      durationDays: 30,
      durationLabel: "1M",
      matches: paidMatches.length > 0 ? [`默认1M(${paidMatches[0]})`] : ["默认1M"],
    };

    const reasons = [
      ...anchorMatches.slice(0, 2).map((term) => `命中Grok锚点词: ${term}`),
    ];
    if (paidMatches.length > 0) {
      reasons.push(...paidMatches.slice(0, 2).map((term) => `命中付费特征: ${term}`));
    }
    if (explicitDuration) {
      reasons.push(...explicitDuration.matches.slice(0, 2).map((term) => `命中时长: ${term}`));
    } else {
      reasons.push("未指定时长默认1M");
    }

    return buildResult(
      "grok",
      finalDuration.subtype,
      0.9,
      ["grok", finalDuration.subtype],
      reasons,
      {
        durationDays: finalDuration.durationDays,
        durationLabel: finalDuration.durationLabel,
      },
    );
  }

  // 2. 如果包含短效/体验词（如 7天、尝鲜、7-10天），且非明确付费 Grok，归入 free 并标注对应天数
  const isTrial = (freeMatches.some((term) => /7天|七天|10天|15天|尝鲜|试玩|试用|体验|日抛/.test(term)) ||
                  (titleDuration.subtype === "others" && titleDuration.durationDays && titleDuration.durationDays <= 15)) &&
                  !explicitDuration;

  if (isTrial) {
    const trialDuration = (titleDuration.durationDays && titleDuration.durationDays <= 15)
      ? titleDuration
      : { durationDays: 7, durationLabel: "7D", matches: freeMatches };
    return buildResult(
      "grok",
      "free",
      0.9,
      ["grok", "free"],
      [
        ...anchorMatches.slice(0, 2).map((term) => `命中Grok锚点词: ${term}`),
        ...freeMatches.slice(0, 2).map((term) => `命中体验词: ${term}`),
      ],
      {
        durationDays: trialDuration.durationDays,
        durationLabel: trialDuration.durationLabel || "7D",
      },
    );
  }

  // 3. 普号 / Free 号
  if (freeMatches.length > 0 || titleDuration.subtype === "others") {
    const freeDurationMatches = freeMatches.length > 0 ? freeMatches : titleDuration.matches;
    return buildResult(
      "grok",
      "free",
      freeMatches.length > 0 ? 0.9 : 0.75,
      ["grok", "free"],
      [
        ...anchorMatches.slice(0, 2).map((term) => `命中Grok锚点词: ${term}`),
        ...freeDurationMatches.slice(0, 2).map((term) => `命中Free词: ${term}`),
      ],
      {
        durationDays: null,
        durationLabel: "Free",
      },
    );
  }

  // 4. 兜底 Free
  return buildResult(
    "grok",
    "free",
    0.75,
    ["grok", "free"],
    anchorMatches.slice(0, 2).map((term) => `命中Grok锚点词: ${term}`),
    {
      durationDays: null,
      durationLabel: "Free",
    },
  );
}

function stripGeminiWarrantyNoiseText(text) {
  let output = text;
  output = output.replace(/(?:大概率|大概|只能|只|能|可|保)?\s*活\s*\d+(?:\s*[-~～至到]\s*\d+)?\s*天/gi, " ");
  output = output.replace(/已稳定?\s*\d+\s*天/gi, " ");
  output = output.replace(/(?:成品质保|质保|保)?\s*订阅\s*\d+\s*(?:h|小时|天|周)/gi, " ");
  output = output.replace(/质保\s*(?:订阅)?\s*(?:一|1|两|2)\s*周(?:订阅)?/gi, " ");
  output = output.replace(/(?:成品)?质保\s*\d+\s*(?:h|小时|天)(?:订阅)?/gi, " ");
  output = output.replace(/\d+\s*(?:分钟|小时|h|m|天|周)\s*(?:质保|保|售后)/gi, " ");
  output = output.replace(/质保\s*(?:发货\s*)?\d+\s*(?:分钟|小时|h|m|天)(?:内)?(?:首登|激活)?/gi, " ");
  output = output.replace(/保\s*\d+\s*(?:分钟|小时|h|m|天)(?:内)?(?:首登|激活)/gi, " ");
  output = output.replace(/\d+\s*小时内包首登/gi, " ");
  output = output.replace(/包首登/gi, " ");
  return output.replace(/\s+/g, " ").trim();
}

function durationMetaGemini(subtype, matches = []) {
  if (subtype === "m18") {
    return { subtype: "m18", durationDays: 540, durationLabel: "18M", matches };
  }
  if (subtype === "m12" || subtype === "y1") {
    return { subtype: "m12", durationDays: 365, durationLabel: "12M", matches };
  }
  if (subtype === "m3") {
    return { subtype: "m3", durationDays: 90, durationLabel: "3M", matches };
  }
  return null;
}

function matchGeminiDuration(text, durationTerms = {}) {
  const ordered = [
    ["m18", durationTerms.m18 || []],
    ["m12", durationTerms.m12 || durationTerms.y1 || []],
    ["m3", durationTerms.m3 || []],
  ];

  for (const [subtype, terms] of ordered) {
    const matches = matchedTerms(text, terms);
    if (matches.length > 0) {
      return durationMetaGemini(subtype, matches);
    }
  }

  const explicitM = text.match(/(?:^|[^a-z0-9])(3|12|18)\s*m(?=$|[^a-z0-9])/i);
  if (explicitM) {
    const m = explicitM[1];
    if (m === "18") return durationMetaGemini("m18", [explicitM[0].trim()]);
    if (m === "12") return durationMetaGemini("m12", [explicitM[0].trim()]);
    if (m === "3") return durationMetaGemini("m3", [explicitM[0].trim()]);
  }

  const yearMatch = text.match(/(?:^|[^a-z0-9])(?:(\d+(?:\.\d+)?)\s*年|一年半|1\.5\s*年|年卡|(\d+)\s*year|one\s*year)(?=$|[^a-z0-9])/i);
  if (yearMatch) {
    if (/一年半|1\.5/i.test(yearMatch[0])) {
      return durationMetaGemini("m18", [yearMatch[0].trim()]);
    }
    return durationMetaGemini("m12", [yearMatch[0].trim()]);
  }

  const monthMatch = text.match(/(\d+|一|两|二|三|四|五|六|七|八|九|十|十二|十八|半)\s*(?:个\s*)?月/);
  if (monthMatch) {
    const numMap = { "半": 0.5, "一": 1, "两": 2, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10, "十二": 12, "十八": 18 };
    const months = numMap[monthMatch[1]] ?? Number(monthMatch[1]);
    if (Number.isFinite(months)) {
      if (months > 12) return durationMetaGemini("m18", [monthMatch[0]]);
      if (months > 3 && months <= 12) return durationMetaGemini("m12", [monthMatch[0]]);
      if (months >= 2 && months <= 3) return durationMetaGemini("m3", [monthMatch[0]]);
    }
  }

  const dayMatch = text.match(/(\d+)\s*天/);
  if (dayMatch) {
    const days = Number(dayMatch[1]);
    if (Number.isFinite(days)) {
      if (days > 365) return durationMetaGemini("m18", [dayMatch[0]]);
      if (days > 90 && days <= 365) return durationMetaGemini("m12", [dayMatch[0]]);
      if (days >= 60 && days <= 90) return durationMetaGemini("m3", [dayMatch[0]]);
    }
  }

  return null;
}

function classifyGeminiProduct(titleText, descriptionText, rules) {
  const titleOnly = titleText.toLowerCase();
  const combined = `${titleText} ${descriptionText}`.toLowerCase();

  const anchorMatches = matchedTerms(titleOnly, rules.geminiAnchorTerms || []);
  if (anchorMatches.length === 0) {
    return buildResult("other", "unknown", 0, [], []);
  }

  const exclusionMatches = matchedTerms(combined, rules.geminiExclusionTerms || [])
    .filter((term) => {
      return matchedTerms(titleOnly, [term]).length > 0;
    });
  if (exclusionMatches.length > 0) {
    return buildResult(
      "other",
      "unknown",
      0,
      [],
      exclusionMatches.slice(0, 2).map((term) => `命中Gemini排除词: ${term}`),
    );
  }

  // Leonardo / 绘图聚合模型排除
  if (/leonardo|绘图|图片模型/i.test(titleOnly) && !/gemini\s*(?:pro|ultra|1\.5|2|3|advanced)/i.test(titleOnly)) {
    return buildResult("other", "unknown", 0, [], ["命中第三方模型聚合商品排除规则"]);
  }

  const cleanedTitleForNoise = stripGeminiWarrantyNoiseText(stripNoiseDurationText(titleOnly, rules.geminiNoiseDurationTerms || []));
  const cleanedCombinedForNoise = stripGeminiWarrantyNoiseText(stripNoiseDurationText(combined, rules.geminiNoiseDurationTerms || []));

  const titleDuration = matchGeminiDuration(cleanedTitleForNoise, rules.geminiDurationTerms || {});
  const combinedDuration = matchGeminiDuration(cleanedCombinedForNoise, rules.geminiDurationTerms || {});

  const explicitDuration = (titleDuration && ["m3", "m12", "m18"].includes(titleDuration.subtype))
    ? titleDuration
    : ((combinedDuration && ["m3", "m12", "m18"].includes(combinedDuration.subtype)) ? combinedDuration : null);

  if (!explicitDuration) {
    return buildResult("other", "unknown", 0, [], ["未匹配到Gemini有效时长规格(3M/12M/18M)，丢弃"]);
  }

  const reasons = [
    ...anchorMatches.slice(0, 2).map((term) => `命中Gemini锚点词: ${term}`),
  ];
  if (explicitDuration.matches?.length > 0) {
    reasons.push(...explicitDuration.matches.slice(0, 2).map((term) => `命中时长/套餐: ${term}`));
  }

  return buildResult(
    "gemini",
    explicitDuration.subtype,
    0.9,
    ["gemini", explicitDuration.subtype],
    reasons,
    {
      durationDays: explicitDuration.durationDays,
      durationLabel: explicitDuration.durationLabel,
    },
  );
}

export function isPureGmailProduct(titleText, descriptionText = "") {
  const title = String(titleText || "").trim();
  const lower = title.toLowerCase();

  // 1. 必须命中 Google / Gmail 身份词或注册老号模式
  const hasGmailIdentity = (
    /gmail|谷歌邮箱|谷歌账号|谷歌帐号|google账号|google帐号|google账户|google帐户|google\s*邮箱|google邮箱|谷歌老号|gmail老号|gmail邮箱|谷歌mail|谷歌成品/i.test(lower) ||
    /(?:\d{2}[-_~至到]\d{2}|\d{4})\s*年?\s*(?:左右注册)?\s*(?:gmail|谷歌)/i.test(lower) ||
    /(?:老号|成品老号|邮箱成品).{0,10}(?:gmail|谷歌)/i.test(lower)
  );
  if (!hasGmailIdentity) return false;

  // 2. 接码排除
  if (/(?:短效|长效|单次|\d+次)?接[码马]|短信接[码马]|短信验证[码马]|手机验证[码马]|换号|无限换号|秒接/i.test(lower)) {
    return false;
  }

  // 3. Grok 排除
  if (/(?:^|[^a-z0-9])(grok|gork|gr0k|supergrok)(?=$|[^a-z0-9]|\d)/i.test(lower)) {
    return false;
  }

  // 4. Gemini 订阅会员排除 (具有有效时长)
  if (/(?:gemini|双子座|google\s*ai|google\s*one\s*ai)/i.test(lower) &&
      /(?:18\s*个?月|一年半|1\.5\s*年|540\s*天|12\s*个?月|一年|年卡|365\s*天|3\s*个?月|季卡|90\s*天|google\s*one\s*5tb|兑换链接)/i.test(lower)) {
    return false;
  }

  // 5. 剥离用于说明邮箱用途的修饰词
  const stripped = lower
    .replace(/(?:用于|只用于|专门|专为|支持)?\s*注册\s*(?:g|gpt|chatgpt|openai|plus|puls)\s*(?:专用)?/gi, " ")
    .replace(/(?:只关注|仅关注)?可不可以注册\s*(?:g|gpt|chatgpt)/gi, " ")
    .replace(/(?:可|自行|自己|如需|支持)?\s*(?:升级|开通|开|充值)\s*(?:plus|puls)/gi, " ")
    .replace(/(?:不含|非|不是|并非|无需|没有|无)\s*[-_]?\s*(?:plus|puls)/gi, " ");

  // 6. 检查剩余文本中是否包含真正的 Codex 交付物
  const hasCodexCore = (
    /(?:^|[^a-z0-9])(?:codex|chatgpt|openai)(?=$|[^a-z0-9])/i.test(stripped) ||
    /(?:^|[^a-z0-9])g\s*(?:free|plus|pro)(?=$|[^a-z0-9])/i.test(stripped) ||
    /(?:^|[^a-z0-9])(?:plus|puls)(?=$|[^a-z0-9])/i.test(stripped) ||
    /(?:^|[^a-z0-9])(?:free|普号|普通号|普通账号|普通帐号)(?=$|[^a-z0-9])/i.test(stripped) ||
    /(?:^|[^a-z0-9])(?:5x|20x|5倍|20倍)(?=$|[^a-z0-9])/i.test(stripped) ||
    Boolean(matchFreeUpgradePurpose(lower)) ||
    /team|k12|cpa|rt\s*文件|openai账号|openai普通账号/i.test(stripped)
  );

  if (hasCodexCore) {
    return false;
  }

  return true;
}

export function classifyGmailProduct(titleText, descriptionText = "", rules = {}) {
  if (!isPureGmailProduct(titleText, descriptionText)) {
    return buildResult("other", "unknown", 0, [], []);
  }

  const titleOnly = titleText.toLowerCase();
  const matched = (rules.geminiGmailTerms || [
    "gmail",
    "谷歌邮箱",
    "谷歌账号",
    "谷歌帐号",
    "google账号",
    "google帐号",
    "google账户",
    "google帐户",
    "google 邮箱",
    "google邮箱",
    "谷歌老号",
    "gmail老号",
    "gmail邮箱",
    "谷歌mail",
    "谷歌成品老号",
    "谷歌邮箱成品",
    "谷歌邮箱成品老号",
    "邮箱成品",
  ]).filter((t) => titleOnly.includes(t));

  const reasons = matched.length > 0
    ? matched.slice(0, 2).map((m) => `命中Gmail/Google账号特征: ${m}`)
    : ["命中Gmail/Google老号命名模式"];

  return buildResult(
    "gemini",
    "gmail",
    0.9,
    ["gemini", "gmail"],
    reasons,
    {
      durationDays: null,
      durationLabel: "Gmail",
    },
  );
}

function classifyCodexProduct(titleText, descriptionText, rules) {
  const combined = `${titleText} ${descriptionText}`.toLowerCase();
  const titleOnly = titleText.toLowerCase();
  const subtypeCombined = stripPlanPrerequisiteContext(stripTeamWarningContext(stripPlusUpgradeContext(combined)));
  const subtypeTitleOnly = stripPlanPrerequisiteContext(stripTeamWarningContext(stripPlusUpgradeContext(titleOnly)));
  const cleanedDescForNegation = stripHypotheticalPlusContext(descriptionText);
  const freeUpgradePurposeMatch = matchFreeUpgradePurpose(titleOnly);
  const nonPlusNegationMatch = matchNonPlusNegation(titleOnly) || matchNonPlusNegation(cleanedDescForNegation);
  const freeTitleHintMatch = Boolean(freeUpgradePurposeMatch || nonPlusNegationMatch);
  const titleExclusionMatches = matchedTerms(titleOnly, rules.titleExclusionTerms || []);
  const exclusionMatches = matchedTerms(combined, rules.exclusionTerms || []);
  const anchorMatches = matchedTerms(combined, rules.anchorTerms || []);
  const titleAccountStateMatches = matchedTerms(titleOnly, rules.accountStateTerms || []);
  const accountStateMatches = matchedTerms(combined, rules.accountStateTerms || []);
  const smsMatches = matchedTerms(titleOnly, rules.smsServiceTerms || []);
  const codexMatches = matchedTerms(combined, rules.codexTerms || []);
  const rawExplicitTitleSubtype = explicitPlanSubtype(subtypeTitleOnly, rules.subtypeTerms, rules);
  const explicitTitleSubtype = (freeTitleHintMatch && rawExplicitTitleSubtype !== "pro")
    ? "free"
    : rawExplicitTitleSubtype;
  const titleOnlySubtype = (freeTitleHintMatch && rawExplicitTitleSubtype !== "pro")
    ? "free"
    : firstMatchedSubtype(subtypeTitleOnly, rules.titleSubtypeTerms);
  // 明确 free/plus/pro 优先于 titleSubtypeTerms 里的次要词（如 team）。
  const titleSubtype = explicitTitleSubtype !== "unknown"
    ? explicitTitleSubtype
    : (titleOnlySubtype !== "unknown"
      ? titleOnlySubtype
      : firstMatchedSubtype(subtypeTitleOnly, rules.subtypeTerms));
  const subtype = firstMatchedSubtype(subtypeCombined, rules.subtypeTerms);

  if (titleExclusionMatches.length > 0 || exclusionMatches.length > 0) {
    return buildResult(
      "other",
      "unknown",
      0,
      [],
      [
        ...titleExclusionMatches.slice(0, 2).map((term) => `命中标题排除词: ${term}`),
        ...exclusionMatches.slice(0, 2).map((term) => `命中排除词: ${term}`),
      ],
    );
  }

  if (anchorMatches.length > 0 || freeTitleHintMatch) {
    if (isSmsServiceProduct(titleOnly, smsMatches, titleAccountStateMatches)) {
      return buildResult(
        "sms",
        rules.smsSubtype || "codex_sms",
        0.95,
        ["codex", "sms"],
        smsMatches.slice(0, 2).map((term) => `命中接码服务词: ${term}`),
      );
    }

    if (["free", "plus", "pro", "go"].includes(titleSubtype)) {
      const reasons = [
        ...(freeUpgradePurposeMatch ? [`命中Free用途词: ${freeUpgradePurposeMatch}`] : []),
        ...(nonPlusNegationMatch ? [`命中非Plus词: ${nonPlusNegationMatch}`] : []),
        ...anchorMatches.slice(0, 2).map((term) => `命中Codex锚点词: ${term}`),
        ...matchedTerms(subtypeTitleOnly, titleReasonTermsForSubtype(rules, titleSubtype)).slice(0, 2).map((term) => `命中套餐词: ${term}`),
      ];
      return buildResult("codex", titleSubtype, 0.9, [titleSubtype], reasons);
    }

    if (smsMatches.length > 0 && titleAccountStateMatches.length === 0 && !hasSmsNegation(titleOnly) && !isFinishedAccountSmsMention(titleOnly)) {
      return buildResult(
        "sms",
        rules.smsSubtype || "codex_sms",
        0.95,
        ["codex", "sms"],
        smsMatches.slice(0, 2).map((term) => `命中接码服务词: ${term}`),
      );
    }

    const reasons = [
      ...anchorMatches.slice(0, 2).map((term) => `命中Codex锚点词: ${term}`),
      ...codexMatches.filter((term) => !anchorMatches.includes(term)).slice(0, 2).map((term) => `命中Codex相关词: ${term}`),
      ...accountStateMatches.slice(0, 2).map((term) => `命中账号状态词: ${term}`),
    ];
    return buildResult("codex", subtype, subtype === "unknown" ? 0.68 : 0.86, [subtype], reasons);
  }

  return buildResult("other", "unknown", 0, [], []);
}

function normalizeManualMatchText(str) {
  return String(str || "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function matchManualOverride(title, rules = {}, context = {}) {
  const manualOverrides = rules?.manualOverrides;
  if (!manualOverrides || typeof manualOverrides !== "object") return null;

  const titleText = stripHtml(title);
  const normalizedTitle = normalizeManualMatchText(titleText);
  const url = context?.url ? String(context.url).trim() : "";
  const id = context?.id ? String(context.id).trim() : "";

  for (const [category, subtypes] of Object.entries(manualOverrides)) {
    if (!subtypes || typeof subtypes !== "object") continue;
    for (const [subtype, entries] of Object.entries(subtypes)) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (!entry) continue;
        let isMatch = false;
        const entryObj = typeof entry === "object" ? entry : null;
        const target = typeof entry === "string" ? entry : (entry?.title || entry?.url || entry?.id || "");

        if (typeof entry === "string") {
          const normTarget = normalizeManualMatchText(target);
          if (normTarget && normTarget === normalizedTitle) {
            isMatch = true;
          } else if (url && (target === url || url.includes(target))) {
            isMatch = true;
          } else if (id && target === id) {
            isMatch = true;
          }
        } else if (entryObj) {
          if (entryObj.title && normalizeManualMatchText(entryObj.title) === normalizedTitle) {
            isMatch = true;
          } else if (entryObj.url && url && (url === entryObj.url || url.includes(entryObj.url))) {
            isMatch = true;
          } else if (entryObj.id && id && id === entryObj.id) {
            isMatch = true;
          }
        }

        if (isMatch) {
          if (category === "other") {
            return buildResult(
              "other",
              subtype || "unknown",
              0,
              [],
              [entryObj?.reason || `命中手工维护排除名单: ${target}`],
            );
          }

          const brand = entryObj?.brand || (category === "grok" ? "grok" : (category === "gemini" ? "gemini" : "codex"));
          const tags = entryObj?.tags || (category === "codex" ? [subtype] : (category === "sms" ? ["codex", "sms"] : [category, subtype]));
          let durationDays = entryObj?.durationDays ?? null;
          let durationLabel = entryObj?.durationLabel ?? null;

          if (durationDays == null && durationLabel == null) {
            if (category === "gemini") {
              if (subtype === "m3") { durationDays = 90; durationLabel = "3M"; }
              else if (subtype === "m12") { durationDays = 365; durationLabel = "12M"; }
              else if (subtype === "m18") { durationDays = 540; durationLabel = "18M"; }
              else if (subtype === "gmail") { durationDays = null; durationLabel = "Gmail"; }
            } else if (category === "grok") {
              if (subtype === "m1") { durationDays = 30; durationLabel = "1M"; }
              else if (subtype === "m3") { durationDays = 90; durationLabel = "3M"; }
              else if (subtype === "m12") { durationDays = 365; durationLabel = "12M"; }
            }
          }

          return buildResult(
            category,
            subtype,
            entryObj?.confidence ?? 1.0,
            tags,
            [entryObj?.reason || `命中手工维护白名单: ${category}/${subtype}`],
            {
              brand,
              durationDays,
              durationLabel,
              ...(entryObj?.bypassPriceFloor ? { bypassPriceFloor: true } : {}),
            },
          );
        }
      }
    }
  }

  return null;
}

export function classifyProduct(title, description = "", rules = {}, context = {}) {
  const manualResult = matchManualOverride(title, rules, context);
  if (manualResult) {
    return manualResult;
  }

  const titleText = stripHtml(title);
  const descriptionText = stripHtml(description);
  const titleOnly = titleText.toLowerCase();
  const titleExclusionMatches = matchedTerms(titleOnly, rules.titleExclusionTerms || []);
  if (titleExclusionMatches.length > 0) {
    return buildResult(
      "other",
      "unknown",
      0,
      [],
      titleExclusionMatches.slice(0, 2).map((term) => `命中标题排除词: ${term}`),
    );
  }

  if (isTutorialProduct(titleText)) {
    return buildResult(
      "other",
      "unknown",
      0,
      [],
      ["命中教程商品排除规则"],
    );
  }

  if (isCreditQuotaProduct(titleText)) {
    return buildResult(
      "other",
      "unknown",
      0,
      [],
      ["命中额度充值商品排除规则"],
    );
  }

  const combined = `${titleText} ${descriptionText}`.toLowerCase();
  // Grok / Gemini 只看标题锚点，防止描述链接/域名把无关商品拉进分类。
  const grokAnchorMatches = matchedTerms(titleOnly, rules.grokAnchorTerms || []);
  const geminiAnchorMatches = matchedTerms(titleOnly, rules.geminiAnchorTerms || []);
  const codexAnchorMatches = matchedTerms(combined, rules.anchorTerms || []);

  if (grokAnchorMatches.length > 0) {
    const grokResult = classifyGrokProduct(titleText, descriptionText, rules);
    if (grokResult.category !== "other") return grokResult;
    if (codexAnchorMatches.length === 0 && geminiAnchorMatches.length === 0) return grokResult;
  }

  if (geminiAnchorMatches.length > 0) {
    const geminiResult = classifyGeminiProduct(titleText, descriptionText, rules);
    if (geminiResult.category !== "other") return geminiResult;
    if (codexAnchorMatches.length === 0) return geminiResult;
  }

  const gmailResult = classifyGmailProduct(titleText, descriptionText, rules);
  if (gmailResult.category !== "other") {
    return gmailResult;
  }

  return finalizeCodexPlanResult(
    classifyCodexProduct(titleText, descriptionText, rules),
    titleOnly,
    rules,
  );
}

function withCommonFields(raw, source, rules, fields) {
  const classification = classifyProduct(fields.title, fields.descriptionText, rules, {
    url: fields.url,
    id: `${source.id || source.name}:${fields.sourceProductId}`,
  });
  if (classification.category === "other") return null;
  const price = normalizePrice(fields.price);
  if (!classification.bypassPriceFloor && isBlockedPrice(price, classification.category, classification.subtype, rules)) return null;

  const isBareMotherSite = !fields.url || /^https?:\/\/[^\/]+\/?$/i.test(fields.url);
  const url = isBareMotherSite ? (source.url || fields.url) : fields.url;

  return {
    id: `${source.id || source.name}:${fields.sourceProductId}`,
    brand: classification.brand || (classification.category === "grok" ? "grok" : (classification.category === "gemini" ? "gemini" : "codex")),
    category: classification.category,
    subtype: classification.subtype,
    confidence: classification.confidence,
    tags: classification.tags,
    matchReasons: classification.matchReasons,
    durationDays: classification.durationDays ?? null,
    durationLabel: classification.durationLabel || null,
    title: fields.title,
    price,
    currency: "CNY",
    stockStatus: normalizeStockStatus(fields.stockCount, fields.stockStatus, fields.isSoldOut),
    stockCount: typeof fields.stockCount === "number" ? fields.stockCount : null,
    url,
    sourceId: source.id || null,
    sourceName: source.name,
    sourceUrl: source.url,
    sourceAdapter: source.adapter,
    sourceCategory: fields.sourceCategory || "",
    descriptionText: stripHtml(fields.descriptionText).slice(0, 300),
    raw: fields.raw,
  };
}

export function normalizeLdxpProduct(raw, source, rules) {
  const base = new URL(source.url);
  const link = raw.link || (raw.goods_key ? `/item/${raw.goods_key}` : "");
  const stockCount = Number(raw.extend?.stock_count);
  const url = link ? new URL(link, base).href : source.url;

  return withCommonFields(raw, source, rules, {
    sourceProductId: raw.goods_key || raw.id || raw.link || raw.name,
    title: raw.name,
    descriptionText: raw.description,
    price: raw.price,
    stockCount: Number.isFinite(stockCount) ? stockCount : null,
    url,
    sourceCategory: raw.category?.name,
    raw: {
      goodsType: raw.goods_type,
      goodsKey: raw.goods_key,
      category: raw.category?.name,
    },
  });
}

export function normalizeAcgProduct(raw, source, rules) {
  const base = new URL(source.url);
  const stockCount = Number(raw.stock);

  return withCommonFields(raw, source, rules, {
    sourceProductId: raw.id,
    title: raw.name,
    descriptionText: raw.description || "",
    price: resolveAcgPrice(raw),
    stockCount: Number.isFinite(stockCount) ? stockCount : null,
    url: new URL(`/item/${raw.id}`, base).href,
    sourceCategory: raw.category?.name,
    raw: {
      id: raw.id,
      categoryId: raw.category_id,
      category: raw.category?.name,
      deliveryWay: raw.delivery_way,
      stockState: raw.stock_state,
    },
  });
}

export function normalizeDujiaoProduct(raw, source, rules) {
  const base = new URL(source.url);
  const title = textOf(raw.title);
  const descriptionText = `${textOf(raw.description)} ${stripHtml(raw.content)}`.trim();
  const stockCount = Number(raw.auto_stock_available ?? raw.manual_stock_available);

  return withCommonFields(raw, source, rules, {
    sourceProductId: raw.id || raw.slug,
    title,
    descriptionText,
    price: raw.price_amount,
    stockCount: Number.isFinite(stockCount) ? stockCount : null,
    stockStatus: raw.stock_status,
    isSoldOut: raw.is_sold_out,
    url: new URL(`/products/${raw.slug || raw.id}`, base).href,
    sourceCategory: textOf(raw.category?.name),
    raw: {
      id: raw.id,
      slug: raw.slug,
      category: textOf(raw.category?.name),
    },
  });
}

export function sortProductsForDisplay(items) {
  const stockRank = { in_stock: 0, low_stock: 0, unknown: 1, out_of_stock: 2 };
  return [...items].sort((a, b) => {
    const stockDiff = (stockRank[a.stockStatus] ?? 1) - (stockRank[b.stockStatus] ?? 1);
    if (stockDiff !== 0) return stockDiff;
    return (a.price ?? Number.POSITIVE_INFINITY) - (b.price ?? Number.POSITIVE_INFINITY);
  });
}
