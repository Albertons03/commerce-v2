
"use server";

import { redirect } from "next/navigation";
import { createUserSupabaseClient } from "@/lib/supabase/server";

export async function logout() {
  try {
    const supabase = await createUserSupabaseClient();
    await supabase.auth.signOut();
  } catch {
    redirect("/login?error=unavailable");
  }

  redirect("/login");
}
