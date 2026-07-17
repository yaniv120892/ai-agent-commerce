# Brainstorming Questions: YAN-19 — Bounded Plan Repair

Please answer each question below and let me know when done.

Context I gathered before writing these:

- `CatalogResolver.resolve()` fuses validation and retrieval — `validatePlan` runs first inside it, so `ChatService` currently learns "plan invalid" only by catching `CatalogError` with code `INVALID_RETRIEVAL_PLAN` (`chat-service.ts:242-254`).
- There is no logger, metrics, or telemetry anywhere in `src/`. `http-errors.ts` and `caching-catalog-client.ts` use bare `console`.
- There is no request deadline/timeout wrapper. Only `catalog-client.ts` uses `AbortSignal`. The ticket's guardrail "must respect the same request deadline (see the timeout ticket)" depends on something not yet built.
- `chat-service.ts:216` short-circuits `clarify`/`unsupported` before the resolver, so `validateIntentFields`'s clarify/unsupported branch never runs in production, and a `clarify` plan with `assistantMessage === null` fails terminally without going through `CatalogError`.
- The offline eval report (`scenario-evaluation.types.ts`) already tracks a per-case `planValid: boolean`.

---

## 1. Where should the repair decision live?

**Options:**

- **Option A — `ChatService` orchestrates.** Make plan validation callable independently (e.g. `CatalogResolver.validatePlan` becomes public, or a new `PlanValidator` unit), so `ChatService` does: plan → validate → (on failure) re-prompt once → validate → resolve. Retrieval only ever runs on a validated plan. Repair policy sits with the orchestrator that already owns model calls and persistence.
- **Option B — catch-and-retry around `resolve()`.** Keep `resolve()` as-is; `ChatService` catches `INVALID_RETRIEVAL_PLAN`, re-prompts, calls `resolve()` again. Smallest diff, no API change. Risk: validation errors and retrieval errors stay entangled, and any future `INVALID_RETRIEVAL_PLAN` thrown after a network call would cause a duplicate fetch.
- **Option C — a dedicated `PlanRepairService` / collaborator.** `ChatService` delegates "give me a valid plan" to a unit that owns the plan→validate→repair→validate loop and returns either a valid plan or a typed failure. Keeps `ChatService.generateReply` thin; the repair policy becomes independently testable.

>

---

## 2. Should validation move out of `CatalogResolver` entirely?

Extracting a `PlanValidator` (schema + intent-field rules + category allowlist + prior-product-reference check) would give one unit with one purpose, testable without a catalog client, and would let `clarify`/`unsupported` plans be validated too (they currently bypass it). It also sets up YAN-17's schema de-duplication.

**Options:**

- Option A: Yes — extract `PlanValidator`; `CatalogResolver` keeps only retrieval + ranking and accepts an already-validated plan.
- Option B: Yes, but keep `CatalogResolver.resolve()` validating defensively too (belt-and-braces; double validation cost is trivial).
- Option C: No — leave validation inside `CatalogResolver`, just expose it.
- Option D: Out of scope for YAN-19 — do the minimum here, extract in YAN-17.

>

---

## 3. Does the repair path also cover the `clarify`/`unsupported` `assistantMessage === null` failure?

That's the other terminal validation miss (`chat-service.ts:216-224`) — the model returned a non-retrieval intent but no message to show. It's equally repairable ("you returned clarify with no assistantMessage").

**Options:**

- Option A: Yes — route it through the same repair attempt.
- Option B: No — keep YAN-19 scoped strictly to `CatalogError`/`INVALID_RETRIEVAL_PLAN` as the ticket says; file a follow-up.

>

---

## 4. How should the repair re-prompt be shaped?

**Options:**

- **Option A — extend `ModelPlanInput`** with an optional `repairContext: { rejectedPlan: RetrievalPlan; validationError: string } | null`. One method, one contract; `OpenAIModelClient` folds it into the developer/user message when present. `DeterministicModelClient` must handle it for E2E/eval.
- **Option B — a new `ModelClient.repairRetrievalPlan(input)` method.** Explicit and separately promptable, but widens the interface and every fake must implement it.
- **Option C — `ChatService` passes the error back as a synthetic history/user message.** No contract change, but smuggles control-plane data through conversation history — leaks into what the model thinks the user said.

>

---

## 5. What exactly does the repair prompt tell the model?

**Options:**

- Option A: The validator's error message only (e.g. *"Search plans require text and no product references"*).
- Option B: The error message plus the rejected plan JSON.
- Option C: The error message, the rejected plan, and an explicit restatement of the bounds it violated (ties into YAN-17 — telling the model the schema it's judged against).

>

---

## 6. "First-pass vs. repaired plan validity separately observable" — by what mechanism?

There is no logging/metrics infrastructure to build on, so this decides how much we're building.

**Options:**

- Option A: Structured `console` log lines (e.g. `{ event: "plan_validation", attempt: 1, valid: false, reason }`) — consistent with what the codebase already does, zero new infra.
- Option B: A minimal typed logger module in `src/lib/` that the domain depends on via an injected interface, wired through `conversation-dependencies.ts`.
- Option C: Return the attempt outcome in-band on `ChatResponse`/the resolver result so the eval harness reads it directly, no logging at all.
- Option D: Both a log line and an in-band field (dashboards read logs; evals read the field).

>

---

## 7. Should the offline eval report gain first-pass/repaired fields?

The report already has `planValid` per case. The ticket wants the eval suite to measure first-pass validity separately from post-repair validity.

**Options:**

- Option A: Yes — add `firstPassPlanValid` and `repairAttempted` to `EvaluationCaseResult`, and roll them into the summary.
- Option B: Yes, and treat a drop in *first-pass* validity as a failure signal even when repair rescues the case.
- Option C: No — keep eval output unchanged for now; observability via logs only.

>

---

## 8. What about the deadline guardrail, given no timeout infrastructure exists?

**Options:**

- Option A: Ignore deadlines in YAN-19; add a plain second attempt and let the timeout ticket wrap it later. Accepts a temporarily doubled worst-case latency on the repair path.
- Option B: Build a minimal deadline into this change (an `AbortSignal`/budget threaded from `ChatService` through the model client), skipping the repair if the budget is spent.
- Option C: Block YAN-19 on the timeout ticket and do that first.

>

---

## 9. Should a repair attempt be made on the *retry* path too?

`appendMessageWithPendingReply` is idempotent per `clientRequestId`, and the ticket says "never invoke the model twice for the same request ID". A repair attempt is, strictly, a second model call within one request ID.

**Options:**

- Option A: Repair is in-request and fine — the "never twice" rule is about duplicate *user-initiated retries*, not about internal repair. No change to the retry state machine.
- Option B: The repair attempt must be reflected in persistence somehow (e.g. the failed message records that repair was already spent) so a manual retry doesn't repeat it.
- Option C: Something else — explain.

>

---

## 10. Anything in the ticket you already consider settled and don't want re-litigated?

>

---
