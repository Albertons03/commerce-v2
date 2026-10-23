
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);

const source = readFileSync(
  "lib/products/parse-product-csv.ts",
  "utf8"
);

const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

const parserModule = { exports: {} };

const localRequire = (id) => {
  if (id === "@/lib/validations/product-ingestion") {
    const validationSource = readFileSync(
      "lib/validations/product-ingestion.ts",
      "utf8"
    );

    const validationCompiled = ts.transpileModule(
      validationSource,
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      }
    ).outputText;

    const validationModule = { exports: {} };

    new Function(
      "require",
      "module",
      "exports",
      validationCompiled
    )(
      require,
      validationModule,
      validationModule.exports
    );

    return validationModule.exports;
  }

  return require(id);
};

new Function("require", "module", "exports", compiled)(
  localRequire,
  parserModule,
  parserModule.exports
);

const { parseProductCsv } = parserModule.exports;

const header =
  "product_id,product_name,product_description,category,price,currency";

test("parses valid products", () => {
  const csv = `${header}
SKU-001,Wireless Mouse,Ergonomic wireless mouse,Electronics,29.99,EUR`;

  const result = parseProductCsv(csv);

  assert.equal(result.validProducts.length, 1);
  assert.equal(result.validProducts[0].price, 29.99);
  assert.equal(result.errors.length, 0);
});

test("rejects missing required columns", () => {
  const result = parseProductCsv(
    "product_id,product_name\nSKU-001,Mouse"
  );

  assert.match(
    result.errors.join(" "),
    /product_description/
  );
});

test("rejects invalid product descriptions", () => {
  const csv = `${header}
SKU-001,Mouse,Short,Electronics,29.99,EUR`;

  const result = parseProductCsv(csv);

  assert.equal(result.validProducts.length, 0);
  assert.ok(result.rows[0].errors.length > 0);
});

test("rejects duplicate product IDs", () => {
  const csv = `${header}
SKU-001,Wireless Mouse,Ergonomic wireless mouse,Electronics,29.99,EUR
SKU-001,Keyboard,Mechanical gaming keyboard,Electronics,89.99,EUR`;

  const result = parseProductCsv(csv);

  assert.equal(result.validProducts.length, 1);
  assert.match(
    result.rows[1].errors.join(" "),
    /Duplicate/
  );
});

test("handles quoted commas", () => {
  const csv = `${header}
SKU-001,Wireless Mouse,"Ergonomic, wireless mouse",Electronics,29.99,EUR`;

  const result = parseProductCsv(csv);

  assert.equal(result.validProducts.length, 1);
  assert.equal(
    result.validProducts[0].product_description,
    "Ergonomic, wireless mouse"
  );
});

test("rejects more than 50 products", () => {
  const rows = Array.from(
    { length: 51 },
    (_, i) =>
      `SKU-${i},Product ${i},Valid product description,Electronics,10,EUR`
  );

  const result = parseProductCsv(
    `${header}\n${rows.join("\n")}`
  );

  assert.equal(result.validProducts.length, 0);
  assert.match(result.errors.join(" "), /Maximum 50/);
});

test("rejects negative prices", () => {
  const csv = `${header}
SKU-001,Wireless Mouse,Ergonomic wireless mouse,Electronics,-10,EUR`;

  const result = parseProductCsv(csv);

  assert.equal(result.validProducts.length, 0);
  assert.ok(result.rows[0].errors.length > 0);
});

test("rejects malformed CSV quotes", () => {
  assert.throws(
    () =>
      parseProductCsv(
        `${header}\nSKU-001,"Mouse,Description,Electronics,10,EUR`
      ),
    /Unclosed CSV quoted field/
  );
});

test("rejects CSV with headers only", () => {
  const result = parseProductCsv(header);

  assert.equal(result.validProducts.length, 0);
  assert.match(result.errors.join(" "), /no products/);
});

test("rejects non-numeric prices", () => {
  const csv = `${header}
SKU-001,Wireless Mouse,Ergonomic wireless mouse,Electronics,abc,EUR`;

  const result = parseProductCsv(csv);

  assert.equal(result.validProducts.length, 0);
  assert.ok(result.rows[0].errors.length > 0);
});

test("handles escaped quotes", () => {
  const csv = `${header}
SKU-001,Wireless Mouse,"Ergonomic ""premium"" wireless mouse",Electronics,29.99,EUR`;

  const result = parseProductCsv(csv);

  assert.equal(result.validProducts.length, 1);
  assert.equal(
    result.validProducts[0].product_description,
    'Ergonomic "premium" wireless mouse'
  );
});
