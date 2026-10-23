
import { NextResponse } from "next/server";
import { createUserSupabaseClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = await createUserSupabaseClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "unauthorized" },
        { status: 401 }
      );
    }

    const organizationId =
      process.env.COMMERCE_DEMO_ORGANIZATION_ID;

    if (!organizationId) {
      return NextResponse.json(
        { error: "configuration_error" },
        { status: 503 }
      );
    }

    // Membership verification using the authenticated user.
    const { data: membership, error: membershipError } =
      await supabase
        .from("organization_members")
        .select("role")
        .eq("organization_id", organizationId)
        .eq("user_id", user.id)
        .maybeSingle();

    if (membershipError) {
      return NextResponse.json(
        { error: "database_error" },
        { status: 503 }
      );
    }

    if (!membership) {
      return NextResponse.json(
        { error: "forbidden" },
        { status: 403 }
      );
    }

    // Only retrieve catalog fields, never embedding vectors.
    const { data: products, error: productsError } =
      await supabase
        .from("product_embeddings")
        .select(
          "product_id, product_name, product_description, product_category, product_price, product_currency, product_url, product_image_url"
        )
        .eq("organization_id", organizationId)
        .order("product_name", { ascending: true })
        .limit(100);

    if (productsError) {
      return NextResponse.json(
        { error: "database_error" },
        { status: 503 }
      );
    }

    return NextResponse.json({
      products: products ?? [],
      count: products?.length ?? 0,
    });
  } catch {
    return NextResponse.json(
      { error: "internal_error" },
      { status: 500 }
    );
  }
}
