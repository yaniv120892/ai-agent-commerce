# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Maintenance

When a change alters commands, the composition root, domain boundaries, the retrieval/plan contract, caching behavior, the persistence/retry state machine, or testing layers, update the relevant section of this file in the same change — do not let it drift from the code.

## What this is

AI Commerce Copilot: a local, single-user shopping chat built on Next.js App Router. It turns a chat request into a constrained, schema-validated retrieval plan, retrieves products from DummyJSON, ranks them server-side, and persists both the conversation and immutable product-card snapshots in PostgreSQL. The model interprets language and writes the grounded reply; application code owns catalog access, filtering, ranking, persistence, and card construction — the model never picks hosts, HTTP methods, paths, or arbitrary URLs. See `README.md` for the full architecture rationale, retrieval policy, and failure-recovery table; it is authoritative and detailed — read it before making changes to the planner, catalog, or persistence flow.

## Commands

Local setup (Docker Compose provides Postgres on 5432 and Redis on 6379):

```bash
cp .env.example .env
docker compose up -d
npm install
npm run db:migrate
npm run dev
```

Quality gate, run after Postgres is up and the test DB is migrated:

```bash
npm run prettier      # check formatting (npm run format to fix)
npm run lint           # eslint .
npm run build           # next build
npm run test              # unit + integration (test:unit then test:integration)
npm run test:e2e          # playwright, starts its own dev server on :3001
npm run eval:offline       # deterministic scenario evaluation
```

Single-test invocations:

```bash
npx vitest run --config vitest.config.ts path/to/file.test.ts
npx vitest run --config vitest.integration.config.ts tests/integration/some.integration.test.ts
npx playwright test --config playwright.config.ts tests/e2e/conversation-flow.spec.ts
```

Test database (needed before `test:integration` / `test:e2e`):

```bash
set -a; source .env; set +a
DATABASE_URL="$TEST_DATABASE_URL" npm run db:migrate:deploy
```

Other:

```bash
npm run db:studio                    # Prisma Studio
RUN_ONLINE_EVAL=true npm run eval:online   # optional, hits real OpenAI/DummyJSON, never CI-blocking
npx playwright install chromium       # once per machine, for e2e
```

## Architecture

```
UI (src/app, src/components/chat)
  -> route handlers / BFF (src/app/api/**/route.ts)
    -> ChatService (src/domain/chat/chat-service.ts)
       - CatalogResolver -> CatalogClientContract -> DummyJSON
       - ModelClient (OpenAI plan + grounded reply)
       - ConversationRepository (Prisma) -> PostgreSQL
       - ReplyCompletionCache (process-local recovery cache)
```

**Dependency wiring**: `src/app/api/conversation-dependencies.ts` is the single composition root. It swaps in `FixtureCatalogClient` / `DeterministicModelClient` (from `src/domain/testing/deterministic-clients.ts`) when `E2E_MODE=true`, and the real `CatalogClient`/`OpenAIModelClient` otherwise. `E2E_MODE` is enforced (in `src/lib/env.ts`) to only be settable under `NODE_ENV=development` — it cannot be flipped on in a real deployment. When adding a new dependency, wire it through this file rather than constructing it inline in a route handler.

**Model configuration**: `OpenAIModelClient` takes its model identifiers as a required constructor argument — never a hardcoded default. `src/lib/openai-model-config.ts` owns resolution (`OPENAI_MODEL` for both call sites, `OPENAI_PLANNER_MODEL` / `OPENAI_REPLY_MODEL` as per-call-site overrides, `DEFAULT_OPENAI_MODEL` when unset); `src/lib/env.ts` exposes the result as `environment.openAiModels`, and `src/instrumentation.ts` logs it at startup. Scripts that build a client outside Next.js (`scripts/eval-online.ts`, `scripts/verify-yan-5.ts`) call the same resolver against `process.env` rather than restating a model name.

**Domain layout** (`src/domain/*`): each subdirectory is a bounded concern with its own `types.ts` — `catalog` (DummyJSON access, caching, plan resolution), `chat` (model client, chat orchestration, completion cache), `conversations` (Prisma-backed repository), `testing` (deterministic fakes used by E2E and unit tests, plus offline scenario evaluation). Route handlers under `src/app/api` stay thin: they validate HTTP input, call `getConversationApiDependencies()`, delegate to `ChatService`/`ConversationRepository`, and translate errors via `src/app/api/http-errors.ts`.

**Retrieval/plan boundary**: `PlanValidator` (`src/domain/catalog/plan-validator.ts`) owns every rule the model's plan is judged against — the strict Zod schema, per-intent field rules, an allowlist of category slugs, prior-product-reference scoping, and a fixed set of endpoint shapes (search, category, generic browse, single-product detail, two-product comparison). It returns a `ValidatedRetrievalPlan`, a nominal type that only the validator constructs; `CatalogResolver.resolve` accepts only that type and does no validation of its own, so retrieval provably never runs on an unvalidated plan. Non-retrieval (`clarify`/`unsupported`) plans are validated too, including the rule that they must carry a non-null `assistantMessage`. The category allowlist is not hardcoded: `CatalogResolver.listAllowedCategorySlugs()` fetches it from `CatalogClientContract.listCategorySlugs()`, so it tracks DummyJSON's real category list (see Caching below for how that stays cheap) instead of a static array maintained by hand. `ChatService` fetches it once per turn and passes it through `PlanRepairService` into both the model prompt and the `PlanValidator` it constructs for that turn, so a category that only existed in a stale prompt cannot slip through validation. `DUMMYJSON_BASE_URL` is a Zod literal pinned to `https://dummyjson.com` — it cannot be redirected via `.env`. Results are capped at six cards and ranked deterministically (exact match, then explicit sort, then relevance order, then product ID as tie-breaker) — see README's "Retrieval policy" table before changing ranking or plan validation. A plan's `isContinuation` flag ("show me more") additionally excludes product IDs already shown in the active conversation from that ranked list before the six-card cap (`CatalogResolver.resolve`'s second `priorProductIds` argument); `PlanValidator.hasFilters()` restricts `isContinuation: true` to `search`/`browse_category` plans, rejecting it on every other intent the same way it already rejects a non-`relevance` `sort`. This is implemented entirely by filtering the already-fetched local candidate pool — it does not add `skip`/`limit` pagination parameters to the DummyJSON request.

**Plan repair**: `PlanRepairService` (`src/domain/chat/plan-repair-service.ts`) owns plan → validate → repair → validate and is what `ChatService` calls instead of the model client directly. It takes a `PlanValidator` factory (`(allowedCategorySlugs: string[]) => PlanValidation`) rather than a fixed validator, so each call builds a validator against that turn's freshly fetched allowlist. On a validation failure it re-prompts the planner exactly once, passing `ModelPlanInput.repairContext` (the rejected plan plus the validator's reason); a second failure rethrows the second attempt's `CatalogError`. Model transport errors propagate untouched so `ChatService` still distinguishes `MODEL_UNAVAILABLE` from `INVALID_RETRIEVAL_PLAN`. Exactly one repair attempt, never a loop — the guardrail is structural, so keep it that way. It returns a `PlanAttemptOutcome` carrying `firstPassValid` / `repairAttempted`; `ChatService` logs those as a `plan_validation` console event and the eval scripts read them directly. There is no request deadline yet, so the repair path's worst case is two `OPENAI_TIMEOUT_MS` model calls. `DeterministicModelClient` ignores `repairContext` by design — it never emits invalid plans, so E2E and eval never exercise repair; unit tests carry it.

**Caching**: `CachingCatalogClient` wraps `CatalogClient` with Redis, using separate TTLs for list vs. detail lookups (`CATALOG_CACHE_LIST_TTL_SECONDS` / `CATALOG_CACHE_DETAIL_TTL_SECONDS`, defaults 300/1800); `listCategorySlugs()` shares the detail TTL. Errors are never cached; if Redis is unreachable, requests fall through to DummyJSON directly rather than failing.

**Model call bounds**: `OpenAIModelClient` is constructed via `createOpenAIClient()` (`src/domain/chat/openai-model-client.ts`) with an explicit `timeout` and `maxRetries` from `OPENAI_TIMEOUT_MS` / `OPENAI_MAX_RETRIES` (defaults 20000/1), overriding the SDK defaults of 10 minutes and 2 retries. Both calls pass `max_output_tokens` from `OPENAI_MAX_OUTPUT_TOKENS` (default 2000); since the model reasons, that budget covers reasoning plus visible output, and a response truncated against it throws an explicit truncation error instead of falling through to the empty-result guard. The factory exists as a seam so a unit test can assert the bounds — injecting a fake client bypasses construction entirely.

**Model error taxonomy**: `OpenAIModelClient` classifies every OpenAI SDK failure into a typed `ModelError` (`src/domain/chat/types.ts`: `AUTH_FAILED` | `RATE_LIMITED` | `TIMEOUT` | `REFUSED` | `UNAVAILABLE`) — connection/timeout SDK errors, HTTP status, and content-filter refusals (both the `incomplete_details.reason === "content_filter"` and refusal-output-item shapes of the Responses API) are distinguished rather than collapsed into one generic failure. `ChatService` maps `ModelError.code` to a `ChatErrorCode` (`MODEL_AUTH_FAILED` / `MODEL_RATE_LIMITED` / `MODEL_REFUSED` / `MODEL_TIMEOUT` / `MODEL_UNAVAILABLE`), the same way it already maps `CatalogError`, and logs the typed code with the request ID before failing the message. `retryableByChatErrorCode` (`src/domain/chat/types.ts`) is the single exhaustive source of truth — a `satisfies Record<ChatErrorCode, boolean>` — for whether a given `ChatErrorCode` is retryable; `ChatError.retryable` is derived from it and serialized through `src/app/api/http-errors.ts` into the HTTP error body, and `chat-shell.tsx` gates the Retry button on it. `requestId` is generated once per HTTP request (`createRequestId()` in `http-errors.ts`, shared by all three route handlers) and threaded into `ChatService` for correlated logging — do not generate a second ad hoc UUID for it in a route handler.

**Persistence and retry**: Prisma schema (`prisma/schema.prisma`) models `Conversation` -> `Message` (`pending`/`complete`/`failed` status, `clientRequestId` unique per conversation for idempotent retry, `sequence` for ordering, `retrievalAnchorMessage` — see below) -> `MessageProductCard` (immutable per-message snapshot: title, price, image, category, rating at recommendation time — never re-fetched live). The request-ID-scoped retry state machine is documented in `.Codex/rules/persisted-operation-state-transitions.md`: on recoverable failure, transition the same request from `failed` back to `pending`; never invoke the model or DummyJSON twice for the same request ID; never recreate the parent conversation on retry. `ReplyCompletionCache` (`src/domain/chat/reply-completion-cache.ts`) is the process-local mechanism that replays a completed model response into persistence if the DB write failed after the model call succeeded — it does not survive a process restart.

**Continuation anchor**: `Message.retrievalAnchorMessage` (nullable, `search`/`browse_category` assistant turns only) is the raw text of the user request a "show me more" chain is replaying — set to the current message on a fresh search/browse turn, and copied forward unchanged (never overwritten with the continuation phrase itself) on a continuation turn, via `ChatService.computeRetrievalAnchorMessage`. `deriveActiveContext` (`src/domain/chat/active-context.ts`) reads it off the most recent assistant message that has one — decoupled from the category lookup (most recent message with product cards) — as `ActiveRetrievalContext.lastResolvedUserMessage`, so an interleaved `product_detail`/`compare` turn (which never sets an anchor) is transparent to the chain, and an arbitrary number of consecutive continuations keep replaying the same original request rather than degrading into replaying the previous "more" itself.

**Migrations**: Prisma Migrate migrations under `prisma/migrations/` are committed and must be applied with `db:migrate` (dev) or `db:migrate:deploy` (test/prod-style), never `prisma db push`. The generated Prisma client lives in `src/generated/prisma/` and is excluded from lint (`eslint.config.mjs`).

## Testing layers

- **Unit** (`src/**/*.test.{ts,tsx}`, `vitest.config.ts`, jsdom): plan validation, ranking, snapshot mapping, chat orchestration, UI state. Uses fakes, no live services, imports alias `server-only` to a no-op (`tests/server-only.ts`).
- **Integration** (`tests/integration/*.integration.test.ts`, `vitest.integration.config.ts`, node env, `fileParallelism: false`): route/service/repository/retry/recovery behavior against the real migrated local test database.
- **E2E** (`tests/e2e/*.spec.ts`, Playwright): boots `next dev --port 3001` with `E2E_MODE=true` and deterministic server-only clients — no live OpenAI/DummyJSON calls.
- **Offline eval** (`scripts/eval-offline.ts`, scenarios in `tests/evals/scenarios.json`): versioned fixture scenarios checked for plan validity, intent, constraints, selected IDs, grounding, latency; writes a report under `artifacts/evaluations/`. Deterministic, does not assess exact prose.
- **Online eval** (`scripts/eval-online.ts`): optional, real OpenAI/DummyJSON, cost-capped, opt-in only via `RUN_ONLINE_EVAL=true`.

Deterministic tests assert structured effects/invariants, not exact assistant wording — follow that convention when adding new tests.
