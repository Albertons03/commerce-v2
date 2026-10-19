import assert from "node:assert/strict";
import fs from "node:fs";
import Module from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(testDirectory, "../../lib/ai/openai-client.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const compiledSource = ts.transpileModule(source, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;

function loadOpenAIClientModule() {
  const loadedModule = new Module(sourcePath);
  loadedModule.filename = sourcePath;
  loadedModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
  const originalRequire = loadedModule.require.bind(loadedModule);

  loadedModule.require = (specifier) => {
    if (specifier === "server-only") {
      return {};
    }
    return originalRequire(specifier);
  };

  loadedModule._compile(compiledSource, sourcePath);
  return loadedModule.exports;
}

function withApiKey(value, run) {
  if (value === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = value;
  }
  return run();
}

test("imports without OPENAI_API_KEY", () => {
  withApiKey(undefined, () => {
    assert.doesNotThrow(loadOpenAIClientModule);
  });
});

test("requires OPENAI_API_KEY when requesting the client", () => {
  withApiKey(undefined, () => {
    const { getOpenAIClient } = loadOpenAIClientModule();

    assert.throws(
      () => getOpenAIClient(),
      /OPENAI_API_KEY is not configured/
    );
  });
});

test("initializes a singleton client with a placeholder test key", () => {
  withApiKey("test-placeholder-key", () => {
    const { getOpenAIClient } = loadOpenAIClientModule();
    const client = getOpenAIClient();

    assert.equal(client.apiKey, "test-placeholder-key");
    assert.equal(getOpenAIClient(), client);
  });
});
