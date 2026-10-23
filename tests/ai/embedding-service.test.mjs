import assert from "node:assert/strict";
import fs from "node:fs";
import Module from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const servicePath = path.resolve(
  testDirectory,
  "../../lib/ai/embedding-service.ts"
);
const mapperPath = path.resolve(
  testDirectory,
  "../../lib/products/product-embedding-mapper.ts"
);
const supportedModel = "text-embedding-3-small";
const organizationId = "00000000-0000-4000-8000-000000000001";
const products = [
  {
    product_id: "sku-001",
    product_name: "First product",
    product_description: "A sufficiently long first product description.",
  },
  {
    product_id: "sku-002",
    product_name: "Second product",
    product_description: "A sufficiently long second product description.",
  },
];

function compileModule(sourcePath, mocks = {}) {
  const source = fs.readFileSync(sourcePath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const loadedModule = new Module(sourcePath);
  loadedModule.filename = sourcePath;
  loadedModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
  const originalRequire = loadedModule.require.bind(loadedModule);

  loadedModule.require = (specifier) =>
    Object.hasOwn(mocks, specifier) ? mocks[specifier] : originalRequire(specifier);
  loadedModule._compile(compiled, sourcePath);
  return loadedModule.exports;
}

function withConfiguredModel(configuredModel, load) {
  const previousModel = process.env.OPENAI_EMBEDDING_MODEL;
  if (configuredModel === undefined) {
    delete process.env.OPENAI_EMBEDDING_MODEL;
  } else {
    process.env.OPENAI_EMBEDDING_MODEL = configuredModel;
  }

  try {
    return load();
  } finally {
    if (previousModel === undefined) {
      delete process.env.OPENAI_EMBEDDING_MODEL;
    } else {
      process.env.OPENAI_EMBEDDING_MODEL = previousModel;
    }
  }
}

function loadEmbeddingService(configuredModel, { responseDimensions = 1536 } = {}) {
  const requests = [];
  let clientCreations = 0;
  const client = {
    embeddings: {
      async create(request) {
        requests.push(request);
        const inputCount = Array.isArray(request.input) ? request.input.length : 1;
        return {
          data: Array.from({ length: inputCount }, (_, index) => ({
            embedding: Array.from(
              { length: responseDimensions },
              () => index + 0.25
            ),
          })),
          usage: { prompt_tokens: 20, total_tokens: 20 },
        };
      },
    },
  };

  const service = withConfiguredModel(configuredModel, () =>
    compileModule(servicePath, {
      "./openai-client": {
        getOpenAIClient() {
          clientCreations += 1;
          return client;
        },
        withRetry: (operation) => operation(),
        extractTokenUsage: (response) => ({
          promptTokens: response.usage.prompt_tokens,
          totalTokens: response.usage.total_tokens,
        }),
        estimateCost: () => 0.001,
      },
    })
  );

  return { service, requests, getClientCreations: () => clientCreations };
}

function loadMapper() {
  return compileModule(mapperPath);
}

test("resolves the fallback, configured default and explicit supported model", () => {
  const fallbackService = loadEmbeddingService(undefined);
  const { service } = loadEmbeddingService(supportedModel);

  assert.equal(fallbackService.service.resolveEmbeddingModel(), supportedModel);
  assert.equal(service.resolveEmbeddingModel(), supportedModel);
  assert.equal(service.resolveEmbeddingModel(supportedModel), supportedModel);
});

test("rejects an unsupported configured model before creating an OpenAI client", async () => {
  const { service, requests, getClientCreations } = loadEmbeddingService(
    "text-embedding-3-large"
  );

  await assert.rejects(
    service.generateEmbeddings(products),
    /must be text-embedding-3-small/
  );
  assert.equal(getClientCreations(), 0);
  assert.equal(requests.length, 0);
});

test("rejects unsupported explicit models before all generation calls", async () => {
  const { service, requests, getClientCreations } =
    loadEmbeddingService(supportedModel);

  await assert.rejects(
    service.generateEmbeddings(products, { model: "text-embedding-3-large" }),
    /must be text-embedding-3-small/
  );
  await assert.rejects(
    service.generateEmbedding("product text", undefined, "text-embedding-3-large"),
    /must be text-embedding-3-small/
  );
  await assert.rejects(
    service.generateSingleEmbedding(products[0], "text-embedding-3-large"),
    /must be text-embedding-3-small/
  );

  assert.equal(getClientCreations(), 0);
  assert.equal(requests.length, 0);
});

test("returns the exact requested model with 1536-dimensional embeddings", async () => {
  const { service, requests } = loadEmbeddingService(supportedModel);
  const batch = await service.generateEmbeddings(products, { batchSize: 2 });
  const { mapProductToEmbeddingRow } = loadMapper();

  assert.equal(batch.model, supportedModel);
  assert.deepEqual(
    batch.results.map((result) => result.model),
    [supportedModel, supportedModel]
  );
  assert.equal(requests.length, 1);
  assert.equal(requests[0].model, batch.model);
  assert.deepEqual(
    batch.results.map((result) => result.product_id),
    products.map((product) => product.product_id)
  );

  const rows = batch.results.map((result, index) =>
    mapProductToEmbeddingRow(
      organizationId,
      products[index],
      result.embedding,
      result.model
    )
  );
  assert.deepEqual(
    rows.map((row) => row.embedding_model),
    [batch.model, batch.model]
  );
  assert.ok(rows.every((row) => row.embedding.length === 1536));
});

test("generateEmbedding returns a valid 1536-dimensional vector", async () => {
  const { service, requests } = loadEmbeddingService(supportedModel);

  const embedding = await service.generateEmbedding(
    "A sample product description",
    undefined,
    supportedModel
  );

  assert.equal(requests.length, 1);
  assert.equal(requests[0].model, supportedModel);
  assert.equal(requests[0].input, "a sample product description");
  assert.equal(embedding.length, 1536);
  assert.ok(embedding.every(Number.isFinite));
});

test("generateSingleEmbedding returns the resolved model and valid vector", async () => {
  const { service, requests } = loadEmbeddingService(supportedModel);

  const result = await service.generateSingleEmbedding(products[0]);

  assert.equal(requests.length, 1);
  assert.equal(requests[0].model, supportedModel);
  assert.equal(result.model, supportedModel);
  assert.equal(result.product_id, products[0].product_id);
  assert.equal(result.embedding.length, 1536);
  assert.ok(result.embedding.every(Number.isFinite));
});

test("rejects a returned vector that violates the 1536-dimension contract", async () => {
  const { service } = loadEmbeddingService(supportedModel, {
    responseDimensions: 1535,
  });

  await assert.rejects(
    service.generateEmbeddings(products),
    /exactly 1536 finite numbers/
  );
});
