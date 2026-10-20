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
  "../../lib/supabase/organization-authorization.ts"
);
const source = fs.readFileSync(sourcePath, "utf8");
const compiledSource = ts.transpileModule(source, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;

function loadAuthorizationHelper(supabase) {
  const loadedModule = new Module(sourcePath);
  loadedModule.filename = sourcePath;
  loadedModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
  const originalRequire = loadedModule.require.bind(loadedModule);

  loadedModule.require = (specifier) => {
    if (specifier === "server-only") {
      return {};
    }
    if (specifier === "./server") {
      return {
        createUserSupabaseClient: async () => supabase,
      };
    }
    return originalRequire(specifier);
  };

  loadedModule._compile(compiledSource, sourcePath);
  return loadedModule.exports;
}

function mockSupabase(result) {
  const query = {
    table: undefined,
    columns: undefined,
    filters: [],
    from(table) {
      this.table = table;
      return this;
    },
    select(columns) {
      this.columns = columns;
      return this;
    },
    eq(column, value) {
      this.filters.push([column, value]);
      return this;
    },
    maybeSingle() {
      return Promise.resolve(result);
    },
  };

  return query;
}

const userId = "user-123";
const organizationId = "org-456";

async function authorizeWith(result) {
  const supabase = mockSupabase(result);
  const { authorizeOrganizationIngestion } = loadAuthorizationHelper(supabase);
  const authorization = await authorizeOrganizationIngestion(
    userId,
    organizationId
  );

  assert.equal(supabase.table, "organization_members");
  assert.equal(supabase.columns, "role");
  assert.deepEqual(supabase.filters, [
    ["user_id", userId],
    ["organization_id", organizationId],
  ]);

  return authorization;
}

test("allows an owner", async () => {
  assert.deepEqual(await authorizeWith({ data: { role: "owner" }, error: null }), {
    authorized: true,
    role: "owner",
  });
});

test("allows an admin", async () => {
  assert.deepEqual(await authorizeWith({ data: { role: "admin" }, error: null }), {
    authorized: true,
    role: "admin",
  });
});

test("denies a member for insufficient role", async () => {
  assert.deepEqual(
    await authorizeWith({ data: { role: "member" }, error: null }),
    {
      authorized: false,
      reason: "insufficient_role",
      role: "member",
    }
  );
});

test("denies a user with no membership", async () => {
  assert.deepEqual(await authorizeWith({ data: null, error: null }), {
    authorized: false,
    reason: "not_member",
  });
});

test("denies a query error and preserves the error", async () => {
  const error = new Error("query failed");

  assert.deepEqual(await authorizeWith({ data: null, error }), {
    authorized: false,
    reason: "database_error",
    error,
  });
});

test("denies when the membership query throws", async () => {
  const error = new Error("query threw");
  const supabase = mockSupabase({ data: null, error: null });
  supabase.maybeSingle = () => {
    throw error;
  };
  const { authorizeOrganizationIngestion } = loadAuthorizationHelper(supabase);

  assert.deepEqual(
    await authorizeOrganizationIngestion(userId, organizationId),
    {
      authorized: false,
      reason: "database_error",
      error,
    }
  );
});

test("denies an unexpected membership role", async () => {
  assert.deepEqual(
    await authorizeWith({ data: { role: "superadmin" }, error: null }),
    {
      authorized: false,
      reason: "unexpected_role",
      role: "superadmin",
    }
  );
});
