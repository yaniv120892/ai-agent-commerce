# AI Commerce Copilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a locally runnable, grounded AI shopping copilot with persistent PostgreSQL conversations, in-chat product cards, and reproducible deterministic and model-quality evaluation.

**Architecture:** A Next.js App Router BFF owns validation, OpenAI calls, DummyJSON access, and PostgreSQL state. The model produces a constrained retrieval plan; server-side code resolves and ranks trusted catalog products; a second model call explains only those results. Product cards come from persisted catalog snapshots, never model prose.

**Tech Stack:** TypeScript, Next.js App Router, React, official OpenAI SDK, Zod, node-postgres (`pg`), PostgreSQL 17 in Docker Compose, Vitest, Playwright, ESLint, Prettier.

## Global Constraints

- Use TypeScript throughout; use `T[]` array syntax and define exported types in dedicated `types.ts` files.
- Use explicit class access modifiers; class helpers are private methods and public methods appear before private helpers.
- Always use braces for control flow and fix lint violations instead of suppressing them.
- Keep the OpenAI API key server-only in `.env.local`; commit `.env.example` but never secrets or a database volume.
- Use the fixed `https://dummyjson.com` base URL; the model never constructs arbitrary URLs or methods.
- Build non-streaming v1 replies. Do not introduce cross-conversation memory, card freshness checks, auth, cart, checkout, or deletion controls.
- Treat product-card snapshots as historical recommendations. Do not overwrite historic cards with live catalog values.
- Run `npm run prettier`, `npm run lint`, `npm run build`, and `npm run test` before every commit after Task 1.

---

## Planned File Structure

| Path | Responsibility |
|---|---|
| `package.json` | Reproducible scripts and package dependencies. |
| `compose.yaml` | Local PostgreSQL service, health check, and persisted volume. |
| `.env.example` | Non-secret local configuration contract. |
| `scripts/migrate.ts` | Ordered SQL-migration runner. |
| `src/db/migrations/001_initial.sql` | Conversation, message, and card-snapshot schema. |
| `src/lib/env.ts` | Zod-validated server environment. |
| `src/lib/db/postgres-client.ts` | Singleton connection-pool lifecycle. |
| `src/domain/conversations/types.ts` | Conversation, message, snapshot, and repository contracts. |
| `src/domain/conversations/conversation-repository.ts` | Parameterized PostgreSQL reads/writes and idempotency. |
| `src/domain/catalog/types.ts` | DummyJSON and normalized product types. |
| `src/domain/catalog/catalog-client.ts` | Fixed-base-URL, timeout, retry, and payload validation. |
| `src/domain/catalog/catalog-resolver.ts` | Valid-plan endpoint selection, local filters, and stable ranking. |
| `src/domain/chat/types.ts` | Retrieval-plan, model, service, and API response types. |
| `src/domain/chat/openai-model-client.ts` | Strict planner and grounded reply calls. |
| `src/domain/chat/chat-service.ts` | Orchestration of persistence, plan, retrieval, reply, and typed failures. |
| `src/app/api/conversations/**/route.ts` | Explicit HTTP boundary for list, load, create, and append. |
| `src/components/chat/**` | Sidebar, messages, cards, composer, and chat-state UI. |
| `src/app/page.tsx`, `src/app/conversations/[conversationId]/page.tsx` | New and resumed chat routes. |
| `tests/**` | Integration fixtures, HTTP tests, E2E tests, and evaluation datasets. |
| `scripts/eval-offline.ts`, `scripts/eval-online.ts` | Separate reproducible and live quality checks. |
| `README.md` | Setup, decisions, alternatives, test/evaluation scope, and limitations. |

## Task 1: Scaffold the reproducible application runtime

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `.prettierrc.json`, `.gitignore`, `.env.example`, `compose.yaml`, `src/app/layout.tsx`, `src/app/globals.css`, `src/app/page.tsx`
- Create: `scripts/migrate.ts`, `src/lib/env.ts`, `src/lib/db/postgres-client.ts`, `src/db/migrations/001_initial.sql`
- Test: `src/lib/env.test.ts`

**Interfaces:**
- Produces `environment` from `src/lib/env.ts`, containing `databaseUrl`, `openAiApiKey`, `dummyJsonBaseUrl`, `dummyJsonTimeoutMs`, and `port`.
- Produces `getPostgresPool(): Pool` and `closePostgresPool(): Promise<void>` for repository code.

- [ ] **Step 1: Initialize the Next.js project and dependencies**

Create a TypeScript App Router project in the repository root. Add runtime dependencies `next`, `react`, `react-dom`, `openai`, `pg`, and `zod`; add development dependencies `typescript`, `tsx`, `@types/node`, `@types/react`, `@types/react-dom`, `@types/pg`, `vitest`, `@vitest/coverage-v8`, `@playwright/test`, `eslint`, `eslint-config-next`, `prettier`, and `prettier-plugin-tailwindcss` only if Tailwind is deliberately introduced. Keep styling in CSS otherwise.

Use these scripts:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "prettier": "prettier --check .",
    "format": "prettier --write .",
    "lint": "eslint .",
    "test:unit": "vitest run src",
    "test:integration": "vitest run tests/integration",
    "test": "npm run test:unit && npm run test:integration",
    "test:e2e": "playwright test",
    "db:migrate": "tsx scripts/migrate.ts",
    "eval:offline": "tsx scripts/eval-offline.ts",
    "eval:online": "tsx scripts/eval-online.ts"
  }
}
```

- [ ] **Step 2: Add Docker and environment contracts**

Create `compose.yaml` with one `postgres:17-alpine` service named `database`, a `5432:5432` local port mapping, `POSTGRES_DB=ai_commerce`, `POSTGRES_USER=ai_commerce`, `POSTGRES_PASSWORD=ai_commerce_local`, a named `postgres_data` volume, and a `pg_isready` health check. Create `.env.example` with:

```dotenv
DATABASE_URL=postgresql://ai_commerce:ai_commerce_local@localhost:5432/ai_commerce
TEST_DATABASE_URL=postgresql://ai_commerce:ai_commerce_local@localhost:5432/ai_commerce_test
OPENAI_API_KEY=
DUMMYJSON_BASE_URL=https://dummyjson.com
DUMMYJSON_TIMEOUT_MS=5000
```

Add `.env.local`, `.env.test.local`, `node_modules`, `.next`, `playwright-report`, `test-results`, and `postgres_data` to `.gitignore`.

- [ ] **Step 3: Write the failing environment-validation test**

Create `src/lib/env.test.ts` and use a module-level factory so tests do not mutate process-global state:

```ts
it("rejects an invalid DummyJSON base URL", () => {
  expect(() => createEnvironment({
    DATABASE_URL: "postgresql://localhost/ai_commerce",
    OPENAI_API_KEY: "test-key",
    DUMMYJSON_BASE_URL: "not-a-url",
    DUMMYJSON_TIMEOUT_MS: "5000",
  })).toThrow("DUMMYJSON_BASE_URL");
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm run test:unit -- src/lib/env.test.ts`

Expected: FAIL because `createEnvironment` is not exported.

- [ ] **Step 5: Implement environment and database bootstrapping**

Implement `createEnvironment(values: NodeJS.ProcessEnv): Environment` with Zod. Require `DATABASE_URL` and `OPENAI_API_KEY` for runtime, validate the URL and a positive integer timeout, default `DUMMYJSON_BASE_URL` to `https://dummyjson.com`, and never export the raw environment object to client modules.

Implement the migration runner to read sorted `.sql` files, create an internal `schema_migrations(name text primary key, applied_at timestamptz not null default now())` table, apply each unapplied file inside a transaction, and record it only after its SQL succeeds. `getPostgresPool` must create one `Pool` from `environment.databaseUrl`; `closePostgresPool` must call `pool.end()`.

- [ ] **Step 6: Add the initial migration**

Create `001_initial.sql` with `pgcrypto`, then these tables and indexes:

```sql
create extension if not exists pgcrypto;

create table conversations (
  id uuid primary key default gen_random_uuid(),
  title varchar(80) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  client_request_id uuid,
  role varchar(16) not null check (role in ('user', 'assistant')),
  content text not null default '',
  status varchar(16) not null check (status in ('pending', 'complete', 'failed')),
  created_at timestamptz not null default now(),
  unique (conversation_id, client_request_id)
);

create table message_product_cards (
  message_id uuid not null references messages(id) on delete cascade,
  position integer not null check (position >= 0),
  product_id integer not null,
  title text not null,
  short_description text not null,
  price numeric(12, 2) not null,
  image_url text not null,
  category text not null,
  rating numeric(3, 2),
  primary key (message_id, position)
);

create index messages_conversation_created_at_idx on messages (conversation_id, created_at);
create index conversations_updated_at_idx on conversations (updated_at desc);
```

- [ ] **Step 7: Verify the runtime baseline**

Run: `docker compose up -d database && npm run db:migrate && npm run test:unit -- src/lib/env.test.ts && npm run prettier && npm run lint && npm run build`

Expected: the database health check becomes healthy, migration records `001_initial.sql`, the environment test passes, and format/lint/build exit 0.

- [ ] **Step 8: Commit the baseline**

```bash
git add package.json package-lock.json tsconfig.json next.config.ts eslint.config.mjs .prettierrc.json .gitignore .env.example compose.yaml scripts/migrate.ts src/app src/lib src/db src/lib/env.test.ts
git commit -m "build: scaffold ai commerce application"
```

## Task 2: Implement PostgreSQL conversation persistence

**Files:**
- Create: `src/domain/conversations/types.ts`, `src/domain/conversations/conversation-repository.ts`, `src/domain/conversations/conversation-repository.test.ts`
- Modify: `src/db/migrations/001_initial.sql` only if Task 1 verification exposes an incompatible constraint.
- Test: `tests/integration/conversation-repository.integration.test.ts`

**Interfaces:**
- Consumes `Pool` from `getPostgresPool()`.
- Produces `ConversationRepository` with `listConversations`, `getConversation`, `createConversationWithPendingReply`, `appendMessageWithPendingReply`, `completeAssistantMessage`, and `failAssistantMessage`.

- [ ] **Step 1: Define persistence contracts and write failing unit tests**

Create the exported types in `types.ts`:

```ts
export type MessageRole = "user" | "assistant";
export type MessageStatus = "pending" | "complete" | "failed";

export type ProductCardSnapshot = {
  productId: number;
  title: string;
  shortDescription: string;
  price: number;
  imageUrl: string;
  category: string;
  rating: number | null;
};

export type PersistedMessage = {
  id: string;
  role: MessageRole;
  content: string;
  status: MessageStatus;
  createdAt: string;
  productCards: ProductCardSnapshot[];
};

export type PersistedConversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: PersistedMessage[];
};
```

Write a unit test using a mocked `Pool` asserting `completeAssistantMessage` submits parameterized values and inserts each card with its array index as `position`.

- [ ] **Step 2: Run the repository unit test to verify it fails**

Run: `npm run test:unit -- src/domain/conversations/conversation-repository.test.ts`

Expected: FAIL because `ConversationRepository` is missing.

- [ ] **Step 3: Implement the repository and idempotency behavior**

Implement a class with explicit public/private modifiers. `createConversationWithPendingReply` must start a transaction, insert the conversation, user message with the client request ID, pending assistant message, and return both messages. `appendMessageWithPendingReply` must first look up the unique `(conversation_id, client_request_id)` user message; on a match, return the existing pending or failed assistant message rather than insert a duplicate.

`completeAssistantMessage` must update one pending assistant message to `complete`, delete any prior snapshot rows for that message, insert the provided snapshots in position order, and update the conversation timestamp in one transaction. `failAssistantMessage` must update only the pending assistant message to `failed`. All SQL values use `$1`-style parameters.

- [ ] **Step 4: Write the database integration tests**

Create integration tests that migrate `TEST_DATABASE_URL`, truncate the three application tables before each test, and verify:

```ts
it("resumes messages and snapshot cards in stored order", async () => {
  // Create a conversation, complete its assistant message with two snapshots,
  // then assert getConversation returns both cards at positions 0 and 1.
});

it("does not duplicate a user message when the same request ID is retried", async () => {
  // Append twice with one request ID and assert there is one user and one assistant row.
});
```

- [ ] **Step 5: Run repository verification**

Run: `npm run test:unit -- src/domain/conversations/conversation-repository.test.ts && npm run test:integration -- tests/integration/conversation-repository.integration.test.ts`

Expected: PASS; the integration suite leaves no duplicate request IDs or unowned snapshots.

- [ ] **Step 6: Commit persistence**

```bash
git add src/domain/conversations tests/integration/conversation-repository.integration.test.ts
git commit -m "feat: persist conversations and product snapshots"
```

## Task 3: Implement trusted DummyJSON retrieval and deterministic ranking

**Files:**
- Create: `src/domain/catalog/types.ts`, `src/domain/catalog/catalog-client.ts`, `src/domain/catalog/catalog-resolver.ts`, `src/domain/catalog/catalog-resolver.test.ts`

**Interfaces:**
- Produces `CatalogClient` methods `searchProducts`, `listCategoryProducts`, `listProducts`, `getProduct`, and `listCategorySlugs`.
- Produces `CatalogResolver.resolve(plan: RetrievalPlan, priorProductIds: number[]): Promise<ResolvedCatalogResult>` for `ChatService`.

- [ ] **Step 1: Define normalized catalog contracts and failing resolver tests**

Define `CatalogProduct` with `id`, `title`, `description`, `category`, `price`, `rating`, `stock`, `availabilityStatus`, `thumbnail`, and `images`. Define `ProductCardSnapshot` mapping in one location and reuse it from the conversations domain rather than duplicate a shape.

Write tests for these exact cases:

```ts
it("filters a search result by max price and sorts ascending by price", async () => {
  // Fixture prices: 399, 199, 299; expect product IDs [2, 3].
});

it("rejects a category not present in the category allowlist", async () => {
  // Expect a typed INVALID_RETRIEVAL_PLAN error and no network call.
});

it("resolves ordinal references only from prior conversation product IDs", async () => {
  // A requested id outside [10, 11] is rejected.
});
```

- [ ] **Step 2: Run the resolver tests to verify they fail**

Run: `npm run test:unit -- src/domain/catalog/catalog-resolver.test.ts`

Expected: FAIL because `CatalogResolver` is missing.

- [ ] **Step 3: Implement the fixed-base-url catalog client**

Implement `CatalogClient` as a class that accepts `fetch`, base URL, and timeout in its constructor. Its private request method must create URLs from the configured base URL and fixed path segments, encode query values with `URLSearchParams`, abort after the configured timeout, validate successful JSON through Zod, retry a GET exactly once only for network errors or 5xx, and throw distinct typed errors for `NOT_FOUND`, `UPSTREAM_UNAVAILABLE`, and `INVALID_UPSTREAM_PAYLOAD`.

- [ ] **Step 4: Implement resolver validation, endpoint selection, and ranking**

The resolver must validate the plan fields, category allowlist, maximum two search terms, maximum two comparison IDs, non-negative prices, valid sort value, and product references. Resolve text with `/products/search`, category-only browsing with `/products/category/:slug`, generic browsing with `/products`, and details with `/products/:id`. Apply category, price, rating, and stock filters locally. Rank exact normalized title/token matches first, preserve upstream order for relevance ties, apply explicit sort when requested, and use product ID as the final tie-breaker. Return at most six card snapshots.

- [ ] **Step 5: Verify catalog behavior**

Run: `npm run test:unit -- src/domain/catalog/catalog-resolver.test.ts`

Expected: PASS for filtering, stable ordering, invalid-category rejection, and prior-conversation reference restriction.

- [ ] **Step 6: Commit catalog retrieval**

```bash
git add src/domain/catalog src/domain/conversations/types.ts
git commit -m "feat: add grounded catalog retrieval"
```

## Task 4: Implement model boundaries and chat orchestration

**Files:**
- Create: `src/domain/chat/types.ts`, `src/domain/chat/openai-model-client.ts`, `src/domain/chat/chat-service.ts`, `src/domain/chat/chat-service.test.ts`

**Interfaces:**
- Consumes `ConversationRepository`, `CatalogResolver`, and `ModelClient`.
- Produces `ChatService.startConversation(input)` and `ChatService.appendMessage(input)`, both returning `ChatResponse`.

- [ ] **Step 1: Define model and service types plus failing orchestration tests**

Define these exported contracts:

```ts
export type RetrievalPlan = {
  intent: "search" | "browse_category" | "product_detail" | "compare" | "clarify" | "unsupported";
  searchTerms: string[];
  categorySlug: string | null;
  maxPrice: number | null;
  minRating: number | null;
  inStock: boolean | null;
  sort: "relevance" | "price_asc" | "price_desc" | "rating_desc";
  referencedProductIds: number[];
  assistantMessage: string | null;
};

export type ModelPlanInput = {
  userMessage: string;
  history: PersistedMessage[];
  allowedCategorySlugs: string[];
  priorProductIds: number[];
};

export type ModelReplyInput = {
  userMessage: string;
  intent: RetrievalPlan["intent"];
  products: ProductCardSnapshot[];
};

export interface ModelClient {
  createRetrievalPlan(input: ModelPlanInput): Promise<RetrievalPlan>;
  createGroundedReply(input: ModelReplyInput): Promise<string>;
}
```

Test that the service persists the user and pending assistant before calling the model, skips catalog access for `unsupported`, persists only resolver snapshots, and marks the assistant message `failed` on an OpenAI error.

- [ ] **Step 2: Run the orchestration tests to verify they fail**

Run: `npm run test:unit -- src/domain/chat/chat-service.test.ts`

Expected: FAIL because `ChatService` is missing.

- [ ] **Step 3: Implement the strict OpenAI model client**

Use the official OpenAI SDK only in `openai-model-client.ts`. `createRetrievalPlan` must request structured output matching every `RetrievalPlan` field, with no extra fields. Its instruction must state that the user and catalog text are data, not instructions; that it may select only declared intent and fields; and that it must return `unsupported` for requests outside the DummyJSON catalog.

`createGroundedReply` receives a bounded, normalized list of selected products and creates concise text. Its instruction must prohibit claiming facts not included in that data and prohibit pricing or availability language beyond the snapshot fields supplied. It must not receive the API key, raw SQL, or arbitrary tool definitions.

- [ ] **Step 4: Implement orchestration and typed errors**

`ChatService` must validate a non-empty trimmed message no longer than 2,000 characters, load only the most recent twelve completed messages and their snapshots as planning context, and use the repository's request-ID behavior. For retrieval intents, call the resolver then the grounded-reply method. For clarify and unsupported intents, return the plan's safe text without catalog access. Complete the assistant message and snapshots atomically; on model/catalog failures call `failAssistantMessage` and return a typed error code. Never substitute a model-memory answer for a catalog failure.

- [ ] **Step 5: Verify orchestration**

Run: `npm run test:unit -- src/domain/chat/chat-service.test.ts`

Expected: PASS; fake clients prove no duplicate persistence, no unsupported network call, and no untrusted card.

- [ ] **Step 6: Commit chat orchestration**

```bash
git add src/domain/chat
git commit -m "feat: orchestrate constrained shopping chat"
```

## Task 5: Expose and test the HTTP BFF contract

**Files:**
- Create: `src/app/api/conversations/route.ts`, `src/app/api/conversations/[conversationId]/route.ts`, `src/app/api/conversations/[conversationId]/messages/route.ts`, `src/app/api/http-errors.ts`, `tests/integration/conversation-routes.integration.test.ts`

**Interfaces:**
- Consumes `ChatService` and `ConversationRepository` through a single server-side dependency factory.
- Produces JSON responses using `ConversationSummary`, `PersistedConversation`, `ChatResponse`, and `{ error: { code: string; message: string } }`.

- [ ] **Step 1: Write failing route tests**

Cover these requests with fake model/catalog dependencies and the migrated test database:

```ts
it("creates a conversation and returns completed cards", async () => {
  // POST /api/conversations with content and clientRequestId returns 201.
});

it("returns 404 when a cleared database no longer has the requested conversation", async () => {
  // A syntactically valid UUID absent from the database returns UNKNOWN_CONVERSATION.
});

it("returns 422 without calling the model for invalid message content", async () => {
  // Empty content maps to INVALID_MESSAGE.
});
```

- [ ] **Step 2: Run route tests to verify they fail**

Run: `npm run test:integration -- tests/integration/conversation-routes.integration.test.ts`

Expected: FAIL because no route handlers exist.

- [ ] **Step 3: Implement request parsing and route handlers**

Parse JSON with a Zod request schema containing `content` and `clientRequestId`. Return 201 from creation, 200 from append/list/load, 404 for unknown conversations, 422 for invalid input or plan, 502 for DummyJSON unavailability, 503 for database/model unavailability, and 500 only for unexpected server errors. Keep error response text user-safe and log the typed code plus a request ID without raw message content.

- [ ] **Step 4: Verify the BFF contract**

Run: `npm run test:integration -- tests/integration/conversation-routes.integration.test.ts`

Expected: PASS; responses are typed and the invalid-content test makes no model call.

- [ ] **Step 5: Commit routes**

```bash
git add src/app/api tests/integration/conversation-routes.integration.test.ts
git commit -m "feat: expose conversation api routes"
```

## Task 6: Build the chat-first user interface

**Files:**
- Create: `src/components/chat/types.ts`, `src/components/chat/chat-shell.tsx`, `src/components/chat/conversation-sidebar.tsx`, `src/components/chat/message-list.tsx`, `src/components/chat/product-card.tsx`, `src/components/chat/chat-composer.tsx`, `src/components/chat/chat-shell.test.tsx`
- Modify: `src/app/page.tsx`, `src/app/conversations/[conversationId]/page.tsx`, `src/app/globals.css`

**Interfaces:**
- Consumes the JSON contract from Task 5.
- Produces a `ChatShell` taking `initialConversation: PersistedConversation | null` and rendering exactly one active conversation.

- [ ] **Step 1: Write failing component tests**

Use React Testing Library to verify:

```tsx
it("renders product cards from snapshots rather than assistant message text", () => {
  // Render one assistant message and assert image alt text, title, and price are visible.
});

it("disables the composer while a message is pending", () => {
  // Render pending state and assert the submit button is disabled.
});

it("offers a new conversation when the current conversation is unknown", () => {
  // Simulate UNKNOWN_CONVERSATION and assert a new-chat action is visible.
});
```

- [ ] **Step 2: Run UI tests to verify they fail**

Run: `npm run test:unit -- src/components/chat/chat-shell.test.tsx`

Expected: FAIL because `ChatShell` is missing.

- [ ] **Step 3: Implement accessible message and card rendering**

Implement client components with a small explicit reducer for `idle`, `sending`, `error`, and `unknownConversation` states. Render product cards from `message.productCards` only. Each card has a meaningful image `alt`, visible title, concise description, price, category, and rating where present. Use semantic buttons, visible focus styles, and an `aria-live="polite"` status for send/error feedback. Do not add an add-to-cart action.

The sidebar has a new-conversation button and recent conversation links ordered by the API data. A new conversation remains unsaved until its first message. The root page starts an empty shell; the dynamic route loads the saved conversation server-side and passes it to the same shell.

- [ ] **Step 4: Implement send and recovery behavior**

On first send, call `POST /api/conversations`; otherwise call the append route. Generate one UUID request ID per submit and retain it for retries. On success, navigate to `/conversations/:id`; on a typed upstream/model failure, show a retry button that reuses the request ID; on `UNKNOWN_CONVERSATION`, do not silently recreate history and instead offer a new empty conversation. Show a loading state until the whole non-streaming response arrives.

- [ ] **Step 5: Verify UI behavior**

Run: `npm run test:unit -- src/components/chat/chat-shell.test.tsx && npm run lint`

Expected: PASS; card snapshots render, pending state blocks duplicate send, and recovery is visible.

- [ ] **Step 6: Commit the UI**

```bash
git add src/app src/components
git commit -m "feat: add persistent shopping chat ui"
```

## Task 7: Add browser E2E coverage and model evaluation commands

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/conversation-flow.spec.ts`, `tests/e2e/fixtures.ts`, `tests/evals/scenarios.json`, `scripts/eval-offline.ts`, `scripts/eval-online.ts`
- Modify: `package.json`, `README.md`

**Interfaces:**
- Consumes the production HTTP routes, a test-only fake `ModelClient`, and test catalog fixtures.
- Produces JSON evaluation reports under `artifacts/evaluations/`, ignored by Git.

- [ ] **Step 1: Write the failing end-to-end scenario**

Create a Playwright spec that starts with a clean test database and fake external clients, sends “show phones under $400”, sees one or more product cards, reloads the page, sees the same saved card title and price, starts a new conversation, and resumes the old conversation from the sidebar.

- [ ] **Step 2: Run the E2E test to verify it fails**

Run: `npm run test:e2e -- tests/e2e/conversation-flow.spec.ts`

Expected: FAIL until the test server, fake-dependency seam, and UI are complete.

- [ ] **Step 3: Implement the test-only dependency seam**

Create a server-side dependency factory that selects deterministic fake `ModelClient` and `CatalogClient` implementations only when `E2E_MODE=true` and Next.js is running in development mode. Production configuration must reject `E2E_MODE=true`. The Playwright web server starts `npm run dev` with that explicit flag; the fakes return fixture plans/products, enabling E2E tests to assert UI behavior without real OpenAI or DummyJSON calls.

- [ ] **Step 4: Add offline evaluation**

Create `tests/evals/scenarios.json` with at least these named cases: `budget_category`, `follow_up_budget`, `ordinal_detail`, `compare`, `two_intents`, `ambiguous`, `off_catalog`, and `prompt_injection`. Each case contains prior messages, current input, fixture catalog, expected intent, required constraints, and forbidden behavior.

`eval-offline.ts` runs each scenario against the planner with fixture catalog context, then writes a JSON report containing plan validity, expected-versus-actual intent, constraint checks, selected product IDs, grounded-card checks, latency, and failures. A failed required constraint exits 1. It must not assert exact assistant wording.

- [ ] **Step 5: Add online smoke evaluation**

`eval-online.ts` runs a small three-case subset against the real `gpt-5.4-mini` and real DummyJSON API only when `RUN_ONLINE_EVAL=true`. Require `OPENAI_API_KEY`, cap cases at three, record no raw credentials, and print that this command is not CI-safe because it has external cost and availability dependencies. Exit non-zero only for integration failure, invalid plan, or ungrounded card IDs.

- [ ] **Step 6: Verify browser and evaluation behavior**

Run: `npm run test:e2e && npm run eval:offline`

Expected: E2E passes without external calls; offline evaluation emits a report where every required scenario is valid and grounded.

- [ ] **Step 7: Commit evaluation coverage**

```bash
git add playwright.config.ts tests scripts package.json README.md .gitignore
git commit -m "test: add e2e and evaluation coverage"
```

## Task 8: Finish the README and execute the full quality gate

**Files:**
- Create: `README.md`
- Modify: `.env.example`, `docs/superpowers/specs/2026-07-16-ai-commerce-copilot-design.md` only if commands or behavior changed during implementation.

**Interfaces:**
- Consumes actual package scripts and Docker configuration from Tasks 1–7.
- Produces an interview-ready explanation of the final running system and its constraints.

- [ ] **Step 1: Write README acceptance assertions**

Create a checklist test in `README.md` content review covering required sections: setup/run, architecture and rejected alternatives, retrieval endpoints/policy, ambiguous/off-catalog/multi-intent behavior, conversation persistence and failures, deterministic/LLM evaluation coverage and blind spots, and known limitations.

- [ ] **Step 2: Write setup and operational documentation**

Document these commands in order, matching the implemented scripts exactly:

```bash
cp .env.example .env.local
docker compose up -d database
npm install
npm run db:migrate
npm run dev
```

Explain `docker compose down` preserves history and `docker compose down -v` deletes the local database volume and therefore all conversation history.

- [ ] **Step 3: Document the design decisions in the user’s own words**

Include the concrete rejection reasons for React plus a separate Node API, Vercel AI SDK, LangChain/Mastra, SQLite, and a hosted database. Explain the constrained retrieval plan, exact DummyJSON endpoint policy, server-side ranking, model/data boundary, snapshots, Postgres failure behavior, non-streaming decision, and deferred live freshness/memory features.

- [ ] **Step 4: Document evaluation boundaries and limitations**

State exactly what unit, integration, E2E, offline evaluation, and online smoke evaluation catch. State that deterministic tests use fakes, online evaluation is optional and cost-capped, exact prose is not asserted, and an optional LLM judge is not a correctness guarantee. List the catalog, ranking, memory, streaming, freshness, auth, and checkout limitations.

- [ ] **Step 5: Run the final quality gate**

Run: `npm run prettier && npm run lint && npm run build && npm run test && npm run test:e2e && npm run eval:offline`

Expected: every command exits 0. Record the executed commands and outcomes in the final handoff; do not claim online evaluation passed unless `RUN_ONLINE_EVAL=true npm run eval:online` was actually run.

- [ ] **Step 6: Commit the README and final verification**

```bash
git add README.md .env.example docs/superpowers/specs/2026-07-16-ai-commerce-copilot-design.md
git commit -m "docs: document ai commerce copilot"
```

## Plan Self-Review

| Specification requirement | Implementation tasks |
|---|---|
| Local runnable chat and in-chat cards | Tasks 1, 4, 5, and 6 |
| Grounded product discovery using DummyJSON | Tasks 3 and 4 |
| Persist, list, start, and resume conversations | Tasks 2, 5, and 6 |
| PostgreSQL Docker boundary and recovery | Tasks 1, 2, and 8 |
| Deterministic tests plus offline/online evaluations | Tasks 2–5 and 7 |
| README decisions, alternatives, failures, and limitations | Task 8 |
| Deferred streaming, memory, live freshness, auth, and checkout | Global constraints, Tasks 4, 6, and 8 |

The plan has no placeholder tasks: every task names its files, dependency contracts, expected test failure, implementation behavior, verification command, and commit boundary. The contracts used in later tasks are defined by the earlier task that produces them.
