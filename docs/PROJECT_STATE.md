# Project State

## Bootstrap

This project was bootstrapped as COM-002B with a clean Next.js App Router
foundation. The scaffold uses TypeScript, Tailwind CSS, ESLint, and the
`@/*` import alias.

## Target MVP Scope

The MVP is a controlled migration of the AI Commerce Lead Generator into this
new application. Existing functionality will be migrated deliberately rather
than copied wholesale.

## Supabase

The existing Supabase project will be reused. No database changes have been
made.

## AI Core Migration

- COM-003A: AI Core Migration completed. Migrated `openai-client.ts`,
  `embedding-service.ts`, `chat-service.ts`, and `prompt-builder.ts`.
- COM-003B: Lazy OpenAI client initialization completed. The OpenAI client is
  protected by a `server-only` boundary, and credentials are validated only
  when the client is requested.
- The `ProductMatch` type dependency was isolated in the prompt builder; the
  RAG service and Supabase code were not migrated.
- Created `docs/architecture/AI_CORE.md`.
- All 3 focused AI Core tests passed. ESLint, TypeScript, and production build
  passed.
- No real OpenAI calls or Supabase operations were performed.
- `npm audit` reported 5 unresolved high-severity findings.

## Product Ingestion Foundation

- COM-005B/2: Authentication and organization authorization foundation,
  commit `147fd9d`.
- COM-005B/3: Validation-only product ingestion API implemented. The route
  authenticates the cookie-based user, resolves the demo organization
  server-side, authorizes `owner`/`admin`, and then validates the request. It
  does not generate embeddings or write to the database.
- API route tests: 11 passed. Organization authorization tests: 7 passed.
  Product validation tests: 8 passed. AI Core tests: 3 passed. ESLint,
  TypeScript, and production build passed.

## Product Embedding Persistence Contract

- COM-005C/1: Pure `ProductInput` and embedding-to-row mapper implemented at
  base commit `3fb6b86`.
- COM-005C/2B: Server-only persistence writer implemented using the
  authenticated user-scoped Supabase SSR client. Persistence tests cover
  ignore-conflict insert, overwrite upsert, validation, sanitized failures,
  database defaults, and client boundary (10 passed). Existing mapper,
  ingestion API, authorization, validation, and AI Core tests: 37 passed.
  ESLint, TypeScript, production build, and `git diff --check` passed. No live
  Supabase or OpenAI calls and no database writes were made.
- The manually verified live contract is documented in
  `docs/architecture/PRODUCT_INGESTION.md`. No live user-session integration
  test has been performed.
- COM-005C/3B: Embedding generation restricted to
  `text-embedding-3-small`; generated vectors are enforced to contain exactly
  1536 finite dimensions. Resolved model identifiers are included in batch and
  product-single results, while `generateEmbedding(): Promise<number[]>`
  remains unchanged. Added offline embedding-service tests and the
  `npm run test:embedding-service` script. Verification: 54/54 automated tests
  passed; ESLint, TypeScript, Next.js production build, and `git diff --check`
  passed (with non-blocking LF/CRLF warnings). No live OpenAI or Supabase
  requests were made. The ingestion API route is not yet integrated.

## Next Planned Task

COM-005C/3C — Ingestion Route Integration.
