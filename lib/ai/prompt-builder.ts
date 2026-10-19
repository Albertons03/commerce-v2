/**
 * =====================================================
 * Prompt Builder - Context Assembly for RAG Chat
 * =====================================================
 * This service handles:
 * - System prompt construction
 * - Conversation history formatting
 * - Product context injection
 * - Token counting and truncation
 * =====================================================
 */

// =====================================================
// Types & Interfaces
// =====================================================

interface ProductMatch {
  product_id: string;
  product_name: string;
  product_description?: string;
  product_price?: number;
  product_category?: string;
  product_url?: string;
  similarity_score: number;
  metadata?: Record<string, unknown>;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: Date;
}

export interface ConversationContext {
  conversation_id: string;
  organization_id: string;
  visitor_metadata?: Record<string, unknown>;
  previous_messages: ChatMessage[];
}

export interface PromptComponents {
  system_prompt: string;
  conversation_history: ChatMessage[];
  product_context: string;
  current_query: string;
  token_count_estimate: number;
  truncation_applied: boolean;
}

export interface PromptBuilderOptions {
  query: string;
  conversation_context: ConversationContext;
  product_matches: ProductMatch[];
  max_tokens?: number;
  organization_name?: string;
  custom_instructions?: string;
}

// =====================================================
// Configuration
// =====================================================

const PROMPT_CONFIG = {
  MAX_TOKENS_DEFAULT: 16000, // Conservative for GPT-4 context
  MAX_HISTORY_MESSAGES: 20,
  MAX_PRODUCT_CONTEXT_LENGTH: 4000,
  TOKENS_PER_CHAR_ESTIMATE: 0.25, // Rough estimate for token counting
} as const;

// =====================================================
// Main Prompt Builder
// =====================================================

/**
 * Builds a complete prompt for RAG chat completion
 *
 * @param options - Prompt building options
 * @returns Promise<PromptComponents> - Assembled prompt components
 */
export async function buildRAGPrompt(
  options: PromptBuilderOptions
): Promise<PromptComponents> {
  const {
    query,
    conversation_context,
    product_matches,
    max_tokens = PROMPT_CONFIG.MAX_TOKENS_DEFAULT,
    organization_name,
    custom_instructions,
  } = options;

  console.log("[Prompt Builder] Building RAG prompt:", {
    query_length: query.length,
    history_messages: conversation_context.previous_messages.length,
    product_matches: product_matches.length,
    max_tokens,
  });

  try {
    // Step 1: Build system prompt
    const systemPrompt = buildSystemPrompt(
      organization_name,
      custom_instructions
    );

    // Step 2: Format product context
    const productContext = formatProductContext(product_matches);

    // Step 3: Prepare conversation history (with truncation if needed)
    const { truncatedHistory, historyTruncated } = truncateConversationHistory(
      conversation_context.previous_messages,
      max_tokens
    );

    // Step 4: Apply the token budget and calculate the final estimate
    const finalComponents = await applyTokenBudget({
      system_prompt: systemPrompt,
      conversation_history: truncatedHistory,
      product_context: productContext,
      current_query: query,
      max_tokens,
      initial_truncation: historyTruncated,
    });

    console.log("[Prompt Builder] Prompt assembled:", {
      system_prompt_chars: finalComponents.system_prompt.length,
      history_messages: finalComponents.conversation_history.length,
      product_context_chars: finalComponents.product_context.length,
      estimated_tokens: finalComponents.token_count_estimate,
      truncation_applied: finalComponents.truncation_applied,
    });

    return finalComponents;
  } catch (error) {
    console.error("[Prompt Builder] Failed to build prompt:", error);
    throw new Error(
      `Prompt building failed: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

// =====================================================
// System Prompt Construction
// =====================================================

/**
 * Builds the system prompt for the AI assistant
 */
function buildSystemPrompt(
  organizationName?: string,
  customInstructions?: string
): string {
  const basePrompt = `You are an AI-powered e-commerce assistant helping customers find and learn about products. You have access to a curated product database and conversation history.

## Your Role & Capabilities

**Primary Functions:**
- Help customers discover relevant products based on their needs
- Provide detailed product information and comparisons
- Answer questions about features, pricing, and availability
- Guide users through product selection and decision-making
- Identify potential leads and capture contact information when appropriate

**Product Knowledge:**
- You have access to real product data from the database
- Always reference specific products when relevant to the conversation
- Provide accurate pricing and product details
- Mention product categories and help with navigation

**Conversation Style:**
- Be friendly, helpful, and professional
- Ask clarifying questions to better understand customer needs
- Provide specific recommendations with reasoning
- Keep responses concise but informative
- Always prioritize customer value over sales pressure

## Lead Identification & Capture

**Identify High-Intent Signals:**
- Specific product inquiries or comparisons
- Budget or timeline discussions
- Questions about shipping, warranties, or support
- Multiple product views or detailed feature questions

**When to Capture Leads:**
- Customer shows strong purchase intent
- Asks about bulk orders or business pricing
- Requests personalized recommendations
- Wants to be notified about products or sales
- Needs human assistance for complex decisions

**Lead Capture Approach:**
- Be natural and non-pushy
- Offer genuine value (exclusive discounts, early access, personal consultation)
- Ask for email/phone only when providing clear benefit
- Respect privacy and explain how information will be used`;

  const organizationContext = organizationName
    ? `\n\n## About ${organizationName}\n\nYou represent ${organizationName}, an e-commerce business focused on providing quality products and excellent customer service. Always speak from the perspective of ${organizationName} and maintain brand consistency.`
    : "";

  const customContext = customInstructions
    ? `\n\n## Custom Instructions\n\n${customInstructions}`
    : "";

  const contextInstructions = `\n\n## CRITICAL RULES — MUST FOLLOW

**🚫 ABSOLUTE PROHIBITION on hallucination:**
- You may ONLY mention products that appear in the "## Available Products" section below
- If "## Available Products" is empty or says "No specific products are available", you MUST tell the customer: "Unfortunately I don't have [product type] in my current catalog."
- NEVER invent, guess, or recall products from your training data — not brand names, model numbers, specs, or prices
- If a customer asks for something outside the catalog, say so honestly and ask what else you can help with

**Product Information (when products ARE available):**
- Reference ONLY the products listed in "## Available Products"
- Use the exact prices and details shown — do not modify or estimate
- Include product links when provided

**Response Format:**
- Acknowledge the customer's question briefly
- If products found: list them with name, price, and key features
- If no products found: say honestly that the catalog doesn't have it
- End with a follow-up question or offer to help further
- Keep responses under 200 words unless a detailed comparison is requested

**Error Handling:**
- If product context is empty: tell the customer the catalog doesn't have a match, and ask what else you can help with
- Always maintain a helpful tone even when facing limitations`;

  return [basePrompt, organizationContext, customContext, contextInstructions]
    .filter(Boolean)
    .join("");
}

// =====================================================
// Context Formatting
// =====================================================

/**
 * Formats product matches into readable context
 */
function formatProductContext(matches: ProductMatch[]): string {
  if (matches.length === 0) {
    return "No specific products are available in the current context. Focus on understanding the customer's needs and ask clarifying questions to help them find what they're looking for.";
  }

  const contextHeader = `## Available Products (${matches.length} found)\n\nThe following products are relevant to the current conversation:\n\n`;

  const productEntries = matches.map((product, index) => {
    const entry = [
      `**${index + 1}. ${product.product_name}**`,
      `   - Product ID: ${product.product_id}`,
    ];

    if (product.product_description) {
      entry.push(`   - Description: ${product.product_description}`);
    }

    if (product.product_price !== undefined && product.product_price !== null) {
      entry.push(`   - Price: $${product.product_price}`);
    }

    if (product.product_category) {
      entry.push(`   - Category: ${product.product_category}`);
    }

    if (product.product_url) {
      entry.push(`   - Link: ${product.product_url}`);
    }

    entry.push(
      `   - Relevance: ${(product.similarity_score * 100).toFixed(1)}%`
    );

    if (product.metadata && Object.keys(product.metadata).length > 0) {
      const metadataStr = Object.entries(product.metadata)
        .map(([key, value]) => `${key}: ${value}`)
        .join(", ");
      entry.push(`   - Additional Info: ${metadataStr}`);
    }

    return entry.join("\n");
  });

  const usage =
    "\n\n**Usage Instructions:**\n- Reference these products by name when relevant\n- Include specific details like price and features in your responses\n- Provide product links when helpful\n- If none of these products match the customer's needs, ask clarifying questions";

  return contextHeader + productEntries.join("\n\n") + usage;
}

/**
 * Truncates conversation history to fit token budget
 */
function truncateConversationHistory(
  messages: ChatMessage[],
  maxTokens: number
): { truncatedHistory: ChatMessage[]; historyTruncated: boolean } {
  if (messages.length === 0) {
    return { truncatedHistory: [], historyTruncated: false };
  }

  // Keep recent messages up to the limit
  const maxMessages = Math.min(
    messages.length,
    PROMPT_CONFIG.MAX_HISTORY_MESSAGES
  );
  const recentMessages = messages.slice(-maxMessages);

  // Estimate tokens and truncate further if needed
  let tokenEstimate = 0;
  const truncatedHistory: ChatMessage[] = [];
  let historyTruncated = messages.length > maxMessages;

  // Add messages from most recent backwards until we hit token limit
  for (let i = recentMessages.length - 1; i >= 0; i--) {
    const message = recentMessages[i];
    const messageTokens = estimateMessageTokens(message);

    if (tokenEstimate + messageTokens > maxTokens * 0.3) {
      // Reserve 70% for other content
      historyTruncated = true;
      break;
    }

    truncatedHistory.unshift(message);
    tokenEstimate += messageTokens;
  }

  return { truncatedHistory, historyTruncated };
}

// =====================================================
// Token Management
// =====================================================

/**
 * Estimates token count for the complete prompt
 */
function estimateTokenCount(
  systemPrompt: string,
  history: ChatMessage[],
  productContext: string,
  query: string
): number {
  const systemTokens =
    systemPrompt.length * PROMPT_CONFIG.TOKENS_PER_CHAR_ESTIMATE;
  const historyTokens = history.reduce(
    (sum, msg) => sum + estimateMessageTokens(msg),
    0
  );
  const contextTokens =
    productContext.length * PROMPT_CONFIG.TOKENS_PER_CHAR_ESTIMATE;
  const queryTokens = query.length * PROMPT_CONFIG.TOKENS_PER_CHAR_ESTIMATE;

  return Math.ceil(systemTokens + historyTokens + contextTokens + queryTokens);
}

/**
 * Estimates tokens for a single message
 */
function estimateMessageTokens(message: ChatMessage): number {
  return Math.ceil(
    message.content.length * PROMPT_CONFIG.TOKENS_PER_CHAR_ESTIMATE
  );
}

/**
 * Applies final token budget and truncation
 */
async function applyTokenBudget(params: {
  system_prompt: string;
  conversation_history: ChatMessage[];
  product_context: string;
  current_query: string;
  max_tokens: number;
  initial_truncation: boolean;
}): Promise<PromptComponents> {
  const {
    system_prompt,
    conversation_history,
    product_context,
    current_query,
    max_tokens,
    initial_truncation,
  } = params;

  let finalProductContext = product_context;
  let additionalTruncation = false;

  // Estimate current token usage
  let tokenEstimate = estimateTokenCount(
    system_prompt,
    conversation_history,
    product_context,
    current_query
  );

  // Truncate product context if we're still over budget
  if (
    tokenEstimate > max_tokens &&
    product_context.length > PROMPT_CONFIG.MAX_PRODUCT_CONTEXT_LENGTH
  ) {
    finalProductContext =
      product_context.substring(0, PROMPT_CONFIG.MAX_PRODUCT_CONTEXT_LENGTH) +
      "\n\n[Product context truncated due to length...]";
    additionalTruncation = true;

    tokenEstimate = estimateTokenCount(
      system_prompt,
      conversation_history,
      finalProductContext,
      current_query
    );
  }

  return {
    system_prompt,
    conversation_history,
    product_context: finalProductContext,
    current_query,
    token_count_estimate: tokenEstimate,
    truncation_applied: initial_truncation || additionalTruncation,
  };
}

// =====================================================
// Utility Functions
// =====================================================

/**
 * Converts prompt components to OpenAI messages format
 */
export function convertToOpenAIMessages(
  components: PromptComponents
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }> = [];

  // System prompt with product context
  messages.push({
    role: "system",
    content: components.system_prompt + "\n\n" + components.product_context,
  });

  // Conversation history
  components.conversation_history.forEach((msg) => {
    messages.push({
      role: msg.role,
      content: msg.content,
    });
  });

  // Current user query
  messages.push({
    role: "user",
    content: components.current_query,
  });

  return messages;
}
