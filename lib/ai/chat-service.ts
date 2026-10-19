/**
 * =====================================================
 * Chat Service - OpenAI Integration for RAG Chat
 * =====================================================
 * This service handles:
 * - OpenAI chat completion integration
 * - Streaming support
 * - Error handling and retries
 * - Token/cost tracking
 * =====================================================
 */

import type OpenAI from "openai";
import { getOpenAIClient } from "./openai-client";
import { PromptComponents, convertToOpenAIMessages } from "./prompt-builder";

// =====================================================
// Types & Interfaces
// =====================================================

export interface ChatResponse {
  message: string;
  response_id: string;
  model_used: string;
  tokens_used: {
    prompt: number;
    completion: number;
    total: number;
  };
  cost_estimate: number;
  response_time_ms: number;
  finish_reason: string;
  metadata: {
    temperature: number;
    max_tokens: number;
    stream: boolean;
    truncation_applied: boolean;
  };
}

export interface ChatStreamChunk {
  content: string;
  is_complete: boolean;
  tokens_so_far?: number;
  finish_reason?: string;
}

export interface ChatServiceOptions {
  prompt_components: PromptComponents;
  model?: string;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  organization_id: string;
}

// =====================================================
// Configuration
// =====================================================

const CHAT_CONFIG = {
  // gpt-4o-mini: minden OpenAI fiókban elérhető, olcsóbb mint gpt-3.5-turbo, jobb minőség
  DEFAULT_MODEL: "gpt-4o-mini",
  DEFAULT_TEMPERATURE: 0.7,
  DEFAULT_MAX_TOKENS: 1000,
  MAX_RETRIES: 3,
  RETRY_DELAY_MS: 1000,

  // Cost estimates (USD per 1K tokens) - approximate
  COST_PER_1K_TOKENS: {
    "gpt-4o-mini":         { prompt: 0.00015, completion: 0.0006 },
    "gpt-4o":              { prompt: 0.005,   completion: 0.015  },
    "gpt-4-turbo-preview": { prompt: 0.01,    completion: 0.03   },
    "gpt-4":               { prompt: 0.03,    completion: 0.06   },
    "gpt-3.5-turbo":       { prompt: 0.0015,  completion: 0.002  },
  } as Record<string, { prompt: number; completion: number }>,
} as const;

// =====================================================
// Main Chat Service
// =====================================================

/**
 * Generates a chat response using OpenAI
 *
 * @param options - Chat generation options
 * @returns Promise<ChatResponse> - Complete response with metadata
 */
export async function generateChatResponse(
  options: ChatServiceOptions
): Promise<ChatResponse> {
  const {
    prompt_components,
    model = CHAT_CONFIG.DEFAULT_MODEL,
    temperature = CHAT_CONFIG.DEFAULT_TEMPERATURE,
    max_tokens = CHAT_CONFIG.DEFAULT_MAX_TOKENS,
    stream = false,
    organization_id,
  } = options;

  const startTime = Date.now();

  console.log("[Chat Service] Generating chat response:", {
    model,
    temperature,
    max_tokens,
    stream,
    organization_id,
    estimated_prompt_tokens: prompt_components.token_count_estimate,
  });

  try {
    // Convert prompt components to OpenAI messages format
    const messages = convertToOpenAIMessages(prompt_components);

    console.log("[Chat Service] Messages prepared:", {
      message_count: messages.length,
      system_prompt_length: messages[0]?.content.length,
      last_user_message:
        messages[messages.length - 1]?.content.substring(0, 100) + "...",
    });

    // Make OpenAI API call with retries
    const completion = await callOpenAIWithRetry({
      messages,
      model,
      temperature,
      max_tokens,
      stream,
    });

    const responseTime = Date.now() - startTime;

    // Extract response data
    const responseText = completion.choices[0]?.message?.content || "";
    const finishReason = completion.choices[0]?.finish_reason || "unknown";
    const tokensUsed = {
      prompt: completion.usage?.prompt_tokens || 0,
      completion: completion.usage?.completion_tokens || 0,
      total: completion.usage?.total_tokens || 0,
    };

    // Calculate cost estimate
    const costEstimate = calculateCostEstimate(tokensUsed, model);

    const response: ChatResponse = {
      message: responseText,
      response_id: completion.id || `chat_${Date.now()}`,
      model_used: model,
      tokens_used: tokensUsed,
      cost_estimate: costEstimate,
      response_time_ms: responseTime,
      finish_reason: finishReason,
      metadata: {
        temperature,
        max_tokens,
        stream,
        truncation_applied: prompt_components.truncation_applied,
      },
    };

    console.log("[Chat Service] Response generated successfully:", {
      response_length: responseText.length,
      tokens_used: tokensUsed.total,
      cost_estimate: `$${costEstimate.toFixed(4)}`,
      response_time_ms: responseTime,
      finish_reason: finishReason,
    });

    // Log token usage for monitoring
    logTokenUsage(organization_id, tokensUsed, costEstimate, model);

    return response;
  } catch (error) {
    const responseTime = Date.now() - startTime;

    console.error("[Chat Service] Chat generation failed:", {
      error: error instanceof Error ? error.message : "Unknown error",
      response_time_ms: responseTime,
      model,
      organization_id,
    });

    throw new Error(
      `Chat generation failed: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

/**
 * Generates a streaming chat response
 *
 * @param options - Chat generation options
 * @returns AsyncGenerator<ChatStreamChunk> - Stream of response chunks
 */
export async function* generateChatResponseStream(
  options: ChatServiceOptions
): AsyncGenerator<ChatStreamChunk> {
  const {
    prompt_components,
    model = CHAT_CONFIG.DEFAULT_MODEL,
    temperature = CHAT_CONFIG.DEFAULT_TEMPERATURE,
    max_tokens = CHAT_CONFIG.DEFAULT_MAX_TOKENS,
    organization_id,
  } = options;

  console.log("[Chat Service] Starting streaming response:", {
    model,
    temperature,
    max_tokens,
    organization_id,
  });

  try {
    const messages = convertToOpenAIMessages(prompt_components);

    const openai = getOpenAIClient();

    const stream = await openai.chat.completions.create({
      model,
      messages,
      temperature,
      max_tokens,
      stream: true,
    });

    let accumulatedContent = "";
    let tokensSoFar = 0;

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || "";
      const finishReason = chunk.choices[0]?.finish_reason;

      if (content) {
        accumulatedContent += content;
        tokensSoFar += estimateTokensFromContent(content);
      }

      const streamChunk: ChatStreamChunk = {
        content,
        is_complete: !!finishReason,
        tokens_so_far: tokensSoFar,
        finish_reason: finishReason || undefined,
      };

      yield streamChunk;

      if (finishReason) {
        console.log("[Chat Service] Stream completed:", {
          total_content_length: accumulatedContent.length,
          estimated_tokens: tokensSoFar,
          finish_reason: finishReason,
        });

        // Log final usage (estimated)
        const estimatedUsage = {
          prompt: prompt_components.token_count_estimate,
          completion: tokensSoFar,
          total: prompt_components.token_count_estimate + tokensSoFar,
        };
        const estimatedCost = calculateCostEstimate(estimatedUsage, model);
        logTokenUsage(
          organization_id,
          estimatedUsage,
          estimatedCost,
          model,
          true
        );

        break;
      }
    }
  } catch (error) {
    console.error("[Chat Service] Streaming failed:", error);
    throw new Error(
      `Streaming failed: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

// =====================================================
// OpenAI API Integration
// =====================================================

interface OpenAICallOptions {
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  model: string;
  temperature: number;
  max_tokens: number;
  stream: boolean;
}

/**
 * Calls OpenAI API with retry logic
 */
async function callOpenAIWithRetry(
  options: OpenAICallOptions,
  attempt = 1
): Promise<OpenAI.Chat.ChatCompletion> {
  try {
    const openai = getOpenAIClient();

    const response = await openai.chat.completions.create({
      model: options.model,
      messages: options.messages,
      temperature: options.temperature,
      max_tokens: options.max_tokens,
      stream: options.stream,
    });

    if (!("choices" in response)) {
      throw new Error("Expected a non-streaming chat completion");
    }

    return response;
  } catch (error: unknown) {
    const errorDetails =
      error !== null && typeof error === "object" ? error : {};
    const errorType =
      "type" in errorDetails && typeof errorDetails.type === "string"
        ? errorDetails.type
        : undefined;
    const errorCode =
      "code" in errorDetails && typeof errorDetails.code === "string"
        ? errorDetails.code
        : undefined;

    console.error(
      `[Chat Service] OpenAI API call failed (attempt ${attempt}):`,
      {
        error: error instanceof Error ? error.message : "Unknown error",
        type: errorType,
        code: errorCode,
      }
    );

    // Retry on certain errors
    if (attempt < CHAT_CONFIG.MAX_RETRIES) {
      const shouldRetry =
        errorType === "insufficient_quota"
          ? false // Don't retry quota issues
          : errorCode === "rate_limit_exceeded" ||
            errorType === "server_error" ||
            errorType === "timeout";

      if (shouldRetry) {
        const delay = CHAT_CONFIG.RETRY_DELAY_MS * Math.pow(2, attempt - 1); // Exponential backoff
        console.log(`[Chat Service] Retrying in ${delay}ms...`);

        await new Promise((resolve) => setTimeout(resolve, delay));
        return callOpenAIWithRetry(options, attempt + 1);
      }
    }

    throw error;
  }
}

// =====================================================
// Utility Functions
// =====================================================

/**
 * Calculates cost estimate based on token usage
 */
function calculateCostEstimate(
  tokensUsed: { prompt: number; completion: number; total: number },
  model: string
): number {
  const pricing = CHAT_CONFIG.COST_PER_1K_TOKENS[model];
  if (!pricing) {
    console.warn(`[Chat Service] No pricing data for model: ${model}`);
    return 0;
  }

  const promptCost = (tokensUsed.prompt / 1000) * pricing.prompt;
  const completionCost = (tokensUsed.completion / 1000) * pricing.completion;

  return promptCost + completionCost;
}

/**
 * Estimates tokens from text content (rough approximation)
 */
function estimateTokensFromContent(content: string): number {
  return Math.ceil(content.length * 0.25); // Rough estimate
}

/**
 * Logs token usage for monitoring and billing
 */
function logTokenUsage(
  organizationId: string,
  tokensUsed: { prompt: number; completion: number; total: number },
  costEstimate: number,
  model: string,
  isEstimated = false
) {
  console.log("[Chat Service] Token usage logged:", {
    organization_id: organizationId,
    model,
    tokens: tokensUsed,
    cost_estimate: `$${costEstimate.toFixed(4)}`,
    is_estimated: isEstimated,
    timestamp: new Date().toISOString(),
  });

  // TODO: Store in database for billing/analytics
  // Could add to a usage tracking table here
}

// =====================================================
// Intent & Sentiment Detection
// =====================================================

/**
 * Analyzes user message for intent and sentiment
 *
 * @param message - User message to analyze
 * @returns Promise<{intent: string, sentiment: string, confidence: number}>
 */
export async function analyzeMessageIntent(
  message: string,
  organizationId: string
): Promise<{
  intent: string;
  sentiment: string;
  confidence: number;
  lead_signals: string[];
}> {
  console.log("[Chat Service] Analyzing message intent:", {
    message_length: message.length,
    organization_id: organizationId,
  });

  try {
    const analysisPrompt = `Analyze the following customer message for intent and sentiment. Return a JSON response with these fields:
- intent: primary intent (product_inquiry, comparison, support, purchase_intent, general_question)
- sentiment: overall sentiment (positive, neutral, negative)
- confidence: confidence level 0-1
- lead_signals: array of signals indicating purchase intent

Customer message: "${message}"

Return only valid JSON:`;

    const openai = getOpenAIClient();

    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo", // Use cheaper model for analysis
      messages: [{ role: "user", content: analysisPrompt }],
      temperature: 0.3,
      max_tokens: 200,
    });

    const analysisText = response.choices[0]?.message?.content || "{}";

    try {
      const analysis = JSON.parse(analysisText);

      console.log("[Chat Service] Intent analysis completed:", analysis);

      return {
        intent: analysis.intent || "general_question",
        sentiment: analysis.sentiment || "neutral",
        confidence: analysis.confidence || 0.5,
        lead_signals: analysis.lead_signals || [],
      };
    } catch (parseError) {
      console.error(
        "[Chat Service] Failed to parse intent analysis:",
        parseError
      );
      return {
        intent: "general_question",
        sentiment: "neutral",
        confidence: 0.5,
        lead_signals: [],
      };
    }
  } catch (error) {
    console.error("[Chat Service] Intent analysis failed:", error);
    return {
      intent: "general_question",
      sentiment: "neutral",
      confidence: 0.5,
      lead_signals: [],
    };
  }
}
