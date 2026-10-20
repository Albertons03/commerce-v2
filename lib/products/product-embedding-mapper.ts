import { z } from "zod";
import type { ProductInput } from "@/lib/validations/product-ingestion";

const organizationIdSchema = z.string().uuid();
const EMBEDDING_DIMENSIONS = 1536;

export interface ProductEmbeddingRow {
  organization_id: string;
  product_id: string;
  product_name: string;
  product_description: string;
  product_category: string | null;
  product_price: number | null;
  product_currency?: string;
  product_url: string | null;
  product_image_url: string | null;
  embedding: number[];
  embedding_model: string;
  embedding_tokens: number | null;
  metadata?: NonNullable<ProductInput["metadata"]>;
}

export function mapProductToEmbeddingRow(
  organizationId: string,
  product: ProductInput,
  embedding: readonly number[],
  embeddingModel: string,
  embeddingTokens?: number
): ProductEmbeddingRow {
  if (!organizationIdSchema.safeParse(organizationId).success) {
    throw new TypeError("organizationId must be a valid UUID");
  }

  if (
    !Array.isArray(embedding) ||
    embedding.length !== EMBEDDING_DIMENSIONS ||
    !embedding.every((value) => Number.isFinite(value))
  ) {
    throw new TypeError(
      `embedding must contain exactly ${EMBEDDING_DIMENSIONS} finite numbers`
    );
  }

  if (typeof embeddingModel !== "string" || embeddingModel.length === 0) {
    throw new TypeError("embeddingModel must be a non-empty string");
  }

  if (
    embeddingTokens !== undefined &&
    (!Number.isInteger(embeddingTokens) || embeddingTokens < 0)
  ) {
    throw new TypeError("embeddingTokens must be a non-negative integer");
  }

  return {
    organization_id: organizationId,
    product_id: product.product_id,
    product_name: product.product_name,
    product_description: product.product_description,
    product_category: product.category ?? null,
    product_price: product.price ?? null,
    ...(product.currency === undefined
      ? {}
      : { product_currency: product.currency }),
    product_url: product.product_url ?? null,
    product_image_url: product.product_image_url ?? null,
    embedding: [...embedding],
    embedding_model: embeddingModel,
    embedding_tokens: embeddingTokens ?? null,
    ...(product.metadata === undefined ? {} : { metadata: product.metadata }),
  };
}
