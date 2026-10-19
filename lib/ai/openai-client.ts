/**
 * OpenAI Client Wrapper
 *
 * Provides a configured OpenAI client with:
 * - Retry logic with exponential backoff
 * - Rate limiting handling
 * - Error normalization
 * - Token usage tracking
 */

import OpenAI from 'openai';
import 'server-only';

const OPENAI_MAX_RETRIES = parseInt(process.env.OPENAI_MAX_RETRIES || '3');
const OPENAI_TIMEOUT_MS = parseInt(process.env.OPENAI_TIMEOUT_MS || '30000');

// =====================================================
// OpenAI Client Singleton
// =====================================================

let openaiClient: OpenAI | null = null;

/**
 * Get the OpenAI client instance (singleton pattern)
 */
export function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || apiKey === 'your-openai-api-key-here') {
      throw new Error(
        'OPENAI_API_KEY is not configured. Get your API key from https://platform.openai.com/api-keys'
      );
    }

    openaiClient = new OpenAI({
      apiKey,
      maxRetries: OPENAI_MAX_RETRIES,
      timeout: OPENAI_TIMEOUT_MS,
    });
  }
  return openaiClient;
}

// =====================================================
// Error Types
// =====================================================

export class OpenAIError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number,
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = 'OpenAIError';
  }
}

export class RateLimitError extends OpenAIError {
  constructor(
    message: string = 'OpenAI rate limit exceeded',
    public readonly retryAfter?: number
  ) {
    super(message, 'rate_limit_exceeded', 429, true);
    this.name = 'RateLimitError';
  }
}

export class InvalidRequestError extends OpenAIError {
  constructor(message: string) {
    super(message, 'invalid_request', 400, false);
    this.name = 'InvalidRequestError';
  }
}

export class AuthenticationError extends OpenAIError {
  constructor(message: string = 'Invalid OpenAI API key') {
    super(message, 'authentication_error', 401, false);
    this.name = 'AuthenticationError';
  }
}

// =====================================================
// Error Handling
// =====================================================

/**
 * Normalize OpenAI errors into our custom error types
 */
export function normalizeOpenAIError(error: unknown): OpenAIError {
  // Already normalized
  if (error instanceof OpenAIError) {
    return error;
  }

  // OpenAI SDK errors
  if (error instanceof OpenAI.APIError) {
    const statusCode = error.status;
    const message = error.message;

    switch (statusCode) {
      case 429:
        // Extract retry-after header if available
        const retryAfter = error.headers?.['retry-after']
          ? parseInt(error.headers['retry-after'])
          : undefined;
        return new RateLimitError(message, retryAfter);

      case 400:
        return new InvalidRequestError(message);

      case 401:
        return new AuthenticationError(message);

      case 500:
      case 502:
      case 503:
        return new OpenAIError(
          message,
          'service_unavailable',
          statusCode,
          true // Server errors are retryable
        );

      default:
        return new OpenAIError(message, 'unknown_error', statusCode);
    }
  }

  // Generic errors
  if (error instanceof Error) {
    return new OpenAIError(error.message, 'unknown_error');
  }

  // Unknown error type
  return new OpenAIError('An unknown error occurred', 'unknown_error');
}

// =====================================================
// Retry Logic
// =====================================================

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
}

/**
 * Execute a function with exponential backoff retry logic
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = OPENAI_MAX_RETRIES,
    initialDelayMs = 1000,
    maxDelayMs = 32000,
    backoffMultiplier = 2,
  } = options;

  let lastError: OpenAIError | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = normalizeOpenAIError(error);

      // Don't retry non-retryable errors
      if (!lastError.retryable) {
        throw lastError;
      }

      // Don't retry if we've exhausted attempts
      if (attempt === maxRetries) {
        throw lastError;
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(
        initialDelayMs * Math.pow(backoffMultiplier, attempt),
        maxDelayMs
      );

      // If rate limited and we have retry-after, use that instead
      if (lastError instanceof RateLimitError && lastError.retryAfter) {
        await sleep(lastError.retryAfter * 1000);
      } else {
        await sleep(delay);
      }

      console.log(
        `[OpenAI] Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms`
      );
    }
  }

  throw lastError;
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =====================================================
// Token Usage Tracking
// =====================================================

export interface TokenUsage {
  promptTokens: number;
  completionTokens?: number;
  totalTokens: number;
}

/**
 * Extract token usage from OpenAI response
 */
export function extractTokenUsage(
  response: OpenAI.Embeddings.CreateEmbeddingResponse | OpenAI.Chat.ChatCompletion
): TokenUsage {
  const usage = response.usage;

  if (!usage) {
    return {
      promptTokens: 0,
      totalTokens: 0,
    };
  }

  return {
    promptTokens: usage.prompt_tokens,
    completionTokens: 'completion_tokens' in usage ? usage.completion_tokens : 0,
    totalTokens: usage.total_tokens,
  };
}

/**
 * Estimate cost based on token usage
 * Prices as of January 2025
 */
export function estimateCost(
  tokenUsage: TokenUsage,
  model: string
): number {
  const { totalTokens, completionTokens = 0 } = tokenUsage;

  switch (model) {
    case 'text-embedding-3-small':
      // $0.00002 per 1K tokens
      return (totalTokens / 1000) * 0.00002;

    case 'gpt-4-turbo':
      // $0.01 per 1K input, $0.03 per 1K output
      const inputTokens = totalTokens - completionTokens;
      return (inputTokens / 1000) * 0.01 + (completionTokens / 1000) * 0.03;

    case 'gpt-4o':
      // $0.0025 per 1K input, $0.01 per 1K output
      const inputTokensGpt4o = totalTokens - completionTokens;
      return (inputTokensGpt4o / 1000) * 0.0025 + (completionTokens / 1000) * 0.01;

    default:
      return 0;
  }
}
