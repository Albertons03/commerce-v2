
import { Suspense } from "react";
import { login } from "./actions";

type LoginPageProps = {
  searchParams: Promise<{ error?: string }>;
};

const errorMessages: Record<string, string> = {
  invalid_input: "Enter your email and password.",
  invalid_credentials: "Invalid email or password.",
  unavailable: "Authentication is temporarily unavailable.",
};

async function LoginForm({ searchParams }: LoginPageProps) {
  const { error } = await searchParams;

  return (
    <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 p-8">
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.3em] text-indigo-400">
        Commerce V2
      </p>

      <h1 className="text-3xl font-semibold">Sign in</h1>

      <p className="mt-3 text-sm text-zinc-400">
        Access your AI-powered commerce dashboard.
      </p>

      <form action={login} className="mt-8 space-y-5">
        <label className="block space-y-2 text-sm text-zinc-300">
          Email
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-white outline-none focus:border-indigo-400"
          />
        </label>

        <label className="block space-y-2 text-sm text-zinc-300">
          Password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-white outline-none focus:border-indigo-400"
          />
        </label>

        {error && (
          <p role="alert" className="text-sm text-red-400">
            {errorMessages[error] ?? "Sign-in failed."}
          </p>
        )}

        <button
          type="submit"
          className="w-full rounded-xl bg-indigo-500 px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-indigo-400"
        >
          Sign in
        </button>
      </form>
    </div>
  );
}

export default function LoginPage({ searchParams }: LoginPageProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#090b12] px-5 text-zinc-100">
      <Suspense
        fallback={
          <p className="text-sm text-zinc-400">
            Loading sign-in...
          </p>
        }
      >
        <LoginForm searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
