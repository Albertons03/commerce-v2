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
const validProduct = {
  product_id: "sku-1",
  product_name: "Demo product",
  product_description: "A sufficiently long product description.",
};
const demoOrganizationId = "00000000-0000-4000-8000-000000000001";

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
  const dependencies = {
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
        status: "validated",
        product_count: 1,
        persisted: false,
      });
      assert.equal(JSON.stringify(result.payload).includes("Demo product"), false);
    });
  });
}

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
