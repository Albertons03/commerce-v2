
"use client";

import { useEffect, useState } from "react";

type Product = {
  product_id: string;
  product_name: string;
  product_description: string;
  product_category: string | null;
  product_price: number | null;
  product_currency: string | null;
  product_url: string | null;
  product_image_url: string | null;
};

type ProductsResponse = {
  products: Product[];
  count: number;
};

function formatPrice(price: number | null, currency: string | null) {
  if (price === null || !Number.isFinite(price)) {
    return "Price unavailable";
  }

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
    }).format(price);
  } catch {
    return `${price.toFixed(2)} ${currency || "USD"}`;
  }
}

export default function ProductCatalog() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    async function loadProducts() {
      try {
        const response = await fetch("/api/products", {
          signal: controller.signal,
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error("Unable to load products.");
        }

        const data: ProductsResponse = await response.json();

        if (!Array.isArray(data.products)) {
          throw new Error("Invalid product response.");
        }

        setProducts(data.products);
      } catch (err) {
        if (controller.signal.aborted) return;

        setError(
          err instanceof Error
            ? err.message
            : "Unexpected error."
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void loadProducts();

    return () => controller.abort();
  }, []);

  const filteredProducts = products.filter((product) => {
    const query = search.trim().toLowerCase();

    return (
      product.product_name.toLowerCase().includes(query) ||
      product.product_description.toLowerCase().includes(query) ||
      (product.product_category ?? "").toLowerCase().includes(query)
    );
  });

  return (
    <section className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">
            Product Catalog
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            Browse products stored in your organization.
          </p>
        </div>

        <span className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-300">
          {products.length} products
        </span>
      </div>

      <input
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search products..."
        aria-label="Search products"
        className="mb-6 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm text-white outline-none transition focus:border-indigo-500"
      />

      {loading && (
        <p className="py-10 text-center text-zinc-400">
          Loading products...
        </p>
      )}

      {!loading && error && (
        <div
          role="alert"
          className="rounded-xl border border-red-900 bg-red-950/40 p-5 text-red-300"
        >
          {error}
        </div>
      )}

      {!loading && !error && filteredProducts.length === 0 && (
        <p className="rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center text-zinc-400">
          {search ? "No matching products." : "No products found."}
        </p>
      )}

      {!loading && !error && filteredProducts.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {filteredProducts.map((product) => (
            <article
              key={product.product_id}
              className="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-5 transition hover:border-indigo-500/50"
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <h3 className="text-lg font-semibold text-white">
                  {product.product_name}
                </h3>

                <span className="shrink-0 text-sm font-semibold text-indigo-400">
                  {formatPrice(
                    product.product_price,
                    product.product_currency
                  )}
                </span>
              </div>

              <p className="mb-4 line-clamp-3 text-sm leading-6 text-zinc-400">
                {product.product_description}
              </p>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="rounded-full bg-zinc-800 px-3 py-1 text-xs text-zinc-300">
                  {product.product_category || "Uncategorized"}
                </span>

                <span className="text-xs text-zinc-500">
                  {product.product_id}
                </span>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
