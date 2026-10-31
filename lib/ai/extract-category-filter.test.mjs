
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(
  new URL("./extract-category-filter.ts", import.meta.url),
  "utf8",
);

const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

const testModule = { exports: {} };

new Function("module", "exports", compiled)(
  testModule,
  testModule.exports,
);

const { extractCategoryFilter } = testModule.exports;


test("recognizes Hungarian laptop queries", () => {
  assert.equal(
    extractCategoryFilter("Milyen laptopokat ajánlasz?"),
    "Laptops",
  );
});

test("recognizes smartphone queries", () => {
  assert.equal(
    extractCategoryFilter("Mutass iPhone telefonokat"),
    "Smartphones",
  );
});

test("recognizes tablet queries", () => {
  assert.equal(
    extractCategoryFilter("Van iPad készleten?"),
    "Tablets",
  );
});

test("recognizes headphone queries", () => {
  assert.equal(
    extractCategoryFilter("Bluetooth fejhallgatót keresek"),
    "Headphones",
  );
});

test("recognizes smartwatch queries", () => {
  assert.equal(
    extractCategoryFilter("Milyen okosórákat ajánlasz?"),
    "Smartwatches",
  );
});

test("recognizes accessories", () => {
  assert.equal(
    extractCategoryFilter("Billentyűzetet keresek"),
    "Accessories",
  );
});

test("returns null for general catalog queries", () => {
  assert.equal(
    extractCategoryFilter("Milyen termékeitek vannak?"),
    null,
  );
});

test("recognizes category with price constraint", () => {
  assert.equal(
    extractCategoryFilter(
      "Milyen laptopokat ajánlasz programozáshoz 1000 dollár alatt?",
    ),
    "Laptops",
  );
});
