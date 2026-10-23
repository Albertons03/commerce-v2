
import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createUserSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and a Supabase publishable or anon key are required"
    );
  }

  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },

      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch (error) {
          // Server Components cannot write cookies.
          // Other errors must not be silently ignored.
          if (
            !(error instanceof Error) ||
            !error.message.includes(
              "Cookies can only be modified"
            )
          ) {
            throw error;
          }
        }
      },
    },
  });
}
