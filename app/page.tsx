import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createUserSupabaseClient } from "@/lib/supabase/server";
import ProductIngestion from "./product-ingestion";
import { connection } from "next/server";

async function ProtectedDashboard() {
    await connection();
  const supabase = await createUserSupabaseClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/login");
  }

  return (
   <main className="min-h-screen bg-zinc-950 text-white">
    <div className="mx-auto max-w-5xl px-6 pt-6 text-right text-sm text-zinc-400">
      Signed in as:{" "}
      <span className="font-medium text-indigo-400">
        {user.email ?? "Unknown user"}
      </span>
    </div>

    <ProductIngestion />
  </main>
  );
}

export default function Home() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-zinc-950 p-8 text-zinc-400">
          Checking authentication...
        </main>
      }
    >
      <ProtectedDashboard />
    </Suspense>
  );
}