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

## Ingestion API Integration and Live MVP Progress (October 2026)

- COM-005C/3C is no longer the next planned task. The ingestion API has since
  been integrated with authentication, organization authorization, request
  validation, OpenAI embedding generation, embedding-row mapping, and
  Supabase persistence. The current endpoint is `POST /api/products/ingest`.
- The server-side writer uses conflict key `organization_id,product_id`.
  `overwrite_existing: false` skips conflicting products; overwrite mode
  uses upsert semantics. Successful responses include `attempted_count` and,
  when verified, `successful_count`. With overwrite disabled, a verified
  `skipped_count` is also returned.
- A product catalog is visible in the app. During the October 24 CSV retest,
  the screenshot showed 39 products; this is an observed UI count, not a
  separately audited database count.
- A Next.js 16 server-component cookie-write issue was addressed in
  `lib/supabase/server.ts` with a targeted catch for the prohibited cookie
  modification case. Supabase SSR proxy/session-refresh architecture still
  merits a focused later review; do not conflate this with a failed CSV test.

## COM-009 — CSV Bulk Product Upload (Completed)

- Commit `9498ba3` (`feat: add CSV bulk product ingestion`).
- Main files: `app/csv-product-upload.tsx`, `app/page.tsx`,
  `lib/products/parse-product-csv.ts`, `lib/supabase/server.ts`, and
  `tests/products/parse-product-csv.test.mjs`.
- CSV upload validates a maximum of 50 products, required columns
  `product_id`, `product_name`, `product_description`, and supported optional
  columns `category`, `price`, `currency`, `product_url`,
  `product_image_url`. Parser handles CSV quoting, duplicate IDs, and
  row-level validation. UI previews rows and sends valid products in
  batches of 10 to `POST /api/products/ingest`.
- The original three-product CSV import succeeded end to end: 3 confirmed,
  0 failed; products appeared in the catalog. The CSV parser's 11 focused
  tests passed, as did TypeScript, ESLint, and production build.

## COM-009C — Duplicate Import Handling (Completed October 24, 2026)

- Commit `60f6e4b` (`fix: distinguish inserted and skipped CSV products`),
  on branch `master`.
- Modified `app/api/products/ingest/route.ts` and
  `app/csv-product-upload.tsx`.
- API now reports verified `skipped_count = attempted_count - successful_count`
  for non-overwrite imports. The UI validates both counts and ensures their
  sum matches the batch size; it displays `Inserted`, `Skipped (already
  existing)`, and `Failed / Unconfirmed` separately.
- Unconfirmed is intentionally not treated as proof of a failed database
  write (for example, a network error can obscure the result).
- Live repeat import of the same three-product `test-products.csv`:
  **Inserted 0; Skipped 3; Failed / Unconfirmed 0**. The UI reported
  `Batch 1: 3 existing products skipped.`
- Verification after changes: `npx tsc --noEmit`, `npm run lint`,
  `npm run build`, `git diff --check`, and `git diff --cached --check`
  all passed. The commit succeeded.
- Immediately after commit, `git status --short` showed only two untracked
  local files: `lib/products/parse-product-csv.test.mjs` (duplicate test
  file) and `test-products.csv` (local fixture). Neither was committed.

## Known Follow-ups and Boundaries

- Prior historical test counts and the earlier `npm audit` finding above
  describe the stage at which they were recorded; do not present them as
  newly rerun or currently resolved.
- Before a new task, inspect current Git status and existing docs. Do not
  add or delete the two untracked local files without an explicit decision.
- A later small UI ticket may improve dashboard and Product Catalog layout
  width/responsiveness. Do not combine cosmetic redesign with ingestion
  correctness fixes.
- Focused future security work: verify Supabase SSR session refresh/proxy
  behavior and re-check dependency audit when relevant.

## Next Planned Task

1. Commit this updated `docs/PROJECT_STATE.md` as a documentation-only change
   after reviewing its diff (not yet committed by the assistant).
2. Select the next small MVP ticket after inspecting the current app and
   architecture. Candidate: review the post-ingestion product search/RAG
   user flow, or a narrowly scoped responsive dashboard layout improvement.
   No ticket has been formally selected yet.



---

## Current release snapshot — 2026-10-31 (COM-014)

> This section supersedes historical "next task" and "not yet integrated" statements above. Earlier entries remain as a development log, not as a description of current functionality.

**Status:** Local portfolio MVP works; production deployment and public access have **not** been verified.

- Next.js **16.4.2** App Router, TypeScript, Supabase SSR Auth, Postgres/pgvector and OpenAI.
- Working `POST /api/products/ingest`, CSV upload and catalog, and authenticated `POST /api/chat` with vector retrieval, prompt construction and AI response.
- Demo catalog: old demo products were intentionally cleared; a replacement CSV imported **32/32** products (0 skipped, 0 unconfirmed). Active categories verified by SQL: Laptops 10, Smartphones 8, Tablets 4, Headphones 3, Smartwatches 3, Accessories 4.
- **COM-011B** `e403649`: deterministic upper-price extraction, price-filtered vector search RPC and general-catalog fallback; similarity threshold set to 0.3 for the chat route.
- **COM-012** `e995396`: deterministic category intent extraction; `performVectorSearch` chooses category-aware RPC, optionally combined with USD/EUR upper-price filtering; Chat API passes extracted category. Manual end-to-end query **“Milyen laptopokat ajánlasz programozáshoz 1000 dollár alatt?”** returned five laptop cards, all priced <= $1,000, with matching AI recommendations.
- **COM-013/1** `3979033`: eight category-extractor unit tests passed; added support for Hungarian inflected `okosórá...` forms. Additional edge-case handling deferred intentionally for portfolio scope.
- **COM-014/1**: `npm run build` passed on Next.js 16.4.2; routes `/`, `/login`, `/chat-test`, `/api/chat`, `/api/products`, `/api/products/ingest` built successfully. `git status --short` showed only the two pre-existing unrelated untracked files.
- **COM-014/2**: `.env.local` key names verified (values not disclosed): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `OPENAI_API_KEY`, `COMMERCE_DEMO_ORGANIZATION_ID`.
- **COM-014/3**: `lib/supabase/server.ts` imports `createServerClient` from `@supabase/ssr`; production session/cookie handling **not yet audited**.

### Search RPCs — live Supabase state (not yet migration-tracked)

- `search_products_by_embedding` — similarity search, organization and active-product filters.
- `search_products_by_embedding_filtered` — adds optional maximum price and currency restriction.
- `search_products_by_embedding_category` — category plus optional price restriction; `SECURITY DEFINER` confirmed true by catalog query. SQL definitions were inspected in Supabase SQL Editor. Full grant/RLS verification and migration-file export are outstanding.
- All three use organization owner/admin membership checks and limit the returned matches to at most 20, according to the SQL definitions reviewed in chat.

### Release priorities

1. Review and commit updated project docs and a root `README.md`; push **only** intended tracked changes to GitHub.
2. Confirm Git remote/repository and ensure `.env.local` and secrets are excluded from version control.
3. Perform focused production Auth/session and environment checks, then deploy to Vercel.
4. Verify login, catalog, CSV import permissions and `/chat-test` against the deployed app before sharing a public demo link.
5. Later: version the Supabase RPC SQL in migrations, add RPC-selection regression tests and revisit dependency audit and SSR refresh behavior.

**Do not stage or delete** `lib/products/parse-product-csv.test.mjs` and `test-products.csv` without explicit authorization. Historic `npm audit` findings above are not claimed resolved.
