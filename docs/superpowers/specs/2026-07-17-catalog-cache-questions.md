# Brainstorming Questions: DummyJSON catalog cache (YAN-12)

Please answer each question below and let me know when done.

---

## 1. Cache lifetime — where does the cache instance live?

`getConversationApiDependencies()` (src/app/api/conversation-dependencies.ts) runs on **every API request** and currently constructs a fresh `CatalogClient` each time. `ReplyCompletionCache` avoids this by being a `const` declared at module scope, outside the function, so one instance survives across requests within the same server process.

For the new cache to actually deduplicate calls across users/requests (the whole point of the ticket), the caching decorator instance must be a module-level singleton too — not created inside `getConversationApiDependencies()`.

Confirm this is the intended lifetime:

**Options:**
- Option A: Module-level singleton, same pattern as `replyCompletionCache` (Recommended)
- Option B: Something else (describe below)

> A (maybe lets create a generic method for caching? in addition - lets use a docker for the redis also so even on restart of the server - it will still persist)

---

## 2. TTL values

The ticket suggests 5–15 min for list/search endpoints and a longer TTL for product-detail/compare lookups (stable IDs). Pick concrete numbers:

**Options:**
- Option A: 10 min for `searchProducts`/`listCategoryProducts`/`listProducts`; 60 min for `getProduct`/`listCategorySlugs` (Recommended)
- Option B: 5 min / 30 min
- Option C: Custom values (specify below)

> B is good enough - how are we going to handle invalidations? (write a comment that if the catalog is changing we will probably need to get some notification via some event so we can invalidate it easily later)

---

## 3. Max cache size (LRU eviction cap)

The ticket calls out unbounded search-term growth as a memory risk. What's the entry cap?

**Options:**
- Option A: 500 entries total, single shared LRU (Recommended)
- Option B: Separate caps per bucket (e.g. 300 list/search + 200 detail)
- Option C: Custom number (specify below)

> lets keep it simple for now 

---

## 4. Configurability

Should TTL/max-size be hardcoded constants in the new module, or environment-configurable via `src/lib/env.ts` (matching the existing `DUMMYJSON_BASE_URL`/`DUMMYJSON_TIMEOUT_MS` pattern)?

**Options:**
- Option A: Hardcoded constants in the new module — no new env vars, simplest (Recommended)
- Option B: Environment-configurable (adds `CATALOG_CACHE_*` env vars with defaults)

> B with defaults

---

## 5. New dependency: `lru-cache`

The ticket explicitly suggests the `lru-cache` npm package (matches the repo's "prefer established packages" rule). This adds a new runtime dependency to `package.json`. Confirm you want it installed, versus a ~30-line hand-rolled `Map` + TTL (no new dependency, but reimplements LRU eviction).

**Options:**
- Option A: Add `lru-cache` npm package (Recommended)
- Option B: Hand-roll a small Map-based TTL+LRU with no new dependency

> I think we will use simple cache so it is redundant, no?

---

## 6. Negative-result caching (404 / errors)

The ticket says to cache only successful, schema-validated responses, and never cache `UPSTREAM_UNAVAILABLE`/`INVALID_UPSTREAM_PAYLOAD`. That leaves one edge case: `getProduct` throwing `NOT_FOUND` (404) for a bad/deleted product ID. Should a repeated lookup of a nonexistent ID keep hitting DummyJSON every time, or should we negative-cache 404s too?

**Options:**
- Option A: Never cache any thrown `CatalogError`, including `NOT_FOUND` — simplest, matches ticket wording literally (Recommended)
- Option B: Also negative-cache `NOT_FOUND` (shorter TTL, e.g. 1 min) to stop repeated-miss hammering

> A - maybe but we need to verify that it is a real id? I mean if ids are number - no reason to call the dummyJson with some text string thay is not a number

---

## 7. Observability

Do you want hit/miss counters or logging exposed anywhere (e.g. for future monitoring), or is that out of scope for this ticket?

**Options:**
- Option A: Out of scope — just the cache behavior, no metrics (Recommended)
- Option B: Add basic hit/miss counters accessible for tests/monitoring

> Lets add metrics (we will probably have it in the redis provider we will use? if we in theory host it on google/aws, no?

---

## Follow-ups

Your Q1 answer (Redis, Docker, persistence across restarts) is a bigger architectural fork than the ticket's original "in-memory TTL+LRU" ask — it changes the answers to Q3, Q5, and Q7 too. I checked the repo first: there's no Redis or hosting config anywhere yet — just `compose.yaml` running a local Postgres container for dev (no `Dockerfile`, no `vercel.json`/`fly.toml`/etc. for production). So "survives a server restart" only has teeth in local dev right now; there's no chosen production host yet, which matters for F3 below.

Two things I resolved myself from the code, no need to answer:
- **Q6 (id validation before calling DummyJSON):** already handled upstream. `CatalogResolver.validatePlan` runs `retrievalPlanSchema` (Zod) on the retrieval plan before ever calling `catalogClient.getProduct`, and `referencedProductIds` is typed `z.number().int().positive()`. A non-numeric/malformed ID can never reach the catalog client (caching or not) — it's rejected as `INVALID_RETRIEVAL_PLAN` first. No extra guard needed in the cache layer.
- **Q3 (max size), conditional on F1 below:** if in-memory, I'll default to the 500-entry single-cap you already leaned toward ("keep it simple"); if Redis, cap via `maxmemory` + `maxmemory-policy allkeys-lru` in `compose.yaml` instead of an app-level count. Either way this becomes a concrete line in the design doc for you to review — no need to answer separately.

### F1. Redis now, or in-memory now + Redis as a fast-follow ticket?

Adding a `redis` service to `compose.yaml` is genuinely low-effort (same shape as the existing `database` service). But going Redis also means: a new `REDIS_URL` env var, a new npm client dependency (`ioredis` or `redis`), a singleton connection managed correctly across Next.js API route invocations (not reconnecting per request), and a test strategy for it (point vitest at the compose Redis, or an in-memory mock). That's real scope beyond what YAN-12 asked for.

**Options:**
- Option A: Redis now, in this ticket — add the client, the compose service, and a small generic `RedisCache` wrapper; `CachingCatalogClient` is built on top of it.
- Option B: In-memory now, matching the ticket's original scope — but `CachingCatalogClient` takes a small generic `Cache` interface (`get`/`set`/`getOrSet`) as a constructor argument, so swapping in a `RedisCache` later is a one-line change at the wiring site in `conversation-dependencies.ts`, not a rewrite. Redis becomes its own follow-up ticket once this one's shipped. (Recommended — ships today's actual ask, keeps the door open, doesn't block this ticket on infra decisions)

>

---

### F2. If Redis (Option A): how generic should the wrapper be?

**Options:**
- Option A: Scoped narrowly — a `RedisCatalogCache` used only by the catalog decorator, nothing else touches it
- Option B: A genuinely generic `RedisCache<T>` with a `getOrSet(key, ttlSeconds, fetcher): Promise<T>` shape, reusable later for `ReplyCompletionCache` or other domains (matches your "generic method for caching" ask literally, but is more upfront design surface)

>

---

### F3. Metrics, given no hosting platform is chosen yet

Since there's no AWS/GCP Redis provider in the picture yet (no deployment config in the repo at all), provider-level metrics aren't available regardless of which path F1 lands on.

**Options:**
- Option A: Simple in-app hit/miss counters for now (logged and/or exposed as a plain counter object usable from tests), and revisit provider/dashboard-level metrics once you actually pick a host (Recommended)
- Option B: Skip metrics entirely for this ticket

>

---
