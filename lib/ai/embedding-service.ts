/**
 * Embedding Service
 *
 * Handles:
 * - Text preprocessing for embeddings
 * - Batch embedding generation
 * - Token counting and cost tracking
 * - Progress callbacks
 */

import {
  getOpenAIClient,
  withRetry,
  extractTokenUsage,
  estimateCost,
  type TokenUsage,
} from "./openai-client";

// =====================================================
// Types
// =====================================================

export interface ProductInput {
  product_id: string;
  product_name: string;
  product_description: string;
  category?: string;
  price?: number;
  metadata?: Record<string, unknown>;
}

export interface EmbeddingResult {
  product_id: string;
  embedding: number[];
  text: string;
  tokenUsage: TokenUsage;
  model: string;
}

export interface BatchEmbeddingResult {
  results: EmbeddingResult[];
  totalTokens: number;
  estimatedCost: number;
  duration: number;
  model: string;
}

export interface EmbeddingOptions {
  model?: string;
  batchSize?: number;
  onProgress?: (completed: number, total: number) => void;
}

// =====================================================
// Configuration
// =====================================================

const DEFAULT_MODEL =
  process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
const SUPPORTED_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
const DEFAULT_BATCH_SIZE = 10;

export function resolveEmbeddingModel(model: string = DEFAULT_MODEL): string {
  if (model !== SUPPORTED_MODEL) {
    throw new TypeError(
      `Embedding model must be ${SUPPORTED_MODEL} for ${EMBEDDING_DIMENSIONS}-dimensional product embeddings`
    );
  }

  return model;
}

function validateEmbedding(embedding: number[]): void {
  if (
    embedding.length !== EMBEDDING_DIMENSIONS ||
    !embedding.every((value) => Number.isFinite(value))
  ) {
    throw new Error(
      `Embedding response must contain exactly ${EMBEDDING_DIMENSIONS} finite numbers`
    );
  }
}

// =====================================================
// Text Preprocessing
// =====================================================

/**
 * Prepare product text for embedding generation
 *
 * Combines product information into a single text string
 * that will be sent to OpenAI for embedding.
 *
 * Format: "Name. Description. Category: X. Price: $Y."
 */
export function prepareTextForEmbedding(product: ProductInput): string {
  const parts: string[] = [product.product_name, product.product_description];

  if (product.category) {
    parts.push(`Category: ${product.category}`);
  }

  if (product.price !== undefined && product.price !== null) {
    parts.push(`Ár: ${Math.round(product.price)} Ft`);
  }

  // Join with period and space, trim whitespace
  return parts.join(". ").trim();
}

/**
 * Preprocess text for embedding generation
 * Simple version for single text inputs
 */
function preprocessText(text: string): string {
  // Basic text cleaning and normalization
  // NOTE: We do NOT strip non-ASCII chars because queries may be in Hungarian
  // (é, á, ő, ü, etc.) and stripping them would break the embedding similarity.
  return text
    .trim()
    .replace(/\s+/g, " ") // Multiple spaces to single space
    .toLowerCase();
}

/**
 * Estimate token count for text
 * Using rough approximation: 1 token ≈ 4 characters
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

// =====================================================
// Embedding Generation
// =====================================================

/**
 * Generate embedding for a single text
 *
 * @param text - Text to generate embedding for
 * @param organizationId - Organization ID for tracking
 * @returns Promise<number[]> - Embedding vector
 */
export async function generateEmbedding(
  text: string,
  organizationId?: string,
  model: string = DEFAULT_MODEL
): Promise<number[]> {
  const resolvedModel = resolveEmbeddingModel(model);
  const startTime = Date.now();

  // Preprocess text
  const processedText = preprocessText(text);

  try {
    const openai = getOpenAIClient();

    const response = await withRetry(async () => {
      return await openai.embeddings.create({
        model: resolvedModel,
        input: processedText,
        encoding_format: "float",
      });
    });

    const embedding = response.data[0]?.embedding;
    if (!embedding) {
      throw new Error("No embedding returned from OpenAI");
    }
    validateEmbedding(embedding);

    const processingTime = Date.now() - startTime;
    const tokenUsage = extractTokenUsage(response);
    const cost = estimateCost(tokenUsage, resolvedModel);

    console.log("[Embedding Service] Single embedding generated:", {
      text_length: text.length,
      embedding_length: embedding.length,
      tokens: tokenUsage.totalTokens,
      cost: `$${cost.toFixed(6)}`,
      processing_time_ms: processingTime,
      organization_id: organizationId,
    });

    return embedding;
  } catch (error) {
    console.error("[Embedding Service] Single embedding failed:", error);
    throw new Error(
      `Failed to generate embedding: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

/**
 * Generate embeddings for a batch of products
 *
 * @param products - Array of products to generate embeddings for
 * @param options - Configuration options
 * @returns Batch embedding result with costs and token usage
 */
export async function generateEmbeddings(
  products: ProductInput[],
  options: EmbeddingOptions = {}
): Promise<BatchEmbeddingResult> {
  const {
    model = DEFAULT_MODEL,
    batchSize = DEFAULT_BATCH_SIZE,
    onProgress,
  } = options;
  const resolvedModel = resolveEmbeddingModel(model);

  const startTime = Date.now();
  const allResults: EmbeddingResult[] = [];
  let totalTokens = 0;

  // Process products in batches
  const batches = chunkArray(products, batchSize);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];

    // Generate embeddings for this batch
    const batchResults = await generateEmbeddingsBatch(batch, resolvedModel);
    allResults.push(...batchResults);

    // Update token count
    const batchTokens = batchResults.reduce(
      (sum, result) => sum + result.tokenUsage.totalTokens,
      0
    );
    totalTokens += batchTokens;

    // Call progress callback
    if (onProgress) {
      const completed = (i + 1) * batchSize;
      onProgress(Math.min(completed, products.length), products.length);
    }
  }

  const duration = Date.now() - startTime;
  const estimatedCostValue = estimateCost(
    { promptTokens: totalTokens, totalTokens },
    resolvedModel
  );

  return {
    results: allResults,
    totalTokens,
    estimatedCost: estimatedCostValue,
    duration,
    model: resolvedModel,
  };
}

/**
 * Generate embeddings for a single batch
 * Uses retry logic to handle transient errors
 */
async function generateEmbeddingsBatch(
  products: ProductInput[],
  model: string
): Promise<EmbeddingResult[]> {
  // Prepare texts
  const texts = products.map(prepareTextForEmbedding);

  // Call OpenAI with retry logic
  const response = await withRetry(async () => {
    const client = getOpenAIClient();
    return await client.embeddings.create({
      model,
      input: texts,
      encoding_format: "float",
    });
  });

  // Extract embeddings and token usage
  const tokenUsage = extractTokenUsage(response);
  const tokensPerText = Math.ceil(tokenUsage.totalTokens / texts.length);

  const results: EmbeddingResult[] = products.map((product, index) => {
    const embedding = response.data[index].embedding;
    validateEmbedding(embedding);

    return {
      product_id: product.product_id,
      embedding,
      text: texts[index],
      model,
      tokenUsage: {
        promptTokens: tokensPerText,
        totalTokens: tokensPerText,
      },
    };
  });

  return results;
}

// =====================================================
// Single Product Embedding
// =====================================================

/**
 * Generate embedding for a single product
 * Useful for testing or one-off updates
 */
export async function generateSingleEmbedding(
  product: ProductInput,
  model: string = DEFAULT_MODEL
): Promise<EmbeddingResult> {
  const resolvedModel = resolveEmbeddingModel(model);
  const text = prepareTextForEmbedding(product);

  const response = await withRetry(async () => {
    const client = getOpenAIClient();
    return await client.embeddings.create({
      model: resolvedModel,
      input: text,
      encoding_format: "float",
    });
  });

  const tokenUsage = extractTokenUsage(response);
  const embedding = response.data[0].embedding;
  validateEmbedding(embedding);

  return {
    product_id: product.product_id,
    embedding,
    text,
    model: resolvedModel,
    tokenUsage,
  };
}

// =====================================================
// Validation
// =====================================================

/**
 * Validate that product has required fields for embedding
 */
export function validateProduct(product: unknown): product is ProductInput {
  if (!product || typeof product !== "object") {
    return false;
  }

  const p = product as Partial<ProductInput>;

  return (
    typeof p.product_id === "string" &&
    p.product_id.length > 0 &&
    typeof p.product_name === "string" &&
    p.product_name.length > 0 &&
    typeof p.product_description === "string" &&
    p.product_description.length > 0
  );
}

/**
 * Validate and filter products
 * Returns valid products and list of errors
 */
export function validateProducts(products: unknown[]): {
  valid: ProductInput[];
  invalid: Array<{ index: number; error: string }>;
} {
  const valid: ProductInput[] = [];
  const invalid: Array<{ index: number; error: string }> = [];

  products.forEach((product, index) => {
    if (!product || typeof product !== "object") {
      invalid.push({ index, error: "Product must be an object" });
      return;
    }

    const p = product as Partial<ProductInput>;

    if (!p.product_id || typeof p.product_id !== "string") {
      invalid.push({ index, error: "Missing or invalid product_id" });
      return;
    }

    if (!p.product_name || typeof p.product_name !== "string") {
      invalid.push({ index, error: "Missing or invalid product_name" });
      return;
    }

    if (!p.product_description || typeof p.product_description !== "string") {
      invalid.push({ index, error: "Missing or invalid product_description" });
      return;
    }

    valid.push(p as ProductInput);
  });

  return { valid, invalid };
}

// =====================================================
// Utilities
// =====================================================

/**
 * Split array into chunks of specified size
 */
function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Calculate estimated cost for products before processing
 */
export function estimateEmbeddingCost(products: ProductInput[]): {
  estimatedTokens: number;
  estimatedCost: number;
} {
  const texts = products.map(prepareTextForEmbedding);
  const estimatedTokens = texts.reduce(
    (sum, text) => sum + estimateTokenCount(text),
    0
  );

  const estimatedCostValue = estimateCost(
    { promptTokens: estimatedTokens, totalTokens: estimatedTokens },
    "text-embedding-3-small"
  );

  return {
    estimatedTokens,
    estimatedCost: estimatedCostValue,
  };
}
