import assert from "node:assert/strict";
import fs from "node:fs";
import Module from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(
  testDirectory,
  "../../lib/validations/product-ingestion.ts"
);
const source = fs.readFileSync(sourcePath, "utf8");
const compiledSource = ts.transpileModule(source, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;

function loadSchemas() {
  const loadedModule = new Module(sourcePath);
  loadedModule.filename = sourcePath;
  loadedModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
  loadedModule._compile(compiledSource, sourcePath);
  return loadedModule.exports;
}

const { productInputSchema, productIngestionRequestSchema } = loadSchemas();

function validProduct(overrides = {}) {
  return {
    product_id: "sku-001",
    product_name: "Demo product",
    product_description: "A valid product description.",
    ...overrides,
  };
}

test("accepts a valid product", () => {
  const result = productInputSchema.safeParse(
    validProduct({
      category: "Accessories",
      price: 12.5,
      currency: "USD",
      product_url: "https://example.com/product",
      product_image_url: "http://example.com/image.png",
      metadata: {
        color: "blue",
        options: [null, true, 1, { size: "large" }],
      },
    })
  );

  assert.equal(result.success, true);
});

test("rejects names and descriptions below their minimum lengths", () => {
  assert.equal(productInputSchema.safeParse(validProduct({ product_name: "A" })).success, false);
  assert.equal(
    productInputSchema.safeParse(
      validProduct({ product_description: "Too short" })
    ).success,
    false
  );
});

test("rejects negative and non-finite prices", () => {
  assert.equal(productInputSchema.safeParse(validProduct({ price: -1 })).success, false);
  assert.equal(
    productInputSchema.safeParse(validProduct({ price: Infinity })).success,
    false
  );
});

test("rejects invalid and non-HTTP URLs", () => {
  assert.equal(
    productInputSchema.safeParse(validProduct({ product_url: "not-a-url" })).success,
    false
  );
  assert.equal(
    productInputSchema.safeParse(
      validProduct({ product_image_url: "ftp://example.com/image.png" })
    ).success,
    false
  );
});

test("rejects an empty product batch", () => {
  assert.equal(productIngestionRequestSchema.safeParse({ products: [] }).success, false);
});

test("rejects a batch with more than 100 products", () => {
  const products = Array.from({ length: 101 }, (_, index) =>
    validProduct({ product_id: `sku-${index}` })
  );

  assert.equal(
    productIngestionRequestSchema.safeParse({ products }).success,
    false
  );
});

test("applies request defaults", () => {
  const result = productIngestionRequestSchema.parse({
    products: [validProduct()],
  });

  assert.equal(result.batch_size, 10);
  assert.equal(result.overwrite_existing, false);
});

test("rejects metadata containing non-JSON values", () => {
  assert.equal(
    productInputSchema.safeParse(
      validProduct({ metadata: { callback: () => "not JSON" } })
    ).success,
    false
  );
  assert.equal(
    productInputSchema.safeParse(validProduct({ metadata: { score: Infinity } }))
      .success,
    false
  );
});
