import assert from "node:assert/strict";
import fs from "node:fs";
import Module from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const persistencePath = path.resolve(
  testDirectory,
  "../../lib/products/product-persistence.ts"
);
const organizationId = "00000000-0000-4000-8000-000000000001";

function loadPersistence(serverClient) {
  const source = fs.readFileSync(persistencePath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const loadedModule = new Module(persistencePath);
  loadedModule.filename = persistencePath;
  loadedModule.paths = Module._nodeModulePaths(path.dirname(persistencePath));
  const originalRequire = loadedModule.require.bind(loadedModule);

  loadedModule.require = (specifier) => {
    if (specifier === "@/lib/supabase/server") {
      return { createUserSupabaseClient: serverClient };
    }
    if (specifier === "server-only") {
      return {};
    }
    return originalRequire(specifier);
  };

  loadedModule._compile(compiled, persistencePath);
  return loadedModule.exports;
}

function makeRow(productId = "sku-001", overrides = {}) {
  return {
    organization_id: organizationId,
    product_id: productId,
    product_name: "Demo product",
    product_description: "A sufficiently long product description.",
    product_category: null,
    product_price: null,
    product_url: null,
    product_image_url: null,
    embedding: Array.from({ length: 1536 }, () => 0.1),
    embedding_model: "text-embedding-3-small",
    embedding_tokens: null,
    ...overrides,
  };
}

function makeSupabase({ data = [{ product_id: "sku-001" }], error = null } = {}) {
  const calls = [];
  const supabase = {
    from(table) {
      calls.push(["from", table]);
      return {
        upsert(rows, options) {
          calls.push(["upsert", rows, options]);
          return {
            select(columns) {
              calls.push(["select", columns]);
              return Promise.resolve({ data, error });
            },
          };
        },
      };
    },
  };
  return { calls, supabase };
}

test("uses insert-ignore-conflicts behavior and counts returned inserted rows", async () => {
  const { calls, supabase } = makeSupabase({
    data: [{ product_id: "sku-001" }],
  });
  let clientCreations = 0;
  const { persistProductEmbeddings } = loadPersistence(async () => {
    clientCreations += 1;
    return supabase;
  });

  const result = await persistProductEmbeddings(
    organizationId,
    [makeRow()],
    false
  );

  assert.deepEqual(result, {
    status: "success",
    attemptedCount: 1,
    successfulCount: 1,
    operation: "insert",
  });
  assert.deepEqual(calls[0], ["from", "product_embeddings"]);
  assert.deepEqual(calls[1][2], {
    onConflict: "organization_id,product_id",
    ignoreDuplicates: true,
    defaultToNull: false,
  });
  assert.deepEqual(calls[2], ["select", "product_id"]);
  assert.equal(clientCreations, 1);
});

test("upserts when overwrite is enabled", async () => {
  const { calls, supabase } = makeSupabase({
    data: [{ product_id: "sku-001" }, { product_id: "sku-002" }],
  });
  const { persistProductEmbeddings } = loadPersistence(async () => supabase);

  const result = await persistProductEmbeddings(
    organizationId,
    [makeRow("sku-001"), makeRow("sku-002")],
    true
  );

  assert.deepEqual(result, {
    status: "success",
    attemptedCount: 2,
    successfulCount: 2,
    operation: "upsert",
  });
  assert.deepEqual(calls[1][2], {
    onConflict: "organization_id,product_id",
    ignoreDuplicates: false,
    defaultToNull: false,
  });
});

test("rejects empty batches without creating a Supabase client", async () => {
  let clientCreations = 0;
  const { persistProductEmbeddings } = loadPersistence(async () => {
    clientCreations += 1;
    throw new Error("should not be called");
  });

  assert.deepEqual(
    await persistProductEmbeddings(organizationId, [], false),
    { status: "error", attemptedCount: 0, error: "empty_batch" }
  );
  assert.equal(clientCreations, 0);
});

test("rejects duplicate product IDs before querying Supabase", async () => {
  let clientCreations = 0;
  const { persistProductEmbeddings } = loadPersistence(async () => {
    clientCreations += 1;
    throw new Error("should not be called");
  });

  const result = await persistProductEmbeddings(
    organizationId,
    [makeRow("duplicate"), makeRow("duplicate")],
    false
  );

  assert.deepEqual(result, {
    status: "error",
    attemptedCount: 2,
    error: "duplicate_product_ids",
  });
  assert.equal(clientCreations, 0);
});

test("rejects rows belonging to another organization", async () => {
  let clientCreations = 0;
  const { persistProductEmbeddings } = loadPersistence(async () => {
    clientCreations += 1;
    throw new Error("should not be called");
  });

  const result = await persistProductEmbeddings(
    organizationId,
    [makeRow("sku-001", {
      organization_id: "00000000-0000-4000-8000-000000000002",
    })],
    false
  );

  assert.deepEqual(result, {
    status: "error",
    attemptedCount: 1,
    error: "organization_mismatch",
  });
  assert.equal(clientCreations, 0);
});

test("rejects invalid organization and product identifiers", async () => {
  let clientCreations = 0;
  const { persistProductEmbeddings } = loadPersistence(async () => {
    clientCreations += 1;
    throw new Error("should not be called");
  });

  assert.deepEqual(
    await persistProductEmbeddings("bad-uuid", [makeRow()], false),
    {
      status: "error",
      attemptedCount: 1,
      error: "invalid_organization_id",
    }
  );
  assert.deepEqual(
    await persistProductEmbeddings(
      organizationId,
      [makeRow("")],
      false
    ),
    {
      status: "error",
      attemptedCount: 1,
      error: "invalid_row_identifier",
    }
  );
  assert.equal(clientCreations, 0);
});

test("returns a sanitized error for Supabase query failures", async () => {
  const { supabase } = makeSupabase({
    data: null,
    error: {
      message: "sensitive database detail",
      details: "private",
      code: "42501",
    },
  });
  const { persistProductEmbeddings } = loadPersistence(async () => supabase);

  const result = await persistProductEmbeddings(
    organizationId,
    [makeRow()],
    false
  );

  assert.deepEqual(result, {
    status: "error",
    attemptedCount: 1,
    error: "database_error",
  });
  assert.equal(JSON.stringify(result).includes("sensitive database detail"), false);
  assert.equal(JSON.stringify(result).includes("42501"), false);
});

test("omits currency and metadata to preserve database defaults", async () => {
  const row = makeRow();
  const { calls, supabase } = makeSupabase();
  const { persistProductEmbeddings } = loadPersistence(async () => supabase);

  await persistProductEmbeddings(organizationId, [row], true);

  assert.equal("product_currency" in calls[1][1][0], false);
  assert.equal("metadata" in calls[1][1][0], false);
  assert.equal("is_active" in calls[1][1][0], false);
  assert.deepEqual(calls[1][2], {
    onConflict: "organization_id,product_id",
    ignoreDuplicates: false,
    defaultToNull: false,
  });
});

test("uses only the user-scoped SSR client and never a service-role client", async () => {
  let userClientCalls = 0;
  const { supabase } = makeSupabase();
  const { persistProductEmbeddings } = loadPersistence(async () => {
    userClientCalls += 1;
    return supabase;
  });

  await persistProductEmbeddings(organizationId, [makeRow()], false);

  assert.equal(userClientCalls, 1);
  const moduleSource = fs.readFileSync(persistencePath, "utf8");
  assert.match(moduleSource, /import "server-only"/);
  assert.match(moduleSource, /createUserSupabaseClient/);
  assert.doesNotMatch(moduleSource, /SUPABASE_SERVICE_ROLE_KEY|createClient\(/);
});

test("does not fabricate a successful count if returned rows are unavailable", async () => {
  const { supabase } = makeSupabase({ data: null });
  const { persistProductEmbeddings } = loadPersistence(async () => supabase);

  const result = await persistProductEmbeddings(
    organizationId,
    [makeRow()],
    false
  );

  assert.deepEqual(result, {
    status: "success",
    attemptedCount: 1,
    operation: "insert",
  });
});
