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
  if (matchedTerms(haystack, ["team", "free", "fre", "free号", "普号"]).length > 0) {
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
    .replace(/(?:可|自行|自己|如需|支持)?\s*(?:升级|开通|开|充值)\s*(?:plus|puls)/g, " ")
    .replace(/(?:非|不是|并非)\s*[-_]?\s*(?:plus|puls)/g, "")
    .replace(/(?:不含|没有|无)\s*[-_]?\s*(?:plus|puls)/g, "")
    .replace(/[=＝]\s*[0-9一二三四五六七八九十两]+\s*小时\s*(?:plus|puls)/g, "")
    .replace(/(?:plus|puls|pro|free)\s*(?:[/／]\s*(?:plus|puls|pro|free|codex|gpt))*\s*接[码马]/g, " ")
    .replace(/(?:chatg|chatgpt|gpt)\s+(?:plus|puls)\s+codex\s+接[码马]/g, " ");
}

function stripTeamWarningContext(text) {
  return text
    .replace(/(?:自己账号|账号)?\s*(?:有|带|含)?\s*team\s*(?:不能|不可|无法|请勿|禁止|别|禁)\s*(?:冲|充|使用)?/g, " ")
    .replace(/(?:请勿|不要|禁|不支持|不能|无法)\s*(?:使用|带|有)?\s*team/g, " ")
    .replace(/(?:非|不是|并非|不含|没有|无)\s*[-_]?\s*team/g, " ");
}

function stripPlanPrerequisiteContext(text) {
  return text
    .replace(
      /(?:(?:需|需要)\s*(?:自备)?\s*(?:账号|帐号)?\s*(?:本身)?\s*(?:已经是|已有|已开通|需是|需要是|需要|需|是)?|自备\s*(?:账号|帐号)?\s*(?:本身)?\s*(?:已经是|已有|已开通|需是|需要是|需要|需|是)?|(?:账号|帐号)\s*(?:本身)?\s*(?:已经是|已有|已开通|需是|需要是)|(?:本身)\s*(?:已经是|已有|已开通|需是|需要是)|已经是|已有|已开通)\s*(?:plus|puls|pro)(?:[或/与及和、\s]+(?:plus|puls|pro))*\s*(?:订阅|会员|账号|帐号)?/gi,
      " ",
    )
    .replace(/[（(]\s*(?:free|Free)账号勿[下拍].*?[)）]/gi, " ")
    .replace(/(?:free|Free)账号勿[下拍]/gi, " ");
}

function matchFreeUpgradePurpose(text) {
  return text.match(
    /(?:(?:开通?|升级)\s*(?:plus|puls)|(?:plus|puls)\s*(?:开通?|升级))\s*专用/,
  )?.[0] || "";
}

function matchNonPlusNegation(text) {
  return text.match(/(?:非|不是|并非|不含|没有|无)\s*[-_]?\s*(?:plus|puls)/)?.[0] || "";
}

function hasSmsNegation(text) {
  return /不支持.{0,8}接[码马]|不能.{0,8}接[码马]|无法.{0,8}接[码马]|禁止.{0,8}接[码马]|如需.{0,8}接[码马]|(?:需要|需)\s*(?:自行|自己|手机|自己手机)?\s*接[码马]|自行接[码马]|自己接[码马]|接[码马]可登|接[码马]登录|接[码马]以后|不含接[码马]|无接[码马]|没绑手机|未绑手机|需绑卡|需绑手机|官方充值|直充/.test(text);
}

function hasStrongSmsServiceSignal(text) {
  return (
    /(?:短效|长效|单次|\d+次|一次性)?接[码马]专用/.test(text)
    || /短效接[码马]|长效接[码马]|短效[码马]|长效[码马]|单次接[码马]|单次[码马]|\d+次接[码马]|\d+次[码马]|一次性接[码马]|一次性[码马]/.test(text)
    || /接[码马]成功率|质保接[码马]成功|质保不来[码马]|不出[码马]支持换号|包接到|质保首[码马]|质保首接|保首接[码马]/.test(text)
    || /(?:可|支持|自助|自动)换号|\d+次自助换号|换号\d+次|换号码/.test(text)
    || /(?:全)?自动(?:发卡)?(?:取[码马]|接[码马])|自助(?:取[码马]|接[码马])|无限取[码马]|接[码马]服务/.test(text)
    || /(?:plus|puls|pro|free|gpt|chatg|codex|g)[\s/／]+(?:plus|puls|pro|free|gpt|chatg|codex|g)*[\s/／]*接[码马]|(?:plus|puls|pro|free|gpt|chatg|codex|g)接[码马]/.test(text)
    || /接手机验证[码马]|手机验证[码马]|短信接[码马]|短信验证[码马]?/.test(text)
    || /(?:实卡|实体卡|虚拟卡|美卡).{0,10}(?:多次|单次|\d+次)?验证|可多次验证|多次验证/.test(text)
    || /(?:实卡|实体卡).{0,12}接[码马]/.test(text)
    || /(?:自动化|自动)?codex绑定|绑定codex/.test(text)
    || /【(?:单次|短效|长效)?接[码马]】|t-mobile/.test(text)
  );
}

function isFinishedAccountSmsMention(text) {
  // Plus/Free 成品号会写“美区长效接码/已使用...接码”，这是账号卖点而不是接码服务本身。
  return (
    /已使用.{0,12}(?:长效|短效|单次)?接[码马]/.test(text)
    || /(?:成品|直卡|现货|账号注册|谷歌账号|google\s*账号|rt\s*文件|首登|free号|plus号|pro号|账号|帐号|有\s*rt).{0,24}(?:长效|短效|单次)?接[码马]/.test(text)
    || /(?:长效|短效|单次)?接[码马].{0,24}(?:成品|直卡|现货|账号注册|谷歌账号|google\s*账号|rt\s*文件|首登|free号|plus号|pro号|账号|帐号|有\s*rt)/.test(text)
  ) && !/(?:质保不来[码马]|注册通用|接[码马]专用|单次接[码马]|短效[码马]|包接到|质保接[码马]成功|接[码马]成功率)/.test(text);
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

function isBlockedPrice(price) {
  return typeof price === "number" && price >= 2000;
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
    brand: category === "grok" ? "grok" : "codex",
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
  output = output.replace(/已稳\s*\d+\s*天/gi, " ");
  output = output.replace(/(?:成品质保|质保|保)?\s*订阅\s*\d+\s*(?:h|小时|天|周)/gi, " ");
  output = output.replace(/质保\s*(?:订阅)?\s*(?:一|1|两|2)\s*周(?:订阅)?/gi, " ");
  output = output.replace(/(?:成品)?质保\s*\d+\s*(?:h|小时|天)(?:订阅)?/gi, " ");
  output = output.replace(/质保\s*(?:发货\s*)?\d+\s*(?:分钟|小时|h|m|天)(?:内)?(?:首登|激活)?/gi, " ");
  output = output.replace(/保\s*\d+\s*(?:分钟|小时|h|m|天)(?:内)?(?:首登|激活)/gi, " ");
  return output.replace(/\s+/g, " ").trim();
}

function durationMeta(subtype, matches = []) {
  if (subtype === "m12") {
    return { subtype, durationDays: 30, durationLabel: "1M", matches };
  }
  if (subtype === "m3") {
    return { subtype, durationDays: 90, durationLabel: "3M", matches };
  }
  if (subtype === "y1") {
    return { subtype, durationDays: 365, durationLabel: "1Y", matches };
  }
  return { subtype: "others", durationDays: null, durationLabel: "Others", matches };
}

function matchGrokDuration(text, durationTerms = {}) {
  const ordered = [
    ["y1", durationTerms.y1 || []],
    ["m3", durationTerms.m3 || []],
    ["m12", durationTerms.m12 || []],
    // 兼容旧规则字段，避免历史 rules 缓存失效。
    ["m12", [...(durationTerms.m1 || []), ...(durationTerms.m2 || [])]],
  ];

  for (const [subtype, terms] of ordered) {
    const matches = matchedTerms(text, terms);
    if (matches.length > 0) {
      return durationMeta(subtype, matches);
    }
  }

  const yearMatch = text.match(/(?:^|[^a-z0-9])(?:1\s*年|一年|年卡|12\s*(?:个\s*)?月|1\s*year|one\s*year)(?=$|[^a-z0-9])/i);
  if (yearMatch) {
    return durationMeta("y1", [yearMatch[0].trim()]);
  }

  const monthMatch = text.match(/(\d+)\s*(?:个\s*)?月/);
  if (monthMatch) {
    const months = Number(monthMatch[1]);
    if (months === 12) return durationMeta("y1", [monthMatch[0]]);
    if (months === 3) return durationMeta("m3", [monthMatch[0]]);
    if (months === 1 || months === 2) return durationMeta("m12", [monthMatch[0]]);
    // 4-11 个月并入 3M 档；超过 12 个月并入 1Y。
    if (Number.isFinite(months) && months > 12) return durationMeta("y1", [monthMatch[0]]);
    if (Number.isFinite(months) && months > 3) return durationMeta("m3", [monthMatch[0]]);
  }

  const dayMatch = text.match(/(\d+)\s*天/);
  if (dayMatch) {
    const days = Number(dayMatch[1]);
    if (Number.isFinite(days) && days >= 360) return durationMeta("y1", [dayMatch[0]]);
    if (days === 90 || (Number.isFinite(days) && days > 90 && days < 360)) {
      return durationMeta("m3", [dayMatch[0]]);
    }
    if (days === 30 || days === 60) return durationMeta("m12", [dayMatch[0]]);
    if (Number.isFinite(days) && days > 0) {
      return { subtype: "others", durationDays: days, durationLabel: days + "D", matches: [dayMatch[0]] };
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

  const explicitDuration = ["m12", "m3", "y1"].includes(titleDuration.subtype)
    ? titleDuration
    : (["m12", "m3", "y1"].includes(combinedDuration.subtype) ? combinedDuration : null);

  // 1. 如果是明确的付费 Grok（命中 heavy / supergrok 等付费词），或者具有付费时长 (y1, m3, m12) 且无明确普号词
  const isPaidGrok = paidMatches.length > 0 || (explicitDuration !== null && freeMatches.length === 0);
  if (isPaidGrok) {
    // 若无明确时长，付费 Grok 默认按 1M 处理
    const finalDuration = explicitDuration || {
      subtype: "m12",
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

function classifyCodexProduct(titleText, descriptionText, rules) {
  const combined = `${titleText} ${descriptionText}`.toLowerCase();
  const titleOnly = titleText.toLowerCase();
  const subtypeCombined = stripPlanPrerequisiteContext(stripTeamWarningContext(stripPlusUpgradeContext(combined)));
  const subtypeTitleOnly = stripPlanPrerequisiteContext(stripTeamWarningContext(stripPlusUpgradeContext(titleOnly)));
  const freeUpgradePurposeMatch = matchFreeUpgradePurpose(titleOnly);
  const nonPlusNegationMatch = matchNonPlusNegation(titleOnly);
  const freeTitleHintMatch = freeUpgradePurposeMatch || nonPlusNegationMatch;
  const titleExclusionMatches = matchedTerms(titleOnly, rules.titleExclusionTerms || []);
  const exclusionMatches = matchedTerms(combined, rules.exclusionTerms || []);
  const anchorMatches = matchedTerms(combined, rules.anchorTerms || []);
  const titleAccountStateMatches = matchedTerms(titleOnly, rules.accountStateTerms || []);
  const accountStateMatches = matchedTerms(combined, rules.accountStateTerms || []);
  const smsMatches = matchedTerms(titleOnly, rules.smsServiceTerms || []);
  const codexMatches = matchedTerms(combined, rules.codexTerms || []);
  const explicitTitleSubtype = freeTitleHintMatch
    ? "free"
    : explicitPlanSubtype(subtypeTitleOnly, rules.subtypeTerms, rules);
  const titleOnlySubtype = freeTitleHintMatch
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

export function classifyProduct(title, description = "", rules) {
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

  const combined = `${titleText} ${descriptionText}`.toLowerCase();
  // Grok 只看标题锚点，防止描述链接/域名把无关商品拉进 Grok。
  const grokAnchorMatches = matchedTerms(titleOnly, rules.grokAnchorTerms || []);
  const codexAnchorMatches = matchedTerms(combined, rules.anchorTerms || []);

  if (grokAnchorMatches.length > 0) {
    const grokResult = classifyGrokProduct(titleText, descriptionText, rules);
    if (grokResult.category !== "other") return grokResult;
    if (codexAnchorMatches.length === 0) return grokResult;
  }

  return finalizeCodexPlanResult(
    classifyCodexProduct(titleText, descriptionText, rules),
    titleOnly,
    rules,
  );
}

function withCommonFields(raw, source, rules, fields) {
  const classification = classifyProduct(fields.title, fields.descriptionText, rules);
  if (classification.category === "other") return null;
  const price = normalizePrice(fields.price);
  if (isBlockedPrice(price)) return null;

  return {
    id: `${source.id || source.name}:${fields.sourceProductId}`,
    brand: classification.brand || (classification.category === "grok" ? "grok" : "codex"),
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
    url: fields.url,
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
  const link = raw.link || `/item/${raw.goods_key}`;
  const stockCount = Number(raw.extend?.stock_count);

  return withCommonFields(raw, source, rules, {
    sourceProductId: raw.goods_key || raw.id || raw.link,
    title: raw.name,
    descriptionText: raw.description,
    price: raw.price,
    stockCount: Number.isFinite(stockCount) ? stockCount : null,
    url: new URL(link, base).href,
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
    price: raw.price ?? raw.user_price,
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
