import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createUserSupabaseClient } from "@/lib/supabase/server";
import { performVectorSearch } from "@/lib/ai/rag-service";
import { buildRAGPrompt } from "@/lib/ai/prompt-builder";
import { generateChatResponse } from "@/lib/ai/chat-service";
import { extractPriceFilter } from "@/lib/ai/extract-price-filter";
import { getCatalogFallback } from "@/lib/ai/catalog-fallback";
import { extractCategoryFilter } from "@/lib/ai/extract-category-filter";

function isGeneralCatalogQuery(query: string): boolean {
  const normalized = query.trim().toLowerCase();

  return [
    "milyen termékeket ajánlasz",
    "milyen termékeitek vannak",
    "mutasd a termékeket",
    "show me your products",
    "what products do you have",
  ].some((phrase) => normalized.includes(phrase));
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createUserSupabaseClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body: unknown = await request.json();

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 },
      );
    }

    const input = body as Record<string, unknown>;
    const query = input.query;
    const organizationId = input.organization_id;

    if (
      typeof query !== "string" ||
      !query.trim() ||
      query.length > 2000 ||
      typeof organizationId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        organizationId,
      )
    ) {
      return NextResponse.json(
        { error: "Invalid query or organization_id" },
        { status: 400 },
      );
    }

    // Explicit organization authorization.
    const { data: membership, error: membershipError } = await supabase
      .from("organization_members")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (membershipError) {
      console.error("[Chat API] Membership lookup failed", {
        code: membershipError.code,
      });

      return NextResponse.json(
        { error: "Authorization check failed" },
        { status: 503 },
      );
    }

    if (
      !membership ||
      (membership.role !== "owner" && membership.role !== "admin")
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const priceFilter = extractPriceFilter(query);

    const category = extractCategoryFilter(query);

    const ragResult = await performVectorSearch(
      {
        organization_id: organizationId,
        query: query.trim(),
        top_k: 5,
        similarity_threshold: 0.3,
        ...(priceFilter ?? {}),
       ...(category !== null ? { category } : {}),
      },
      supabase,
    );

    const useCatalogFallback =
      ragResult.matches.length === 0 &&
      priceFilter === null &&
      isGeneralCatalogQuery(query);

    const productMatches = useCatalogFallback
      ? await getCatalogFallback(organizationId, supabase)
      : ragResult.matches;

    const prompt = await buildRAGPrompt({
      query: query.trim(),
      conversation_context: {
        conversation_id: crypto.randomUUID(),
        organization_id: organizationId,
        previous_messages: [],
      },
      product_matches: productMatches,
    });

    const response = await generateChatResponse({
      prompt_components: prompt,
      organization_id: organizationId,
      stream: false,
    });

    return NextResponse.json({
      message: response.message,
      response_id: response.response_id,
      model_used: response.model_used,
      products: productMatches,
      retrieval_time_ms: ragResult.total_time_ms,
    });
  } catch (error) {
    console.error("[Chat API] Request failed", error);

    return NextResponse.json({ error: "Chat request failed" }, { status: 500 });
  }
}
