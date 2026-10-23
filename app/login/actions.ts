
"use server";

import { redirect } from "next/navigation";
import { createUserSupabaseClient } from "@/lib/supabase/server";

export async function login(formData: FormData) {
  const email = formData.get("email");
  const password = formData.get("password");

  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    !email.trim() ||
    !password
  ) {
    redirect("/login?error=invalid_input");
  }

  let success = false;

  try {
    const supabase = await createUserSupabaseClient();

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    success = !error;
  } catch {
    redirect("/login?error=unavailable");
  }

  if (!success) {
    redirect("/login?error=invalid_credentials");
  }

  redirect("/");
}
