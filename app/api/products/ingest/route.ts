import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
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

  return NextResponse.json(
    {
      status: "validated",
      product_count: validation.data.products.length,
      persisted: false,
    },
    { status: 200 }
  );
}
