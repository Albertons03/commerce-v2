import "server-only";

import { z } from "zod";
import type { ProductEmbeddingRow } from "./product-embedding-mapper";
import { createUserSupabaseClient } from "@/lib/supabase/server";

const organizationIdSchema = z.string().uuid();
const CONFLICT_TARGET = "organization_id,product_id";

export type ProductPersistenceError =
  | "invalid_organization_id"
  | "empty_batch"
  | "duplicate_product_ids"
  | "organization_mismatch"
  | "invalid_row_identifier"
  | "database_error";

export type ProductPersistenceResult =
  | {
      status: "success";
      attemptedCount: number;
      successfulCount?: number;
      operation: "insert" | "upsert";
    }
  | {
      status: "error";
      attemptedCount: number;
      error: ProductPersistenceError;
    };

export async function persistProductEmbeddings(
  organizationId: string,
  rows: readonly ProductEmbeddingRow[],
  overwriteExisting: boolean
): Promise<ProductPersistenceResult> {
  if (!organizationIdSchema.safeParse(organizationId).success) {
    return {
      status: "error",
      attemptedCount: rows.length,
      error: "invalid_organization_id",
    };
  }

  if (rows.length === 0) {
    return {
      status: "error",
      attemptedCount: 0,
      error: "empty_batch",
    };
  }

  const seenProductIds = new Set<string>();
  for (const row of rows) {
    if (
      !row ||
      typeof row !== "object" ||
      typeof row.product_id !== "string" ||
      row.product_id.length === 0 ||
      row.product_id.length > 255 ||
      typeof row.organization_id !== "string"
    ) {
      return {
        status: "error",
        attemptedCount: rows.length,
        error: "invalid_row_identifier",
      };
    }

    if (row.organization_id.toLowerCase() !== organizationId.toLowerCase()) {
      return {
        status: "error",
        attemptedCount: rows.length,
        error: "organization_mismatch",
      };
    }

    if (seenProductIds.has(row.product_id)) {
      return {
        status: "error",
        attemptedCount: rows.length,
        error: "duplicate_product_ids",
      };
    }
    seenProductIds.add(row.product_id);
  }

  try {
    const supabase = await createUserSupabaseClient();
    const { data, error } = await supabase
      .from("product_embeddings")
      .upsert(rows, {
        onConflict: CONFLICT_TARGET,
        ignoreDuplicates: !overwriteExisting,
        defaultToNull: false,
      })
      .select("product_id");

    if (error) {
      return {
        status: "error",
        attemptedCount: rows.length,
        error: "database_error",
      };
    }

    return {
      status: "success",
      attemptedCount: rows.length,
      ...(Array.isArray(data) ? { successfulCount: data.length } : {}),
      operation: overwriteExisting ? "upsert" : "insert",
    };
  } catch {
    return {
      status: "error",
      attemptedCount: rows.length,
      error: "database_error",
    };
  }
}
