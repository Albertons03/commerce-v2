import assert from "node:assert/strict";
import fs from "node:fs";
import Module from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const routePath = path.resolve(
  testDirectory,
  "../../app/api/products/ingest/route.ts"
);
const schemaPath = path.resolve(
  testDirectory,
  "../../lib/validations/product-ingestion.ts"
);
const mapperPath = path.resolve(
  testDirectory,
  "../../lib/products/product-embedding-mapper.ts"
);
const validProduct = {
  product_id: "sku-1",
  product_name: "Demo product",
  product_description: "A sufficiently long product description.",
};
const demoOrganizationId = "00000000-0000-4000-8000-000000000001";
const resolvedModel = "text-embedding-3-small";
const vector = () => Array.from({ length: 1536 }, () => 0.1);

function transpileModule(sourcePath) {
  const source = fs.readFileSync(sourcePath, "utf8");
  return ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
}

function loadModule(sourcePath, mocks = {}) {
  const loadedModule = new Module(sourcePath);
  loadedModule.filename = sourcePath;
  loadedModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
  const originalRequire = loadedModule.require.bind(loadedModule);

  loadedModule.require = (specifier) => {
    if (Object.hasOwn(mocks, specifier)) {
      return mocks[specifier];
    }
    return originalRequire(specifier);
  };

  loadedModule._compile(transpileModule(sourcePath), sourcePath);
  return loadedModule.exports;
}

async function withDemoOrganizationId(value, run) {
  const previous = process.env.COMMERCE_DEMO_ORGANIZATION_ID;
  if (value === undefined) {
    delete process.env.COMMERCE_DEMO_ORGANIZATION_ID;
  } else {
    process.env.COMMERCE_DEMO_ORGANIZATION_ID = value;
  }

  try {
    return await run();
  } finally {
    if (previous === undefined) {
      delete process.env.COMMERCE_DEMO_ORGANIZATION_ID;
    } else {
      process.env.COMMERCE_DEMO_ORGANIZATION_ID = previous;
    }
  }
}

function setup({
  user = { id: "authenticated-user" },
  authError = null,
  authorization = { authorized: true, role: "owner" },
  embed,
  persist,
  mapper,
} = {}) {
  const calls = [];
  const supabase = {
    auth: {
      async getUser() {
        calls.push(["getUser"]);
        return { data: { user }, error: authError };
      },
    },
  };
  const realMapper = loadModule(mapperPath);
  const defaultEmbed = async (products, options) => {
    calls.push(["generateEmbeddings", products, options]);
    return {
      results: products.map((product) => ({
        product_id: product.product_id,
        embedding: vector(),
        text: "text",
        tokenUsage: 1,
        model: resolvedModel,
      })),
      model: resolvedModel,
    };
  };
  const defaultPersist = async (...args) => {
    calls.push(["persistProductEmbeddings", ...args]);
    return {
      status: "success",
      attemptedCount: args[1].length,
      successfulCount: args[1].length,
      operation: args[2] ? "upsert" : "insert",
    };
  };
  const dependencies = {
    "@/lib/ai/embedding-service": {
      generateEmbeddings: async (...args) => {
        if (embed) {
          calls.push(["generateEmbeddings", ...args]);
          return embed(...args);
        }
        return defaultEmbed(...args);
      },
    },
    "@/lib/products/product-embedding-mapper": {
      mapProductToEmbeddingRow: (...args) => {
        calls.push(["mapProductToEmbeddingRow", ...args]);
        return (mapper ?? realMapper.mapProductToEmbeddingRow)(...args);
      },
    },
    "@/lib/products/product-persistence": {
      persistProductEmbeddings: async (...args) => {
        if (persist) {
          calls.push(["persistProductEmbeddings", ...args]);
          return persist(...args);
        }
        return defaultPersist(...args);
      },
    },
    "@/lib/supabase/server": {
      createUserSupabaseClient: async () => {
        calls.push(["createUserSupabaseClient"]);
        return supabase;
      },
    },
    "@/lib/supabase/organization-authorization": {
      authorizeOrganizationIngestion: async (...args) => {
        calls.push(["authorizeOrganizationIngestion", ...args]);
        return authorization;
      },
    },
    "@/lib/validations/product-ingestion": loadModule(schemaPath),
    "next/server": {
      NextResponse: {
        json: (body, options) => Response.json(body, options),
      },
    },
  };
  const { POST } = loadModule(routePath, dependencies);

  return { POST, calls };
}

function makeRequest(body, { jsonError = false } = {}) {
  let jsonCalls = 0;
  return {
    get jsonCalls() {
      return jsonCalls;
    },
    async json() {
      jsonCalls += 1;
      if (jsonError) {
        throw new SyntaxError("invalid JSON");
      }
      return body;
    },
  };
}

async function post(options = {}, body = { products: [validProduct] }) {
  const { POST, calls } = setup(options);
  const request = makeRequest(body, options.requestOptions);
  const response = await POST(request);
  return { response, payload: await response.json(), request, calls };
}

test("returns 401 for an unauthenticated request before reading its body", async () => {
  await withDemoOrganizationId(demoOrganizationId, async () => {
    const result = await post({ user: null });

    assert.equal(result.response.status, 401);
    assert.equal(result.request.jsonCalls, 0);
    assert.equal(
      result.calls.some(([name]) => name === "authorizeOrganizationIngestion"),
      false
    );
  });
});

test("returns 503 when the demo organization is not configured", async () => {
  await withDemoOrganizationId(undefined, async () => {
    const result = await post();

    assert.equal(result.response.status, 503);
    assert.equal(result.payload.error.code, "configuration_error");
    assert.equal(result.request.jsonCalls, 0);
    assert.equal(
      result.calls.some(([name]) => name === "authorizeOrganizationIngestion"),
      false
    );
  });
});

test("returns 503 when the demo organization ID is invalid", async () => {
  await withDemoOrganizationId("not-a-uuid", async () => {
    const result = await post();

    assert.equal(result.response.status, 503);
    assert.equal(result.payload.error.code, "configuration_error");
    assert.equal(result.request.jsonCalls, 0);
  });
});

test("returns 403 for a member before reading its body", async () => {
  await withDemoOrganizationId(demoOrganizationId, async () => {
    const result = await post({
      authorization: {
        authorized: false,
        reason: "insufficient_role",
        role: "member",
      },
    });

    assert.equal(result.response.status, 403);
    assert.equal(result.request.jsonCalls, 0);
  });
});

test("returns 403 when the user has no organization membership", async () => {
  await withDemoOrganizationId(demoOrganizationId, async () => {
    const result = await post({
      authorization: { authorized: false, reason: "not_member" },
    });

    assert.equal(result.response.status, 403);
    assert.equal(result.request.jsonCalls, 0);
  });
});

test("returns sanitized 503 for an authorization database error", async () => {
  await withDemoOrganizationId(demoOrganizationId, async () => {
    const result = await post({
      authorization: {
        authorized: false,
        reason: "database_error",
        error: new Error("private database detail"),
      },
    });

    assert.equal(result.response.status, 503);
    assert.equal(result.payload.error.code, "authorization_unavailable");
    assert.equal(JSON.stringify(result.payload).includes("private database detail"), false);
    assert.equal(result.request.jsonCalls, 0);
  });
});

test("returns 400 for invalid JSON after authorization", async () => {
  await withDemoOrganizationId(demoOrganizationId, async () => {
    const { POST, calls } = setup();
    const request = makeRequest(undefined, { jsonError: true });
    const response = await POST(request);
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.error.code, "invalid_json");
    assert.equal(request.jsonCalls, 1);
    assert.deepEqual(calls.at(-1), [
      "authorizeOrganizationIngestion",
      "authenticated-user",
      demoOrganizationId,
    ]);
  });
});

test("returns 400 for an invalid product payload after authorization", async () => {
  await withDemoOrganizationId(demoOrganizationId, async () => {
    const result = await post({}, { products: [] });

    assert.equal(result.response.status, 400);
    assert.equal(result.payload.error.code, "validation_error");
    assert.equal(result.request.jsonCalls, 1);
    assert.equal(result.calls.at(-1)[0], "authorizeOrganizationIngestion");
  });
});

for (const role of ["owner", "admin"]) {
  test(`returns 200 for an authorized ${role}`, async () => {
    await withDemoOrganizationId(demoOrganizationId, async () => {
      const result = await post({
        authorization: { authorized: true, role },
      });

      assert.equal(result.response.status, 200);
      assert.deepEqual(result.payload, {
        status: "persisted",
        persisted: true,
        attempted_count: 1,
        successful_count: 1,
      });
      assert.equal(JSON.stringify(result.payload).includes("Demo product"), false);
    });
  });
}

const names = (calls) => calls.map(([name]) => name);
const find = (calls, name) => calls.find(([n]) => n === name);
const SECRET = "sk-secret SELECT * FROM products";

test("pre-embedding failures never reach embedding or persistence", async () => {
  const cases = [
    [{ user: null }, undefined],
    [{ authorization: { authorized: false, reason: "not_member" } }, undefined],
    [{}, { products: [] }],
  ];
  for (const [options, body] of cases) {
    await withDemoOrganizationId(demoOrganizationId, async () => {
      const result = await post(options, body ?? { products: [validProduct] });
      assert.equal(result.calls.some(([n]) => n === "generateEmbeddings"), false);
      assert.equal(result.calls.some(([n]) => n === "persistProductEmbeddings"), false);
    });
  }
});

test("rejects duplicate product IDs before any embedding call", async () => {
  await withDemoOrganizationId(demoOrganizationId, async () => {
    const result = await post(
      {},
      { products: [validProduct, { ...validProduct, product_name: "Other" }] }
    );

    assert.equal(result.response.status, 400);
    assert.equal(result.payload.error.code, "validation_error");
    assert.deepEqual(result.payload.error.details, [
      { path: "products.1.product_id", message: "Duplicate product_id in request" },
    ]);
    assert.equal(names(result.calls).includes("generateEmbeddings"), false);
    assert.equal(names(result.calls).includes("persistProductEmbeddings"), false);
  });
});

test("forwards batch_size, overwrite_existing, model and authorized org", async () => {
  await withDemoOrganizationId(demoOrganizationId, async () => {
    const second = { ...validProduct, product_id: "sku-2" };
    const result = await post(
      {},
      {
        organization_id: "00000000-0000-4000-8000-000000000002",
        products: [validProduct, second],
        batch_size: 5,
        overwrite_existing: true,
      }
    );

    assert.equal(result.response.status, 200);
    assert.equal(find(result.calls, "generateEmbeddings")[2].batchSize, 5);
    const mapCalls = result.calls.filter(([n]) => n === "mapProductToEmbeddingRow");
    assert.equal(mapCalls.length, 2);
    for (const call of mapCalls) {
      assert.equal(call[1], demoOrganizationId);
      assert.equal(call[4], resolvedModel);
      assert.equal(call[5], undefined);
    }
    assert.deepEqual(mapCalls.map((c) => c[2].product_id), ["sku-1", "sku-2"]);

    const persistCalls = result.calls.filter(([n]) => n === "persistProductEmbeddings");
    assert.equal(persistCalls.length, 1);
    const [, org, rows, overwrite] = persistCalls[0];
    assert.equal(org, demoOrganizationId);
    assert.equal(overwrite, true);
    assert.deepEqual(rows.map((r) => r.product_id), ["sku-1", "sku-2"]);
    assert.equal(rows.every((r) => r.organization_id === demoOrganizationId), true);
    assert.equal(rows.every((r) => r.embedding_model === resolvedModel), true);
    assert.equal(result.payload.successful_count, 2);
  });
});

test("defaults to batch_size 10 and overwrite_existing false", async () => {
  await withDemoOrganizationId(demoOrganizationId, async () => {
    const result = await post();
    assert.equal(find(result.calls, "generateEmbeddings")[2].batchSize, 10);
    assert.equal(find(result.calls, "persistProductEmbeddings")[3], false);
  });
});

test("missing or mismatched embedding results never reach persistence", async () => {
  const bad = [
    async () => ({ results: [], model: resolvedModel }),
    async (products) => ({
      results: products.map(() => ({
        product_id: "other",
        embedding: vector(),
        model: resolvedModel,
      })),
    }),
  ];
  for (const embed of bad) {
    await withDemoOrganizationId(demoOrganizationId, async () => {
      const result = await post({ embed });
      assert.equal(result.response.status, 500);
      assert.equal(result.payload.error.code, "internal_error");
      assert.equal(names(result.calls).includes("mapProductToEmbeddingRow"), false);
      assert.equal(names(result.calls).includes("persistProductEmbeddings"), false);
    });
  }
});

test("embedding failure returns sanitized 503", async () => {
  await withDemoOrganizationId(demoOrganizationId, async () => {
    const result = await post({
      embed: async () => {
        throw new Error(SECRET);
      },
    });
    assert.equal(result.response.status, 503);
    assert.equal(result.payload.error.code, "embedding_unavailable");
    assert.equal(JSON.stringify(result.payload).includes("secret"), false);
    assert.equal(names(result.calls).includes("persistProductEmbeddings"), false);
  });
});

test("persistence database failure returns sanitized 503", async () => {
  await withDemoOrganizationId(demoOrganizationId, async () => {
    const result = await post({
      persist: async () => ({
        status: "error",
        attemptedCount: 1,
        error: "database_error",
      }),
    });
    assert.equal(result.response.status, 503);
    assert.equal(result.payload.error.code, "persistence_unavailable");
    assert.equal(JSON.stringify(result.payload).includes("secret"), false);
  });
});

test("mapper contract failure returns sanitized 500 without persistence", async () => {
  await withDemoOrganizationId(demoOrganizationId, async () => {
    const result = await post({
      mapper: () => {
        throw new TypeError(SECRET);
      },
    });
    assert.equal(result.response.status, 500);
    assert.equal(JSON.stringify(result.payload).includes("secret"), false);
    assert.equal(names(result.calls).includes("persistProductEmbeddings"), false);
  });
});

test("writer contract failures return sanitized 500", async () => {
  const writers = [
    async () => {
      throw new Error(SECRET);
    },
    async () => ({
      status: "error",
      attemptedCount: 1,
      error: "duplicate_product_ids",
    }),
  ];
  for (const persist of writers) {
    await withDemoOrganizationId(demoOrganizationId, async () => {
      const result = await post({ persist });
      assert.equal(result.response.status, 500);
      assert.equal(result.payload.error.code, "internal_error");
      assert.equal(JSON.stringify(result.payload).includes("secret"), false);
    });
  }
});

test("reports success with zero affected rows", async () => {
  await withDemoOrganizationId(demoOrganizationId, async () => {
    const result = await post({
      persist: async () => ({
        status: "success",
        attemptedCount: 1,
        successfulCount: 0,
        operation: "insert",
      }),
    });
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.payload, {
      status: "persisted",
      persisted: true,
      attempted_count: 1,
      successful_count: 0,
    });
  });
});

test("omits successful_count when the writer does not provide it", async () => {
  await withDemoOrganizationId(demoOrganizationId, async () => {
    const result = await post({
      persist: async () => ({
        status: "success",
        attemptedCount: 1,
        operation: "upsert",
      }),
    });
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.payload, {
      status: "persisted",
      persisted: true,
      attempted_count: 1,
    });
  });
});

test("does not respond before persistence resolves", async () => {
  await withDemoOrganizationId(demoOrganizationId, async () => {
    let release;
    let started;
    const startedPromise = new Promise((resolve) => (started = resolve));
    const { POST } = setup({
      persist: (...args) => {
        started();
        return new Promise((resolve) => {
          release = () =>
            resolve({ status: "success", attemptedCount: args[1].length });
        });
      },
    });
    let settled = false;
    const pending = POST(makeRequest({ products: [validProduct] })).then((r) => {
      settled = true;
      return r;
    });

    await startedPromise;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false);
    release();
    const response = await pending;
    assert.equal(response.status, 200);
  });
});

test("ignores spoofed user and organization IDs in the body", async () => {
  await withDemoOrganizationId(demoOrganizationId, async () => {
    const body = {
      userId: "attacker-user",
      organization_id: "00000000-0000-4000-8000-000000000002",
      products: [validProduct],
    };
    const result = await post({}, body);
    const authorizationCall = result.calls.find(
      ([name]) => name === "authorizeOrganizationIngestion"
    );

    assert.equal(result.response.status, 200);
    assert.deepEqual(authorizationCall, [
      "authorizeOrganizationIngestion",
      "authenticated-user",
      demoOrganizationId,
    ]);
  });
});
