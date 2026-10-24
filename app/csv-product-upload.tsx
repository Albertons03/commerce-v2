
"use client";

import { useState, type ChangeEvent } from "react";
import {
  parseProductCsv,
  type CsvParseResult,
} from "@/lib/products/parse-product-csv";

const MAX_FILE_BYTES = 1024 * 1024;
const IMPORT_BATCH_SIZE = 10;

type ImportSummary = {
  inserted: number;
  skipped: number;
  unconfirmed: number;
  messages: string[];
};

type ImportCounts = {
  inserted: number;
  skipped: number;
};

function getApiError(data: unknown): string {
  if (typeof data !== "object" || data === null) {
    return "Unexpected server response.";
  }

  if ("error" in data) {
    const error = data.error;

    if (typeof error === "string") return error;

    if (
      typeof error === "object" &&
      error !== null &&
      "message" in error &&
      typeof error.message === "string"
    ) {
      return error.message;
    }
  }

  return "Product ingestion failed.";
}



function getImportCounts(
  data: unknown,
  expected: number
): ImportCounts {
  if (
    typeof data !== "object" ||
    data === null ||
    !("status" in data) ||
    data.status !== "persisted" ||
    !("persisted" in data) ||
    data.persisted !== true ||
    !("attempted_count" in data) ||
    data.attempted_count !== expected
  ) {
    throw new Error("Server did not confirm the expected import.");
  }

  if (
    !("successful_count" in data) ||
    typeof data.successful_count !== "number" ||
    !Number.isInteger(data.successful_count) ||
    data.successful_count < 0 ||
    data.successful_count > expected
  ) {
    throw new Error("Invalid or missing successful_count.");
  }

  if (
    !("skipped_count" in data) ||
    typeof data.skipped_count !== "number" ||
    !Number.isInteger(data.skipped_count) ||
    data.skipped_count < 0 ||
    data.skipped_count > expected
  ) {
    throw new Error("Invalid or missing skipped_count.");
  }

  if (data.successful_count + data.skipped_count !== expected) {
    throw new Error("Server import counts do not match.");
  }

  return {
    inserted: data.successful_count,
    skipped: data.skipped_count,
  };
}

export default function CsvProductUpload() {
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<CsvParseResult | null>(
    null
  );
  const [fileError, setFileError] = useState("");
  const [importing, setImporting] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [summary, setSummary] = useState<ImportSummary | null>(
    null
  );

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    setPreview(null);
    setSummary(null);
    setFileError("");
    setFileName("");
    setCompleted(0);

    if (!file) return;

    setFileName(file.name);

    if (!file.name.toLowerCase().endsWith(".csv")) {
      setFileError("Please select a CSV file.");
      return;
    }

    if (file.size > MAX_FILE_BYTES) {
      setFileError("Maximum CSV file size is 1 MB.");
      return;
    }

    try {
      const text = await file.text();
      setPreview(parseProductCsv(text));
    } catch (cause) {
      setFileError(
        cause instanceof Error
          ? cause.message
          : "Unable to read CSV file."
      );
    }
  }

  async function handleImport() {
    if (
      importing ||
      !preview ||
      preview.errors.length > 0 ||
      preview.validProducts.length === 0
    ) {
      return;
    }

    const products = preview.validProducts;
    const messages: string[] = [];
    let inserted = 0;
    let skipped = 0;
    let unconfirmed = 0;

    setImporting(true);
    setSummary(null);
    setCompleted(0);

    try {
      for (let index = 0; index < products.length; index += IMPORT_BATCH_SIZE) {
        const batch = products.slice(
          index,
          index + IMPORT_BATCH_SIZE
        );

        const batchNumber =
          Math.floor(index / IMPORT_BATCH_SIZE) + 1;

        try {
          const response = await fetch("/api/products/ingest", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              products: batch,
              batch_size: IMPORT_BATCH_SIZE,
              overwrite_existing: false,
            }),
          });

          const data: unknown = await response.json();

          if (!response.ok) {
            throw new Error(getApiError(data));
          }

          const counts = getImportCounts(data, batch.length);
          inserted += counts.inserted;
          skipped += counts.skipped;

          if (counts.skipped > 0) {
            messages.push(
              `Batch ${batchNumber}: ${counts.skipped} existing products skipped.`
            );
          }
        } catch (cause) {
          unconfirmed += batch.length;

          messages.push(
            `Batch ${batchNumber}: ${
              cause instanceof Error
                ? cause.message
                : "Unexpected error."
            }`
          );
        }

        setCompleted(
          Math.min(index + batch.length, products.length)
        );
      }
    } finally {
      setSummary({ inserted, skipped, unconfirmed, messages });
      setImporting(false);
    }
  }

  const validCount = preview?.validProducts.length ?? 0;
  const invalidRows =
    preview?.rows.filter((row) => row.errors.length > 0) ?? [];

  const canImport =
    !importing &&
    !!preview &&
    preview.errors.length === 0 &&
    validCount > 0;

  return (
    <section className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-950 p-6 text-zinc-100 sm:p-8">
      <div className="mb-6">
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-indigo-400">
          Bulk Ingestion
        </p>
        <h2 className="text-2xl font-semibold">
          Import products from CSV
        </h2>
        <p className="mt-2 text-sm text-zinc-400">
          Upload up to 50 products. Preview validation results
          before generating embeddings and saving products.
        </p>
      </div>

      <label className="block space-y-2 text-sm text-zinc-300">
        Select CSV file
        <input
          type="file"
          accept=".csv,text/csv"
          disabled={importing}
          onChange={handleFile}
          className="block w-full rounded-xl border border-zinc-700 bg-zinc-900 p-3 text-sm text-zinc-200 file:mr-4 file:rounded-lg file:border-0 file:bg-indigo-500 file:px-4 file:py-2 file:text-white"
        />
      </label>

      <p className="mt-3 text-xs text-zinc-500">
        Required columns: product_id, product_name,
        product_description. Optional: category, price,
        currency, product_url, product_image_url.
      </p>

      {fileName && (
        <p className="mt-4 text-sm text-zinc-400">
          File: {fileName}
        </p>
      )}

      {fileError && (
        <p role="alert" className="mt-4 text-sm text-red-400">
          {fileError}
        </p>
      )}

      {preview && (
        <div className="mt-6 space-y-5">
          <div className="flex flex-wrap gap-3 text-sm">
            <span className="rounded-lg bg-emerald-950 px-3 py-2 text-emerald-300">
              Valid: {validCount}
            </span>
            <span className="rounded-lg bg-red-950 px-3 py-2 text-red-300">
              Invalid: {invalidRows.length}
            </span>
          </div>

          {preview.errors.map((error, index) => (
            <p key={index} role="alert" className="text-sm text-red-400">
              {error}
            </p>
          ))}

          <div className="max-h-80 overflow-auto rounded-xl border border-zinc-800">
            <table className="w-full min-w-lg text-left text-sm">
              <thead className="sticky top-0 bg-zinc-900 text-zinc-400">
                <tr>
                  <th className="p-3">Row</th>
                  <th className="p-3">Product</th>
                  <th className="p-3">Price</th>
                  <th className="p-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.row} className="border-t border-zinc-800">
                    <td className="p-3">{row.row}</td>
                    <td className="p-3">
                      {row.product?.product_name ?? "Invalid product"}
                    </td>
                    <td className="p-3">
                      {row.product?.price ?? "—"}
                    </td>
                    <td className="p-3">
                      {row.errors.length === 0 ? (
                        <span className="text-emerald-400">Valid</span>
                      ) : (
                        <span className="text-red-400">
                          {row.errors.join("; ")}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {invalidRows.length > 0 && (
            <p className="text-xs text-amber-400">
              Invalid rows will be skipped. Only valid products
              will be submitted.
            </p>
          )}

          <button
            type="button"
            disabled={!canImport}
            onClick={handleImport}
            className="w-full rounded-xl bg-indigo-500 px-5 py-3 font-semibold text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {importing
              ? `Importing... ${completed}/${validCount}`
              : `Import ${validCount} valid products`}
          </button>
        </div>
      )}

      {summary && (
        <div
          role="status"
          className="mt-6 rounded-xl border border-zinc-700 p-4 text-sm"
        >
          <p className="font-semibold">Import finished</p>
          <p className="mt-2 text-emerald-400">
            Inserted: {summary.inserted}
          </p>
          <p className="text-amber-400">
            Skipped (already existing): {summary.skipped}
          </p>
          <p className="text-red-400">
            Failed / Unconfirmed: {summary.unconfirmed}
          </p>
          {summary.messages.map((message, index) => (
            <p key={index} className="mt-2 text-zinc-400">
              {message}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
