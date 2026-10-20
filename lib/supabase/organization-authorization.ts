import "server-only";

import { createUserSupabaseClient } from "./server";

export type OrganizationAuthorizationResult =
  | { authorized: true; role: "owner" | "admin" }
  | {
      authorized: false;
      reason:
        | "not_member"
        | "insufficient_role"
        | "unexpected_role"
        | "database_error";
      role?: unknown;
      error?: unknown;
    };

export async function authorizeOrganizationIngestion(
  userId: string,
  organizationId: string
): Promise<OrganizationAuthorizationResult> {
  try {
    const supabase = await createUserSupabaseClient();
    const { data, error } = await supabase
      .from("organization_members")
      .select("role")
      .eq("user_id", userId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (error) {
      return { authorized: false, reason: "database_error", error };
    }

    if (!data) {
      return { authorized: false, reason: "not_member" };
    }

    if (data.role === "owner" || data.role === "admin") {
      return { authorized: true, role: data.role };
    }

    if (data.role === "member") {
      return {
        authorized: false,
        reason: "insufficient_role",
        role: data.role,
      };
    }

    return {
      authorized: false,
      reason: "unexpected_role",
      role: data.role,
    };
  } catch (error) {
    return { authorized: false, reason: "database_error", error };
  }
}
