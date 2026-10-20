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

- COM-005B/3: Authorized validation-only ingestion API, base commit
  `552b305`.
- COM-005C/1: Pure `ProductInput` and embedding-to-row mapper implemented.
  Mapper tests: 8 passed. Existing product-ingestion, authorization, API-route,
  and AI Core tests: 29 passed. ESLint, TypeScript, production build, and
  `git diff --check` passed. No Supabase or OpenAI calls and no database writes.
- Updated ingestion architecture documentation. The database contract,
  including `VECTOR(1536)`, remains unverified against the live database.

## Next Planned Task

COM-005C/2.
