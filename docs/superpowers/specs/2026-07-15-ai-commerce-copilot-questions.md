# Brainstorming Questions: AI Commerce Copilot

Please answer each question below in your own words. Short answers are fine; we will use them to choose an architecture you can confidently defend in the interview.

---

## 1. Primary goal

What matters most for this submission?

**Options:**
- A: A polished, memorable product experience.
- B: A small, reliable system with exceptionally clear technical reasoning.
- C: A balanced prototype: polished enough to demonstrate, simple enough to defend.

> C — A balanced prototype: polished enough to demonstrate, simple enough to defend.

---

## 2. Preferred learning depth

Which areas should we study deeply before choosing an implementation?

**Options:**
- A: LLM agents and tool calling.
- B: Frontend/chat UX and product-card rendering.
- C: Persistence, testing, and production-like resilience.
- D: All three, with an incremental explanation of each.

> A, C, and D — LLM agents/tool calling; persistence, testing, and resilience; and an incremental explanation of all areas.

---

## 3. Framework appetite

How much framework complexity are you comfortable owning in an interview?

**Options:**
- A: Minimal dependencies; build the control flow ourselves.
- B: A light AI SDK for streaming/tool-call ergonomics, while owning the application logic.
- C: An agent framework such as LangChain or Mastra, accepting more abstraction.

> Unclear on the distinction between B and C; requires explanation before choosing.

---

## 4. Persistence boundary

For a locally runnable assignment, what trade-off sounds most appropriate?

**Options:**
- A: Browser-only persistence for the smallest deployable prototype.
- B: A local database, to show client/server state boundaries and stronger recovery.
- C: Choose after comparing the actual complexity and failure handling.

> PostgreSQL in Docker Compose — a server-owned relational database with migrations and a dedicated test database. This replaces the earlier SQLite recommendation because the project prioritizes a production-shaped, reproducible local boundary.

---

## 5. Scope boundaries

Should the copilot only discover products, or should it also support follow-up comparison, filtering by price/category, and individual product details when natural in conversation?

> Support follow-up conversation. Defer cross-conversation preference memory from v1. Persist product-card snapshots as the historical recommendation record; a live freshness check for changed price or availability is a possible later enhancement, not part of v1.

---

## 6. Time and submission constraints

How much time do you want to reserve for implementation versus explanation, tests, and README rehearsal? Also tell me whether you have a preferred frontend stack or language.

> Time is not a constraint. Spend most effort on the specification and plan; split implementation into tickets and use subagents. Cover deterministic flows plus offline and online evaluation for non-deterministic flows. TypeScript is preferred; choosing between Next.js and React, with a possible Next.js BFF.

---

## 7. Interview posture

Would you rather optimize for a deliberately constrained design you can explain line-by-line, or include one ambitious capability (for example, streamed tool calls or rich follow-up filtering) and defend its complexity?

> Prefer a constrained design that can be explained line-by-line conceptually, rather than an ambitious opaque capability.

---

## Follow-ups

### F1. Preference memory boundary

What should “remember the user's style” mean in this local, no-login assignment?

**Options:**
- A: Remember only explicit preferences the user states (for example, budget, favourite categories, brands) and show/edit them in the UI.
- B: Infer preferences from viewed/recommended products as well as explicit statements.
- C: Both, but label inferred preferences and let the user correct/delete them.

> Defer preference memory from the initial scope. It may be added later.

---

### F2. Privacy and deletion behaviour

Should the user be able to delete one conversation and/or clear all locally stored conversations and preferences from the UI?

**Options:**
- A: New conversation and delete individual conversations only.
- B: New conversation, delete individual conversations, and a “clear all local data” control.
- C: Keep scope narrower; only new conversation and history list.

> C — Keep scope narrower; only new conversation and history list.

---

### F3. Model-response delivery

Which experience should we target for assistant replies?

**Options:**
- A: Non-streaming responses: simpler state, error handling, and tests.
- B: Stream text while product cards appear only after the tool result is validated: more polished, moderately more complex.
- C: Decide after seeing the implementation and test impact.

> C — Decide after seeing the implementation and test impact.
