
"use client";

import { useState, type FormEvent } from "react";

type ProductForm = {
  product_id: string;
  product_name: string;
  product_description: string;
  category: string;
  price: string;
  currency: string;
  product_url: string;
};

const initialForm: ProductForm = {
  product_id: "",
  product_name: "",
  product_description: "",
  category: "",
  price: "",
  currency: "EUR",
  product_url: "",
};

export default function Home() {
  const [form, setForm] = useState<ProductForm>(initialForm);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");

  function update(field: keyof ProductForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;

    setLoading(true);
    setResult("");
    setError("");

    try {
      const product = {
        product_id: form.product_id.trim(),
        product_name: form.product_name.trim(),
        product_description: form.product_description.trim(),
        ...(form.category.trim() && { category: form.category.trim() }),
        ...(form.price.trim() && { price: Number(form.price) }),
        ...(form.currency.trim() && { currency: form.currency.trim().toUpperCase() }),
        ...(form.product_url.trim() && { product_url: form.product_url.trim() }),
      };

      const response = await fetch("/api/products/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          products: [product],
          batch_size: 1,
          overwrite_existing: false,
        }),
      });

      const data: unknown = await response.json();

      if (!response.ok) {
        const message =
          typeof data === "object" &&
          data !== null &&
          "error" in data &&
          typeof data.error === "string"
            ? data.error
            : "Product ingestion failed.";

        throw new Error(message);
      }

      if (
        typeof data !== "object" ||
        data === null ||
        !("persisted" in data) ||
        data.persisted !== true
      ) {
        throw new Error("The server did not confirm persistence.");
      }

      setResult("Product ingestion completed successfully.");
      setForm(initialForm);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unexpected error.");
    } finally {
      setLoading(false);
    }
  }

  const fieldClass =
    "w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm text-white outline-none transition focus:border-indigo-400";

  return (
    <main className="min-h-screen bg-[#090b12] px-5 py-12 text-zinc-100">
      <div className="mx-auto max-w-3xl">
        <div className="mb-10">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.3em] text-indigo-400">
            Commerce V2
          </p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Product Ingestion
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-7 text-zinc-400">
            Add a product to your AI-powered commerce catalog.
            The server generates a semantic embedding and stores the product.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-6 rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl sm:p-8"
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="space-y-2 text-sm text-zinc-300">
              Product ID *
              <input
                className={fieldClass}
                value={form.product_id}
                onChange={(e) => update("product_id", e.target.value)}
                maxLength={255}
                required
                placeholder="SKU-001"
              />
            </label>
            <label className="space-y-2 text-sm text-zinc-300">
              Category
              <input
                className={fieldClass}
                value={form.category}
                onChange={(e) => update("category", e.target.value)}
                maxLength={100}
                placeholder="Footwear"
              />
            </label>
          </div>

          <label className="block space-y-2 text-sm text-zinc-300">
            Product name *
            <input
              className={fieldClass}
              value={form.product_name}
              onChange={(e) => update("product_name", e.target.value)}
              minLength={2}
              maxLength={500}
              required
              placeholder="Everyday Running Shoes"
            />
          </label>

          <label className="block space-y-2 text-sm text-zinc-300">
            Description *
            <textarea
              className={fieldClass + " min-h-32 resize-y"}
              value={form.product_description}
              onChange={(e) => update("product_description", e.target.value)}
              minLength={10}
              maxLength={5000}
              required
              placeholder="Lightweight running shoes with breathable mesh..."
            />
          </label>

          <div className="grid gap-5 sm:grid-cols-2">
            <label className="space-y-2 text-sm text-zinc-300">
              Price
              <input
                className={fieldClass}
                type="number"
                min="0"
                step="any"
                value={form.price}
                onChange={(e) => update("price", e.target.value)}
                placeholder="79.90"
              />
            </label>
            <label className="space-y-2 text-sm text-zinc-300">
              Currency
              <input
                className={fieldClass}
                value={form.currency}
                onChange={(e) => update("currency", e.target.value)}
                maxLength={3}
                pattern="[A-Za-z]{3}"
                placeholder="EUR"
              />
            </label>
          </div>

          <label className="block space-y-2 text-sm text-zinc-300">
            Product URL
            <input
              className={fieldClass}
              type="url"
              value={form.product_url}
              onChange={(e) => update("product_url", e.target.value)}
              placeholder="https://example.com/product"
            />
          </label>

          <div className="border-t border-zinc-800 pt-6">
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-indigo-500 px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Processing product..." : "Generate embedding & save product"}
            </button>
            <p className="mt-3 text-center text-xs text-zinc-500">
              Requires an authorized session and configured organization.
            </p>
          </div>

          {result && (
            <div role="status" className="rounded-xl border border-emerald-800 bg-emerald-950/40 p-4 text-sm text-emerald-300">
              {result}
            </div>
          )}

          {error && (
            <div role="alert" className="rounded-xl border border-red-900 bg-red-950/40 p-4 text-sm text-red-300">
              {error}
            </div>
          )}
        </form>
      </div>
    </main>
  );
}
