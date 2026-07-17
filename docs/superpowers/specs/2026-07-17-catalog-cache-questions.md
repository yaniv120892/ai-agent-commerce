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

>

---

## 2. TTL values

The ticket suggests 5–15 min for list/search endpoints and a longer TTL for product-detail/compare lookups (stable IDs). Pick concrete numbers:

**Options:**
- Option A: 10 min for `searchProducts`/`listCategoryProducts`/`listProducts`; 60 min for `getProduct`/`listCategorySlugs` (Recommended)
- Option B: 5 min / 30 min
- Option C: Custom values (specify below)

>

---

## 3. Max cache size (LRU eviction cap)

The ticket calls out unbounded search-term growth as a memory risk. What's the entry cap?

**Options:**
- Option A: 500 entries total, single shared LRU (Recommended)
- Option B: Separate caps per bucket (e.g. 300 list/search + 200 detail)
- Option C: Custom number (specify below)

>

---

## 4. Configurability

Should TTL/max-size be hardcoded constants in the new module, or environment-configurable via `src/lib/env.ts` (matching the existing `DUMMYJSON_BASE_URL`/`DUMMYJSON_TIMEOUT_MS` pattern)?

**Options:**
- Option A: Hardcoded constants in the new module — no new env vars, simplest (Recommended)
- Option B: Environment-configurable (adds `CATALOG_CACHE_*` env vars with defaults)

>

---

## 5. New dependency: `lru-cache`

The ticket explicitly suggests the `lru-cache` npm package (matches the repo's "prefer established packages" rule). This adds a new runtime dependency to `package.json`. Confirm you want it installed, versus a ~30-line hand-rolled `Map` + TTL (no new dependency, but reimplements LRU eviction).

**Options:**
- Option A: Add `lru-cache` npm package (Recommended)
- Option B: Hand-roll a small Map-based TTL+LRU with no new dependency

>

---

## 6. Negative-result caching (404 / errors)

The ticket says to cache only successful, schema-validated responses, and never cache `UPSTREAM_UNAVAILABLE`/`INVALID_UPSTREAM_PAYLOAD`. That leaves one edge case: `getProduct` throwing `NOT_FOUND` (404) for a bad/deleted product ID. Should a repeated lookup of a nonexistent ID keep hitting DummyJSON every time, or should we negative-cache 404s too?

**Options:**
- Option A: Never cache any thrown `CatalogError`, including `NOT_FOUND` — simplest, matches ticket wording literally (Recommended)
- Option B: Also negative-cache `NOT_FOUND` (shorter TTL, e.g. 1 min) to stop repeated-miss hammering

>

---

## 7. Observability

Do you want hit/miss counters or logging exposed anywhere (e.g. for future monitoring), or is that out of scope for this ticket?

**Options:**
- Option A: Out of scope — just the cache behavior, no metrics (Recommended)
- Option B: Add basic hit/miss counters accessible for tests/monitoring

>

---
