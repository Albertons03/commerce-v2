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

## Next Planned Task

COM-004: Product Ingestion.
