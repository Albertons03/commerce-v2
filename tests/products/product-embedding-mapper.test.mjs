import assert from "node:assert/strict";
import fs from "node:fs";
import Module from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const mapperPath = path.resolve(
  testDirectory,
  "../../lib/products/product-embedding-mapper.ts"
);

function loadMapper() {
  const source = fs.readFileSync(mapperPath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const loadedModule = new Module(mapperPath);
  loadedModule.filename = mapperPath;
  loadedModule.paths = Module._nodeModulePaths(path.dirname(mapperPath));
  loadedModule._compile(compiled, mapperPath);
  return loadedModule.exports;
}

const { mapProductToEmbeddingRow } = loadMapper();
const organizationId = "00000000-0000-4000-8000-000000000001";
const embedding = Array.from({ length: 1536 }, (_, index) => index / 1536);

function validProduct(overrides = {}) {
  return {
    product_id: "sku-001",
    product_name: "Demo product",
    product_description: "A sufficiently long product description.",
    ...overrides,
  };
}

test("maps a complete product to database column names", () => {
  const product = validProduct({
    category: "Accessories",
    price: 12.5,
    currency: "EUR",
    product_url: "https://example.com/product",
    product_image_url: "https://example.com/image.png",
    metadata: { color: "blue" },
  });
  const row = mapProductToEmbeddingRow(
    organizationId,
    product,
    embedding,
    "text-embedding-3-small",
    42
  );

  assert.deepEqual(row, {
    organization_id: organizationId,
    product_id: "sku-001",
    product_name: "Demo product",
    product_description: "A sufficiently long product description.",
    product_category: "Accessories",
    product_price: 12.5,
    product_currency: "EUR",
    product_url: "https://example.com/product",
    product_image_url: "https://example.com/image.png",
    embedding,
    embedding_model: "text-embedding-3-small",
    embedding_tokens: 42,
    metadata: { color: "blue" },
  });
});

test("maps absent nullable fields to null and leaves defaulted fields unset", () => {
  const row = mapProductToEmbeddingRow(
    organizationId,
    validProduct(),
    embedding,
    "text-embedding-3-small"
  );

  assert.equal(row.product_category, null);
  assert.equal(row.product_price, null);
  assert.equal(row.product_url, null);
  assert.equal(row.product_image_url, null);
  assert.equal(row.embedding_tokens, null);
  assert.equal("product_currency" in row, false);
  assert.equal("metadata" in row, false);
});

test("rejects a missing or invalid organization UUID", () => {
  for (const invalidId of ["", "not-a-uuid", undefined]) {
    assert.throws(
      () =>
        mapProductToEmbeddingRow(
          invalidId,
          validProduct(),
          embedding,
          "text-embedding-3-small"
        ),
      /organizationId must be a valid UUID/
    );
  }
});

test("rejects an embedding with the wrong dimension count", () => {
  assert.throws(
    () =>
      mapProductToEmbeddingRow(
        organizationId,
        validProduct(),
        embedding.slice(1),
        "text-embedding-3-small"
      ),
    /exactly 1536 finite numbers/
  );
});

test("rejects NaN and infinite embedding elements", () => {
  for (const invalidValue of [NaN, Infinity, -Infinity]) {
    const invalidEmbedding = [...embedding];
    invalidEmbedding[10] = invalidValue;

    assert.throws(
      () =>
        mapProductToEmbeddingRow(
          organizationId,
          validProduct(),
          invalidEmbedding,
          "text-embedding-3-small"
        ),
      /exactly 1536 finite numbers/
    );
  }
});

test("maps the model identifier and optional token count", () => {
  const withTokens = mapProductToEmbeddingRow(
    organizationId,
    validProduct(),
    embedding,
    "test-embedding-model",
    123
  );
  const withoutTokens = mapProductToEmbeddingRow(
    organizationId,
    validProduct(),
    embedding,
    "test-embedding-model"
  );

  assert.equal(withTokens.embedding_model, "test-embedding-model");
  assert.equal(withTokens.embedding_tokens, 123);
  assert.equal(withoutTokens.embedding_tokens, null);
});

test("preserves JSON-compatible metadata", () => {
  const metadata = {
    color: "blue",
    options: [null, true, 3.5, { size: "large" }],
    organization_id: "00000000-0000-4000-8000-000000000002",
  };
  const row = mapProductToEmbeddingRow(
    organizationId,
    validProduct({ metadata }),
    embedding,
    "text-embedding-3-small"
  );

  assert.equal(row.organization_id, organizationId);
  assert.deepEqual(row.metadata, metadata);
});

test("does not manufacture database-generated fields", () => {
  const row = mapProductToEmbeddingRow(
    organizationId,
    validProduct(),
    embedding,
    "text-embedding-3-small"
  );

  for (const generatedColumn of [
    "id",
    "created_at",
    "updated_at",
    "is_active",
  ]) {
    assert.equal(generatedColumn in row, false);
  }
});
