
"use client";

import { useState } from "react";

export default function ChatTestPage() {
  const [query, setQuery] = useState(
    "Milyen Samsung telefonokat ajánlasz?",
  );
  const [result, setResult] = useState<unknown>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  async function testChat() {
    setLoading(true);
    setResult(null);
    setStatus(null);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({
          organization_id:
            "1eacb95b-8f8e-4f7c-bd32-de4ef92f4257",
          query,
        }),
      });

      setStatus(response.status);
      setResult(await response.json());
    } catch (error) {
      setResult({
        error:
          error instanceof Error
            ? error.message
            : "Unknown error",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="mb-6 text-2xl font-bold">
        Commerce V2 — AI Chat Test
      </h1>

      <textarea
        className="mb-4 w-full rounded border p-3 text-black"
        rows={3}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <button
        onClick={testChat}
        disabled={loading || !query.trim()}
        className="rounded bg-indigo-600 px-5 py-3 text-white disabled:opacity-50"
      >
        {loading ? "Testing..." : "Test AI Chat"}
      </button>

      {status !== null && (
        <p className="mt-6">HTTP status: {status}</p>
      )}

      {result !== null && (
        <pre className="mt-4 overflow-auto whitespace-pre-wrap rounded bg-gray-900 p-4 text-sm text-white">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </main>
  );
}
