/**
 * Codex Price Compare - Core TypeScript Type Definitions
 */

export type BrandType = "codex" | "grok" | "gemini" | "unknown";

export type StockStatusType = "in_stock" | "out_of_stock" | "unknown";

export interface ClassificationResult {
  brand: BrandType;
  category: string;
  subtype: string;
  confidence: number;
  tags: string[];
  matchReasons: string[];
}

export interface RawProduct {
  id?: string;
  name?: string;
  title?: string;
  price?: number | string;
  selling_price?: number | string;
  goods_price?: number | string;
  in_stock?: boolean | number;
  stock?: number;
  stockCount?: number;
  stock_count?: number;
  stock_num?: number;
  card_count?: number;
  url?: string;
  [key: string]: unknown;
}

export interface ProductItem {
  id: string;
  sourceId: string;
  sourceName: string;
  title: string;
  price: number;
  priceString: string;
  stockCount?: number;
  stockStatus: StockStatusType;
  url: string;
  brand: BrandType;
  category: string;
  subtype: string;
  confidence: number;
  tags: string[];
  matchReasons?: string[];
  updatedAt: string;
}

export interface PublicProductItem {
  id: string;
  sourceId: string;
  sourceName: string;
  title: string;
  price: number;
  stockCount?: number;
  stockStatus: StockStatusType;
  url: string;
  brand: BrandType;
  category: string;
  subtype: string;
  tags: string[];
  updatedAt: string;
}

export interface PublicProductsDocument {
  generatedAt: string;
  total: number;
  items: PublicProductItem[];
}

export type SourceAdapter = "ldxp" | "acg" | "dujiao";

export interface SourceConfig {
  id: string;
  name: string;
  adapter: SourceAdapter;
  enabled: boolean;
  url: string;
  token?: string;
  apiBase?: string;
  core?: boolean;
  disabledReason?: string;
  lastDisabledAt?: string;
}

export interface SourcesDocument {
  sources: SourceConfig[];
}

export interface SourceHealth {
  sourceId: string;
  sourceName: string;
  adapter: SourceAdapter;
  core: boolean;
  status: "success" | "failed" | "skipped" | "cooldown" | "disabled";
  reason?: string;
  lastSuccessAt?: string | null;
  lastFailureAt?: string | null;
  lastError?: string | null;
  itemCount: number;
  ageHours?: number;
}

export interface RefreshMeta {
  generatedAt: string;
  nextRefreshAt?: string | null;
  sourceCount: number;
  attemptedCount: number;
  successCount: number;
  failureCount: number;
  skippedCount: number;
  itemCount: number;
  errors: Array<{ sourceId: string; sourceName: string; error: string }>;
  sources: SourceHealth[];
  protected?: boolean;
  protectionReason?: string;
  skippedByCooldown?: boolean;
  cooldown?: { until: string; reason: string };
}

export interface ClassificationRules {
  brands?: Record<string, string[]>;
  brandExcludeTerms?: Record<string, string[]>;
  subtypes?: Record<string, string[]>;
  subtypeTerms?: Record<string, string[]>;
  titleSubtypeTerms?: Record<string, string[]>;
  excludeTerms?: string[];
  pro5xTerms?: string[];
  pro20xTerms?: string[];
  manualOverrides?: Array<{
    titlePattern: string;
    descriptionPattern?: string;
    result: Partial<ClassificationResult>;
  }>;
  [key: string]: unknown;
}

export interface StockWatchEntry {
  productId: string;
  title: string;
  sourceName: string;
  url: string;
  targetPrice?: number;
  lastPrice?: number;
  lastStockStatus?: StockStatusType;
  lastStockCount?: number;
  addedAt: string;
  updatedAt: string;
}

export interface StockWatchDocument {
  digestEnabled?: boolean;
  lastDigestAt?: string | null;
  items: StockWatchEntry[];
}

export interface PriceHistoryPoint {
  t: number; // timestamp
  p: number; // price
  s?: StockStatusType;
}

export interface PriceHistoryDocument {
  items: Record<string, { points: PriceHistoryPoint[] }>;
}

export interface RecommendationEntry {
  id: string;
  url: string;
  clientIp: string;
  userAgent: string;
  title: string;
  description: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  updatedAt: string;
}

export interface RecommendationsDocument {
  items: RecommendationEntry[];
}
