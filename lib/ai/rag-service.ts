import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { generateEmbedding } from "./embedding-service";
import type { ProductCategory } from "./extract-category-filter";

export interface ProductMatch {
  product_id: string;
  product_name: string;
  product_description?: string;
  product_price?: number;
  product_category?: string;
  product_url?: string;
  similarity_score: number;
  metadata?: Record<string, unknown>;
}

export interface RAGSearchOptions {
  organization_id: string;
  query: string;
  top_k?: number;
  similarity_threshold?: number;
  max_price?: number;
  currency?: "USD" | "EUR";
  category?: ProductCategory;
}

export interface RAGSearchResult {
  matches: ProductMatch[];
  query_embedding_time_ms: number;
  search_time_ms: number;
  total_time_ms: number;
}

type SearchRow = Record<string, unknown>;

function parseMatch(value: unknown): ProductMatch {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid product search result");
  }
  const row = value as SearchRow;
  if (
    typeof row.product_id !== "string" ||
    typeof row.product_name !== "string" ||
    typeof row.similarity_score !== "number" ||
    !Number.isFinite(row.similarity_score) ||
    row.similarity_score < 0 ||
    row.similarity_score > 1
  ) {
    throw new Error("Invalid product search result fields");
  }
  const match: ProductMatch = {
    product_id: row.product_id,
    product_name: row.product_name,
    similarity_score: row.similarity_score,
  };
  if (typeof row.product_description === "string")
    match.product_description = row.product_description;
  if (
    typeof row.product_price === "number" &&
    Number.isFinite(row.product_price)
  )
    match.product_price = row.product_price;
  if (typeof row.product_category === "string")
    match.product_category = row.product_category;
  if (typeof row.product_url === "string") match.product_url = row.product_url;
  if (
    row.metadata &&
    typeof row.metadata === "object" &&
    !Array.isArray(row.metadata)
  ) {
    match.metadata = row.metadata as Record<string, unknown>;
  }
  return match;
}

/**
 * Internal server-side retrieval. The caller MUST authorize access to
 * organization_id before invoking this function. Never expose it directly
 * to a public route or trust a client-supplied organization_id.
 *
 * Requires an RPC that enforces organization isolation and returns only
 * active products. Confirm its SQL definition before enabling a route.
 */
export async function performVectorSearch(
  options: RAGSearchOptions,
  supabase: SupabaseClient,
): Promise<RAGSearchResult> {
  const {
    organization_id,
    query,
    top_k = 5,
    similarity_threshold = 0.3,
    max_price,
    currency,
    category,
  } = options;
  if (!organization_id.trim() || !query.trim() || query.length > 2000) {
    throw new Error("Invalid organization or query");
  }
  if (!Number.isInteger(top_k) || top_k < 1 || top_k > 20) {
    throw new Error("top_k must be an integer between 1 and 20");
  }
  if (
    !Number.isFinite(similarity_threshold) ||
    similarity_threshold < 0 ||
    similarity_threshold > 1
  ) {
    throw new Error("similarity_threshold must be between 0 and 1");
  }

  if (max_price !== undefined) {
    if (!Number.isFinite(max_price) || max_price < 0) {
      throw new Error("max_price must be a non-negative finite number");
    }

    if (currency !== "USD" && currency !== "EUR") {
      throw new Error("A supported currency is required with max_price");
    }
  }

  const start = Date.now();
  const embedding = await generateEmbedding(query, organization_id);
  const embeddingTime = Date.now() - start;
  const searchStart = Date.now();

  const rpcParams = {
    p_organization_id: organization_id,
    p_query_embedding: `[${embedding.join(",")}]`,
    p_limit: top_k,
    p_similarity_threshold: similarity_threshold,
  };

  const rpcName =
    category !== undefined
      ? "search_products_by_embedding_category"
      : max_price !== undefined
        ? "search_products_by_embedding_filtered"
        : "search_products_by_embedding";

  const rpcArguments =
    category !== undefined
      ? {
          ...rpcParams,
          p_category: category,
          p_max_price: max_price ?? null,
          p_currency: currency ?? null,
        }
      : max_price !== undefined
        ? {
            ...rpcParams,
            p_max_price: max_price,
            p_currency: currency,
          }
        : rpcParams;

  const { data, error } = await supabase.rpc(rpcName, rpcArguments);

  if (error) {
    throw new Error(
      `Product retrieval failed: ${error.code ?? "database_error"}`,
    );
  }
  if (!Array.isArray(data)) {
    throw new Error("Product retrieval returned an invalid response");
  }
  const matches = data.map(parseMatch);
  return {
    matches,
    query_embedding_time_ms: embeddingTime,
    search_time_ms: Date.now() - searchStart,
    total_time_ms: Date.now() - start,
  };
}
