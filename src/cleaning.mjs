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
  if (normalizedTerm === "go") {
    return /(^|[^a-z0-9])go(?=$|[^a-z0-9])/.test(haystack);
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

function stripPlusUpgradeContext(text) {
  return text
    .replace(/可\s*(?:升级|开通|开)\s*(?:plus|puls)/g, "可")
    .replace(/(?:非|不是|并非)\s*[-_]?\s*(?:plus|puls)/g, "")
    .replace(/[=＝]\s*[0-9一二三四五六七八九十两]+\s*小时\s*(?:plus|puls)/g, "");
}

function matchFreeUpgradePurpose(text) {
  return text.match(/(?:开通?|升级)\s*(?:plus|puls)\s*专用/)?.[0] || "";
}

function matchNonPlusNegation(text) {
  return text.match(/(?:非|不是|并非)\s*[-_]?\s*(?:plus|puls)/)?.[0] || "";
}

function hasSmsNegation(text) {
  return /不支持.{0,8}接码|不能.{0,8}接码|无法.{0,8}接码|禁止.{0,8}接码|如需.{0,8}自行接码|自行接码|自己接码/.test(text);
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

function buildResult(category, subtype, confidence, tags, matchReasons) {
  return {
    category,
    subtype,
    confidence,
    tags: [...new Set(tags)],
    matchReasons,
  };
}

export function classifyProduct(title, description = "", rules) {
  const titleText = stripHtml(title);
  const descriptionText = stripHtml(description);
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
  const titleOnlySubtype = freeTitleHintMatch
    ? "free"
    : firstMatchedSubtype(subtypeTitleOnly, rules.titleSubtypeTerms);
  const titleSubtype = titleOnlySubtype !== "unknown"
    ? titleOnlySubtype
    : firstMatchedSubtype(subtypeTitleOnly, rules.subtypeTerms);
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

function withCommonFields(raw, source, rules, fields) {
  const classification = classifyProduct(fields.title, fields.descriptionText, rules);
  if (classification.category === "other") return null;
  const price = normalizePrice(fields.price);
  if (isBlockedPrice(price)) return null;

  return {
    id: `${source.id || source.name}:${fields.sourceProductId}`,
    category: classification.category,
    subtype: classification.subtype,
    confidence: classification.confidence,
    tags: classification.tags,
    matchReasons: classification.matchReasons,
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
