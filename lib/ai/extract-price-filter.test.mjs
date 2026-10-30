
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(
  new URL("./extract-price-filter.ts", import.meta.url),
  "utf8",
);

const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

const module = { exports: {} };
new Function("module", "exports", compiled)(
  module,
  module.exports,
);

const { extractPriceFilter } = module.exports;

test("Hungarian upper price limit", () => {
  assert.deepEqual(
    extractPriceFilter("Laptopot keresek 1000 dollár alatt"),
    { max_price: 1000, currency: "USD" },
  );
});

test("Maximum EUR price", () => {
  assert.deepEqual(
    extractPriceFilter("maximum 800 EUR"),
    { max_price: 800, currency: "EUR" },
  );
});

test("English upper price limit", () => {
  assert.deepEqual(
    extractPriceFilter("Laptop under 1200 USD"),
    null,
  );
});

test("No price constraint", () => {
  assert.equal(
    extractPriceFilter("Milyen Samsung telefonokat ajánlasz?"),
    null,
  );
});

test("Price without an upper limit", () => {
  assert.equal(
    extractPriceFilter("Ez a laptop 999 USD"),
    null,
  );
});
