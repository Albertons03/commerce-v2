
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProductMatch } from "./rag-service";

export async function getCatalogFallback(
  organizationId: string,
  supabase: SupabaseClient,
): Promise<ProductMatch[]> {
  const { data, error } = await supabase
    .from("product_embeddings")
    .select(
      "product_id, product_name, product_description, product_category, product_price, product_currency, product_url, metadata",
    )
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .order("product_name", { ascending: true })
    .limit(5);

  if (error) {
    throw new Error(
      `Catalog fallback failed: ${error.code ?? "database_error"}`,
    );
  }

  return (data ?? []).map((product) => ({
    product_id: product.product_id,
    product_name: product.product_name,
    product_description: product.product_description ?? undefined,
    product_category: product.product_category ?? undefined,
    product_price: product.product_price ?? undefined,
    product_url: product.product_url ?? undefined,
    similarity_score: 0,
    metadata: product.metadata ?? undefined,
  }));
}
