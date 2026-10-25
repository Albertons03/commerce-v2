
"use client";

import { useState, type FormEvent } from "react";

const ORGANIZATION_ID =
  "1eacb95b-8f8e-4f7c-bd32-de4ef92f4257";

interface Product {
  product_id: string;
  product_name: string;
  product_price?: number;
  product_category?: string;
  product_url?: string;
  similarity_score: number;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  products?: Product[];
}

interface ChatApiResponse {
  message?: string;
  products?: Product[];
  error?: string;
}

export default function ChatTestPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const question = query.trim();

    if (!question || loading) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: question,
    };

    setMessages((previous) => [...previous, userMessage]);
    setQuery("");
    setError(null);
    setLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({
          organization_id: ORGANIZATION_ID,
          query: question,
        }),
      });

      const data: ChatApiResponse = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ?? `Chat request failed (${response.status})`,
        );
      }

      if (typeof data.message !== "string") {
        throw new Error("Invalid chat response");
      }

      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data.message,
        products: Array.isArray(data.products)
          ? data.products
          : [],
      };

      setMessages((previous) => [...previous, assistantMessage]);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Something went wrong",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col p-4 md:p-8">
      <header className="mb-6 border-b pb-4">
        <h1 className="text-2xl font-bold">
          Commerce V2 — AI Shopping Assistant
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          RAG-powered product recommendations
        </p>
      </header>

      <section
        aria-label="Chat conversation"
        className="flex-1 space-y-5"
      >
        {messages.length === 0 && (
          <div className="rounded-xl border border-dashed p-8 text-center">
            <h2 className="text-lg font-semibold">
              Welcome to your AI Shopping Assistant
            </h2>
            <p className="mt-2 text-sm text-gray-500">
              Ask about products, prices, or recommendations.
            </p>
          </div>
        )}

        {messages.map((message) => (
          <article
            key={message.id}
            className={`flex ${
              message.role === "user"
                ? "justify-end"
                : "justify-start"
            }`}
          >
            <div
              className={`max-w-[90%] rounded-2xl p-4 md:max-w-[80%] ${
                message.role === "user"
                  ? "bg-indigo-600 text-white"
                  : "border bg-gray-50 text-gray-900"
              }`}
            >
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide opacity-70">
                {message.role === "user" ? "You" : "AI Assistant"}
              </p>

              <p className="whitespace-pre-wrap text-sm leading-relaxed">
                {message.content}
              </p>

              {message.products && message.products.length > 0 && (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {message.products.map((product) => (
                    <div
                      key={product.product_id}
                      className="rounded-lg border bg-white p-3 text-gray-900"
                    >
                      <h3 className="font-semibold">
                        {product.product_name}
                      </h3>

                      {typeof product.product_price === "number" && (
                        <p className="mt-1 font-medium text-indigo-700">
                          ${product.product_price.toFixed(2)}
                        </p>
                      )}

                      <p className="mt-2 text-xs text-gray-500">
                        Similarity:{" "}
                        {(product.similarity_score * 100).toFixed(1)}%
                      </p>

                      {product.product_url && (
                        <a
                          href={product.product_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-2 inline-block text-sm text-indigo-700 underline"
                        >
                          View product
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </article>
        ))}

        {loading && (
          <p role="status" className="text-sm text-gray-500">
            AI is searching the product catalog...
          </p>
        )}
      </section>

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <form onSubmit={sendMessage} className="mt-6 flex gap-3 border-t pt-4">
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Ask about a product..."
          maxLength={2000}
          className="min-w-0 flex-1 rounded-xl border px-4 py-3 text-gray-900"
          disabled={loading}
          aria-label="Your message"
        />

        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="rounded-xl bg-indigo-600 px-6 py-3 font-medium text-white disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </main>
  );
}
