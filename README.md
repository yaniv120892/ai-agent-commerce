# AI Commerce Copilot

Local shopping-chat application with persistent conversations and product-card snapshots.

## Setup

Copy `.env.example` to `.env`, supply `OPENAI_API_KEY`, then start PostgreSQL and apply migrations:

```bash
docker compose up -d database
set -a && source .env && set +a
npm run db:migrate:deploy
DATABASE_URL="$TEST_DATABASE_URL" npm run db:migrate:deploy
```

Run the app with `npm run dev`.

## Verification

```bash
npm run prettier
npm run lint
npm run build
npm run test
npm run test:e2e
npm run eval:offline
```

The E2E suite runs the development server with `E2E_MODE=true`, an isolated test database, and deterministic server-only model/catalog fakes. `E2E_MODE` is rejected outside Next.js development mode, and the deterministic suite makes no OpenAI or DummyJSON calls.

`npm run eval:offline` writes a JSON report to `artifacts/evaluations/`. It validates intent, required retrieval constraints, selected card IDs, grounding, and latency without checking exact assistant wording.

`npm run eval:online` is opt-in: set `RUN_ONLINE_EVAL=true` and provide `OPENAI_API_KEY`. It is not CI-safe because it depends on paid OpenAI calls and the live DummyJSON API.
