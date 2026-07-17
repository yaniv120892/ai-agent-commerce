# YAN-19 — Bounded Plan Repair

**Status:** approved, pending implementation
**Ticket:** [YAN-19](https://linear.app/yaniv-daye-personal/issue/YAN-19/no-plan-repair-loop-a-single-validation-miss-is-terminal-for-the-user)
**Related:** YAN-17 (plan schema duplicated at two strictnesses), YAN-15 (model error taxonomy)

## Problem

When the model returns a retrieval plan that fails validation, the failure is terminal. `ChatService.generateReply` catches `CatalogError`, marks the assistant message failed, and shows an error. The model never sees the validator's reason, even though that reason is precise and actionable (*"Search plans require text and no product references"*). The user's only recourse is a manual retry that re-runs the same prompt and usually fails the same way.

Add exactly one bounded repair attempt: on validation failure, re-prompt the planner once with the validator's error, then re-validate. Surface a failure only after the second miss.

## Current shape

`CatalogResolver.resolve()` fuses validation and retrieval — `validatePlan` runs first, inside it. `ChatService` learns "plan invalid" only by catching `CatalogError` with code `INVALID_RETRIEVAL_PLAN` after calling `resolve()`, which entangles validation failures with retrieval failures.

Two distinct terminal validation misses exist today:

1. `chat-service.ts` resolve-catch — `CatalogError`/`INVALID_RETRIEVAL_PLAN` from the resolver.
2. `chat-service.ts` clarify branch — a `clarify`/`unsupported` plan with `assistantMessage === null`, which fails without ever touching `CatalogError`.

Because the clarify branch short-circuits before the resolver, `validateIntentFields`'s clarify/unsupported case never runs in production.

The offline and online eval scripts do **not** go through `ChatService`. They construct `DeterministicModelClient` and `CatalogResolver` directly and call `createRetrievalPlan` then `resolve` themselves. They set `planValid = true` only after `resolve()` succeeds, so today `planValid` conflates "the plan was valid" with "retrieval succeeded".

This last point drives the design: repair must live in a unit the eval scripts can construct directly, or the ticket's "eval measures first-pass validity separately" criterion is unreachable.

## Design

### PlanValidator — `src/domain/catalog/plan-validator.ts`

A new unit owning every rule the model is judged against. Constructor takes `allowedCategorySlugs: string[]`. One public method:

```ts
public validate(
  plan: RetrievalPlan,
  priorProductIds: number[],
): ValidatedRetrievalPlan
```

Throws `CatalogError("INVALID_RETRIEVAL_PLAN", reason)` where `reason` is the existing human-readable message. It absorbs, moved from `CatalogResolver` without behavior change: the strict `retrievalPlanSchema`, `validateIntentFields`, `hasFilters`, `throwInvalidPlan`, the category-allowlist check, and the prior-product-reference check.

It gains one rule that does not exist today:

> `clarify` and `unsupported` plans must carry a non-null `assistantMessage`.

This promotes the ad-hoc `chat-service.ts` check into the validator, which is what puts that failure on the repair path. It also means clarify/unsupported plans are validated at all for the first time.

No catalog client dependency — tests standalone.

### ValidatedRetrievalPlan

```ts
export type ValidatedRetrievalPlan = RetrievalPlan & { readonly validated: true };
```

A nominal type, constructed cast-free by spreading the parsed plan:

```ts
return { ...parsedPlan.data, validated: true };
```

Making it a compile error to hand `CatalogResolver` an unvalidated plan. Cost: a synthetic `validated` field on the object.

Deliberately **not** a discriminated union. The validator guarantees `assistantMessage` is non-null for clarify plans, but the type still says `string | null`, so `ChatService` keeps its null guard. That guard becomes defensive rather than load-bearing. Narrowing it away would mean splitting `ValidatedRetrievalPlan` into per-intent variants — a larger change than this ticket warrants.

`repairContext.rejectedPlan` carries the raw `RetrievalPlan`, never a `ValidatedRetrievalPlan`, so the synthetic field never reaches the model prompt.

### CatalogResolver shrinks

Loses `validatePlan`, `validateIntentFields`, `hasFilters`, `throwInvalidPlan`, and the strict schema. Keeps retrieval and ranking. Signature becomes:

```ts
public async resolve(
  plan: ValidatedRetrievalPlan,
  priorProductIds: number[],
): Promise<ResolvedCatalogResult>
```

It no longer validates, and no longer decides whether the model behaved. Per the approved Q2 answer it does not re-validate defensively; the nominal type is the guarantee.

### PlanRepairService — `src/domain/chat/plan-repair-service.ts`

Lives in `chat` rather than `catalog` because it orchestrates a model call. Depends on `ModelClient` and `PlanValidator`. One public method:

```ts
public async createValidPlan(
  input: ModelPlanInput,
): Promise<PlanAttemptOutcome>
```

```ts
export type PlanAttemptOutcome = {
  plan: ValidatedRetrievalPlan;
  firstPassValid: boolean;
  repairAttempted: boolean;
};
```

Behavior:

1. Call `createRetrievalPlan(input)`, validate.
2. On success, return `{ plan, firstPassValid: true, repairAttempted: false }`.
3. On `CatalogError`, call `createRetrievalPlan({ ...input, repairContext })` once, validate.
4. On success, return `{ plan, firstPassValid: false, repairAttempted: true }`.
5. On a second `CatalogError`, rethrow the **second** attempt's error.

Model transport errors propagate untouched, so `ChatService` can still distinguish `MODEL_UNAVAILABLE` from `INVALID_RETRIEVAL_PLAN`. A transport error on the repair attempt surfaces as `MODEL_UNAVAILABLE`, not as a plan failure.

"Exactly one repair attempt, never a loop" is structural: two straight-line calls, no loop construct to bound.

### ModelPlanInput gains repairContext

```ts
export type PlanRepairContext = {
  rejectedPlan: RetrievalPlan;
  validationError: string;
};

export type ModelPlanInput = {
  // ...existing fields
  repairContext: PlanRepairContext | null;
};
```

`OpenAIModelClient.createRetrievalPlan` folds it into the prompt when non-null, instructing the model that its previous plan was rejected, showing the rejected plan JSON and the validator's reason, and asking for a corrected plan. Restating the schema bounds in the prompt is explicitly YAN-17's job, not this ticket's.

`DeterministicModelClient` ignores `repairContext` — it never emits invalid plans, so the E2E and eval paths never exercise repair. The repair unit tests use purpose-built stubs instead. This is a deliberate choice, documented in the fake.

### ChatService.generateReply gets thinner

One `createValidPlan` call replaces the plan call, the null-`assistantMessage` guard's failure branch, and the `INVALID_RETRIEVAL_PLAN` branch of the resolve catch:

```
outcome = await planRepairService.createValidPlan({ ...context, repairContext: null })
  catch -> failAssistantMessage(resolvePlanFailureCode(error), ...)
log { event: "plan_validation", firstPassValid, repairAttempted }
if intent is clarify|unsupported -> completeAssistantMessage(plan.assistantMessage, [])
resolve(plan) catch -> CATALOG_UNAVAILABLE
createGroundedReply -> completeAssistantMessage
```

`resolvePlanFailureCode` is a private method returning `INVALID_RETRIEVAL_PLAN` for a `CatalogError` with that code, `MODEL_UNAVAILABLE` otherwise. The resolve catch collapses to `CATALOG_UNAVAILABLE` only, since a validated plan can no longer fail validation.

`ChatService` loses its `allowedCategorySlugs` constructor argument — `PlanRepairService` owns that now, and passes it into `ModelPlanInput`.

### Observability

Two surfaces, neither requiring new infrastructure:

- **In-band:** `PlanAttemptOutcome.firstPassValid` / `.repairAttempted`. This is what the eval scripts read, since they bypass `ChatService`.
- **Log:** one structured `console` line from `ChatService` — `{ event: "plan_validation", firstPassValid, repairAttempted }`. Consistent with existing `console` use in `http-errors.ts` and `caching-catalog-client.ts`. No logger module is built.

### Eval changes

`EvaluationCaseResult` gains:

```ts
firstPassPlanValid: boolean;
repairAttempted: boolean;
```

rolled into `EvaluationReport.summary`. `eval-offline.ts` and `eval-online.ts` construct `PlanValidator` + `PlanRepairService` and call `createValidPlan` instead of hand-rolling plan-then-resolve. `planValid` keeps its current meaning (the case produced a usable plan, post-repair); `firstPassPlanValid` is the new first-attempt signal.

Per the approved Q7 answer, a first-pass validity drop is reported, not failed on — repair rescuing a case still passes.

### Wiring

`conversation-dependencies.ts` constructs `PlanValidator(allowedCategorySlugs)`, then `PlanRepairService(modelClient, planValidator)`, then passes that to `ChatService` in place of `allowedCategorySlugs`. The existing inline category allowlist stays where it is and becomes `PlanValidator`'s sole consumer.

`CatalogResolver`'s constructor drops its `allowedCategorySlugs` argument — the allowlist check moves wholesale to `PlanValidator`, leaving the resolver with only its catalog client. Note this is a constructor signature change at every construction site, including both eval scripts.

## Decisions

| Question | Decision |
| --- | --- |
| Where repair lives | Dedicated `PlanRepairService` — the only option the eval scripts can construct directly |
| Validation extraction | Full extraction to `PlanValidator`; resolver does not re-validate |
| clarify/null-assistantMessage | In scope — becomes a validator rule, repaired by the same mechanism |
| Repair prompt shape | Optional `repairContext` on `ModelPlanInput` |
| Repair prompt content | Validator error + rejected plan JSON; restating bounds is YAN-17 |
| Observability | In-band on `PlanAttemptOutcome` + one structured console line |
| Eval fields | Add `firstPassPlanValid` + `repairAttempted`; report, don't fail |
| Deadline guardrail | Skipped — see Accepted trade-offs |
| Retry state machine | Unchanged; repair is in-request |
| Type enforcement | Nominal `ValidatedRetrievalPlan`, not a discriminated union |

## Accepted trade-offs

**Worst-case planning latency roughly doubles on the repair path.** No request deadline exists — only `catalog-client.ts` uses `AbortSignal` — so the ticket's "must respect the same request deadline" guardrail has nothing to hang on. Each model call is independently bounded by `OPENAI_TIMEOUT_MS` (default 20000) with `OPENAI_MAX_RETRIES` (default 1), so the repair path's worst case is roughly 20s to 40s. Bounded and accepted; the timeout ticket can wrap this later without redesign.

**The clarify null guard in `ChatService` becomes unreachable in practice.** Kept as defensive depth rather than expanding `ValidatedRetrievalPlan` into per-intent variants.

**The deterministic client never exercises repair.** E2E and eval coverage of the repair path is therefore nil by construction; unit tests carry it.

## Testing

**`plan-validator.test.ts`** — validation cases moved from `catalog-resolver.test.ts`, plus the new clarify/unsupported non-null `assistantMessage` rule.

**`plan-repair-service.test.ts`** — the two the ticket names, plus two guardrails:

- invalid → repaired → success; asserts `firstPassValid: false`, `repairAttempted: true`, and that the second call carried `repairContext` with the first attempt's error.
- invalid → invalid → `CatalogError("INVALID_RETRIEVAL_PLAN")` carrying the **second** attempt's reason; asserts exactly two model calls.
- valid first pass → exactly one model call, `repairAttempted: false`.
- model transport error → propagates, surfaces as `MODEL_UNAVAILABLE`, not a plan failure.

**`catalog-resolver.test.ts`** — validation cases removed; retrieval and ranking cases keep passing against `ValidatedRetrievalPlan` inputs.

**`chat-service.test.ts`** — updated wiring; asserts the resolve catch now yields `CATALOG_UNAVAILABLE` only.

Per the repo convention, tests assert structured effects and invariants, not assistant wording.

## Documentation

CLAUDE.md's "Retrieval/plan boundary" section states that `CatalogResolver` validates the plan. That stops being true and must be updated in the same change, per CLAUDE.md's own maintenance rule. README's retrieval-policy section needs the same check.

## Out of scope

- Deduplicating the loose planner schema against the strict validator schema (YAN-17).
- Splitting `MODEL_UNAVAILABLE` into a real error taxonomy (YAN-15).
- Any request deadline or budget mechanism.
- More than one repair attempt, under any condition.
