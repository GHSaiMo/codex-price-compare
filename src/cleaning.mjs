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
  const normalizedTerm = term.toLowerCase();
  // go 需要完整词边界，避免 google / good 误命中。
  if (normalizedTerm === "go") {
    return /(^|[^a-z0-9])go(?=$|[^a-z0-9])/.test(haystack);
  }
  // grok 只限制左侧边界，避免 xgrok 域名误命中，同时保留 grok4.5 这类标题。
  if (normalizedTerm === "grok") {
    return /(^|[^a-z0-9])grok/.test(haystack);
  }
  return haystack.includes(normalizedTerm);
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
    ...(rules.titleSubtypeTerms?.[subtype] || []),
    ...(rules.subtypeTerms?.[subtype] || []),
  ];
}

function explicitPlanSubtype(haystack, subtypeTerms = {}) {
  // 标题里的 free/plus/pro 明确套餐词优先，避免次要上下文词（如 team 限制）抢分类。
  // 这里只认核心套餐词，不直接复用 subtypeTerms 全量词表。
  const termsBySubtype = {
    pro: ["pro", "5x", "20x"],
    plus: ["plus", "puls"],
    free: ["free", "fre", "free号", "普号", "go"],
  };
  for (const subtype of ["pro", "plus", "free"]) {
    if (matchedTerms(haystack, termsBySubtype[subtype]).length > 0) return subtype;
  }
  return "unknown";
}

function stripPlusUpgradeContext(text) {
  return text
    .replace(/可\s*(?:升级|开通|开)\s*(?:plus|puls)/g, "可")
    .replace(/(?:非|不是|并非)\s*[-_]?\s*(?:plus|puls)/g, "")
    .replace(/(?:不含|没有|无)\s*[-_]?\s*(?:plus|puls)/g, "")
    .replace(/[=＝]\s*[0-9一二三四五六七八九十两]+\s*小时\s*(?:plus|puls)/g, "");
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
  return /不支持.{0,8}接码|不能.{0,8}接码|无法.{0,8}接码|禁止.{0,8}接码|如需.{0,8}自行接码|自行接码|自己接码/.test(text);
}

function hasStrongSmsServiceSignal(text) {
  return /(?:短效|长效|单次)?接码专用|短效接码|长效接码|短效码|单次接码|接码成功率|质保接码成功|质保不来码|包接到|codex接码|手机接码|接手机验证码|【接码】|(?:plus|puls|pro|free)接码/.test(text);
}

function isFinishedAccountSmsMention(text) {
  // Plus/Free 成品号会写“美区长效接码/已使用...接码”，这是账号卖点而不是接码服务本身。
  return (
    /已使用.{0,12}(?:长效|短效|单次)?接码/.test(text)
    || /(?:成品|直卡|现货|账号注册|谷歌账号|google\s*账号).{0,24}(?:长效|短效|单次)?接码/.test(text)
    || /(?:长效|短效|单次)?接码.{0,24}(?:成品|直卡|现货|账号注册|谷歌账号|google\s*账号)/.test(text)
  ) && !/(?:质保不来码|注册通用|接码专用|单次接码|短效码|包接到|质保接码成功|接码成功率)/.test(text);
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

function stripNoiseDurationText(text, noiseTerms = []) {
  let output = text;
  for (const term of noiseTerms) {
    output = output.split(term.toLowerCase()).join(" ");
  }
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
  const exclusionMatches = matchedTerms(combined, rules.grokExclusionTerms || []);
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

  const freeMatches = matchedTerms(titleOnly, rules.grokFreeTerms || []);
  const cleanedTitle = stripNoiseDurationText(titleOnly, rules.grokNoiseDurationTerms || []);
  const cleanedCombined = stripNoiseDurationText(combined, rules.grokNoiseDurationTerms || []);
  const titleDuration = matchGrokDuration(cleanedTitle, rules.grokDurationTerms || {});
  const combinedDuration = matchGrokDuration(cleanedCombined, rules.grokDurationTerms || {});
  // 标题里的付费时长最优先（月卡/一年），避免“质保3天”抢分类。
  // 标题 free 词次之（普号），避免描述里的“1个月质保”把普号送进 1M。
  // 再退回描述/综合文本中的付费时长。
  const duration = ["m12", "m3", "y1"].includes(titleDuration.subtype)
    ? titleDuration
    : (freeMatches.length > 0
      ? titleDuration
      : ( ["m12", "m3", "y1"].includes(combinedDuration.subtype)
        ? combinedDuration
        : (titleDuration.matches.length > 0 ? titleDuration : combinedDuration)));

  if (["m12", "m3", "y1"].includes(duration.subtype) && ( ["m12", "m3", "y1"].includes(titleDuration.subtype) || freeMatches.length === 0 )) {
    return buildResult(
      "grok",
      duration.subtype,
      0.9,
      ["grok", duration.subtype],
      [
        ...anchorMatches.slice(0, 2).map((term) => `命中Grok锚点词: ${term}`),
        ...duration.matches.slice(0, 2).map((term) => `命中时长: ${term}`),
      ],
      {
        durationDays: duration.durationDays,
        durationLabel: duration.durationLabel,
      },
    );
  }

  // Free：普号 / 短体验 / 无明确付费时长。
  if (freeMatches.length > 0 || duration.subtype === "others") {
    const freeDurationMatches = freeMatches.length > 0
      ? freeMatches
      : duration.matches;
    return buildResult(
      "grok",
      "free",
      freeMatches.length > 0 || duration.matches.length > 0 ? 0.9 : 0.75,
      ["grok", "free"],
      [
        ...anchorMatches.slice(0, 2).map((term) => `命中Grok锚点词: ${term}`),
        ...freeDurationMatches.slice(0, 2).map((term) => `命中Free词: ${term}`),
      ],
      {
        durationDays: duration.durationDays,
        durationLabel: freeMatches.length > 0 && duration.subtype === "others" && duration.matches.length === 0
          ? "Free"
          : (duration.durationLabel || "Free"),
      },
    );
  }

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
  const subtypeCombined = stripPlusUpgradeContext(combined);
  const subtypeTitleOnly = stripPlusUpgradeContext(titleOnly);
  const freeUpgradePurposeMatch = matchFreeUpgradePurpose(titleOnly);
  const nonPlusNegationMatch = matchNonPlusNegation(titleOnly);
  const freeTitleHintMatch = freeUpgradePurposeMatch || nonPlusNegationMatch;
  const titleExclusionMatches = matchedTerms(titleOnly, rules.titleExclusionTerms || []);
  const exclusionMatches = matchedTerms(combined, rules.exclusionTerms || []);
  const anchorMatches = matchedTerms(combined, rules.anchorTerms || []);
  const accountStateMatches = matchedTerms(combined, rules.accountStateTerms || []);
  const smsMatches = matchedTerms(titleOnly, rules.smsServiceTerms || []);
  const codexMatches = matchedTerms(combined, rules.codexTerms || []);
  const explicitTitleSubtype = freeTitleHintMatch
    ? "free"
    : explicitPlanSubtype(subtypeTitleOnly, rules.subtypeTerms);
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
    if (isSmsServiceProduct(titleOnly, smsMatches, accountStateMatches)) {
      return buildResult(
        "sms",
        rules.smsSubtype || "codex_sms",
        0.95,
        ["codex", "sms"],
        smsMatches.slice(0, 2).map((term) => `命中接码服务词: ${term}`),
      );
    }

    if (["free", "plus", "pro"].includes(titleSubtype)) {
      const reasons = [
        ...(freeUpgradePurposeMatch ? [`命中Free用途词: ${freeUpgradePurposeMatch}`] : []),
        ...(nonPlusNegationMatch ? [`命中非Plus词: ${nonPlusNegationMatch}`] : []),
        ...anchorMatches.slice(0, 2).map((term) => `命中Codex锚点词: ${term}`),
        ...matchedTerms(subtypeTitleOnly, titleReasonTermsForSubtype(rules, titleSubtype)).slice(0, 2).map((term) => `命中套餐词: ${term}`),
      ];
      return buildResult("codex", titleSubtype, 0.9, [titleSubtype], reasons);
    }

    if (smsMatches.length > 0 && accountStateMatches.length === 0 && !hasSmsNegation(titleOnly)) {
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
  const combined = `${titleText} ${descriptionText}`.toLowerCase();
  // Grok 只看标题锚点，防止描述链接/域名把无关商品拉进 Grok。
  const grokAnchorMatches = matchedTerms(titleOnly, rules.grokAnchorTerms || []);
  const codexAnchorMatches = matchedTerms(combined, rules.anchorTerms || []);

  if (grokAnchorMatches.length > 0) {
    const grokResult = classifyGrokProduct(titleText, descriptionText, rules);
    if (grokResult.category !== "other") return grokResult;
    if (codexAnchorMatches.length === 0) return grokResult;
  }

  return classifyCodexProduct(titleText, descriptionText, rules);
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
