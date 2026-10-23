import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { generateEmbeddings } from "@/lib/ai/embedding-service";
import {
  mapProductToEmbeddingRow,
  type ProductEmbeddingRow,
} from "@/lib/products/product-embedding-mapper";
import {
  persistProductEmbeddings,
  type ProductPersistenceResult,
} from "@/lib/products/product-persistence";
import {
  authorizeOrganizationIngestion,
  type OrganizationAuthorizationResult,
} from "@/lib/supabase/organization-authorization";
import { createUserSupabaseClient } from "@/lib/supabase/server";
import { productIngestionRequestSchema } from "@/lib/validations/product-ingestion";

const organizationIdSchema = z.string().uuid();

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json(
    { status: "error", error: { code, message } },
    { status }
  );
}

export async function POST(request: NextRequest) {
  let supabase: Awaited<ReturnType<typeof createUserSupabaseClient>>;
  try {
    supabase = await createUserSupabaseClient();
  } catch {
    return errorResponse(
      "authentication_unavailable",
      "Authentication is temporarily unavailable",
      503
    );
  }

  let userId: string;
  try {
    const result = await supabase.auth.getUser();
    if (result.error || !result.data.user) {
      return errorResponse("unauthorized", "Authentication required", 401);
    }
    userId = result.data.user.id;
  } catch {
    return errorResponse(
      "authentication_unavailable",
      "Authentication is temporarily unavailable",
      503
    );
  }

  const organizationId = organizationIdSchema.safeParse(
    process.env.COMMERCE_DEMO_ORGANIZATION_ID
  );
  if (!organizationId.success) {
    return errorResponse(
      "configuration_error",
      "Product ingestion is not configured",
      503
    );
  }

  let authorization: OrganizationAuthorizationResult;
  try {
    authorization = await authorizeOrganizationIngestion(
      userId,
      organizationId.data
    );
  } catch {
    return errorResponse(
      "authorization_unavailable",
      "Organization authorization is temporarily unavailable",
      503
    );
  }

  if (!authorization.authorized) {
    if (authorization.reason === "database_error") {
      return errorResponse(
        "authorization_unavailable",
        "Organization authorization is temporarily unavailable",
        503
      );
    }

    return errorResponse(
      "forbidden",
      "You are not authorized to ingest products for this organization",
      403
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid_json", "Request body must be valid JSON", 400);
  }

  const validation = productIngestionRequestSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      {
        status: "error",
        error: {
          code: "validation_error",
          message: "Invalid product ingestion request",
          details: validation.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      },
      { status: 400 }
    );
  }

  const { products, batch_size: batchSize, overwrite_existing } =
    validation.data;

  const seenProductIds = new Set<string>();
  const duplicateIssues: { path: string; message: string }[] = [];
  products.forEach((product, index) => {
    if (seenProductIds.has(product.product_id)) {
      duplicateIssues.push({
        path: `products.${index}.product_id`,
        message: "Duplicate product_id in request",
      });
    }
    seenProductIds.add(product.product_id);
  });
  if (duplicateIssues.length > 0) {
    return NextResponse.json(
      {
        status: "error",
        error: {
          code: "validation_error",
          message: "Invalid product ingestion request",
          details: duplicateIssues,
        },
      },
      { status: 400 }
    );
  }

  let embeddingResults: Awaited<ReturnType<typeof generateEmbeddings>>["results"];
  try {
    embeddingResults = (await generateEmbeddings(products, { batchSize }))
      .results;
  } catch {
    return errorResponse(
      "embedding_unavailable",
      "Embedding generation is temporarily unavailable",
      503
    );
  }

  const internalError = () =>
    errorResponse(
      "internal_error",
      "Product ingestion could not be completed",
      500
    );

  if (
    !Array.isArray(embeddingResults) ||
    embeddingResults.length !== products.length ||
    embeddingResults.some(
      (result, index) => result?.product_id !== products[index].product_id
    )
  ) {
    return internalError();
  }

  let rows: ProductEmbeddingRow[];
  try {
    rows = products.map((product, index) =>
      mapProductToEmbeddingRow(
        organizationId.data,
        product,
        embeddingResults[index].embedding,
        embeddingResults[index].model
      )
    );
  } catch {
    return internalError();
  }

  let persistence: ProductPersistenceResult;
  try {
    persistence = await persistProductEmbeddings(
      organizationId.data,
      rows,
      overwrite_existing
    );
  } catch {
    return internalError();
  }

  if (persistence?.status !== "success") {
    if (persistence?.status === "error" && persistence.error === "database_error") {
      return errorResponse(
        "persistence_unavailable",
        "Product persistence is temporarily unavailable",
        503
      );
    }
    return internalError();
  }

  return NextResponse.json(
    {
      status: "persisted",
      persisted: true,
      attempted_count: persistence.attemptedCount,
      ...(persistence.successfulCount !== undefined
        ? { successful_count: persistence.successfulCount }
        : {}),
    },
    { status: 200 }
  );
}
