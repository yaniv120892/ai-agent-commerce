import { describe, expect, it } from "vitest";

import type { ModelPlanInput } from "@/domain/chat/types";

import {
  DeterministicModelClient,
  FixtureCatalogClient,
  fixtureCatalog,
} from "./deterministic-clients";

function createInput(overrides: Partial<ModelPlanInput> = {}): ModelPlanInput {
  return {
    activeContext: null,
    allowedCategorySlugs: ["smartphones", "laptops", "tablets"],
    history: [],
    priorProductIds: [],
    repairContext: null,
    userMessage: "show phones",
    ...overrides,
  };
}

describe("DeterministicModelClient continuation handling", () => {
  it("replays the anchor message's category as a continuation when the user asks for more", async () => {
    const client = new DeterministicModelClient();

    const plan = await client.createRetrievalPlan(
      createInput({
        activeContext: {
          categorySlug: "smartphones",
          continuationExhausted: false,
          focusedProductId: null,
          lastAttemptedSearch: null,
          lastResolvedUserMessage: "show phones under $400",
        },
        userMessage: "show me more",
      }),
    );

    expect(plan).toMatchObject({
      categorySlug: null,
      intent: "search",
      isContinuation: true,
      maxPrice: 400,
      searchTerms: ["phone"],
    });
  });

  it("recognizes the Hebrew continuation phrase and replays a bare category anchor as a browse", async () => {
    const client = new DeterministicModelClient();

    const plan = await client.createRetrievalPlan(
      createInput({
        activeContext: {
          categorySlug: "smartphones",
          continuationExhausted: false,
          focusedProductId: null,
          lastAttemptedSearch: null,
          lastResolvedUserMessage: "smartphones",
        },
        userMessage: "יש עוד",
      }),
    );

    expect(plan).toMatchObject({
      categorySlug: "smartphones",
      intent: "browse_category",
      isContinuation: true,
    });
  });

  it("filters the continuation phrase out of attribute terms when no anchor is available to replay", async () => {
    const client = new DeterministicModelClient();

    // activeContext.categorySlug is set (e.g. from a product_detail turn's single-category
    // card) but lastResolvedUserMessage is null, so there is nothing to replay and the
    // current message is parsed directly instead of being treated as a continuation.
    const plan = await client.createRetrievalPlan(
      createInput({
        activeContext: {
          categorySlug: "smartphones",
          continuationExhausted: false,
          focusedProductId: null,
          lastAttemptedSearch: null,
          lastResolvedUserMessage: null,
        },
        userMessage: "show me another one",
      }),
    );

    expect(plan.searchTerms).not.toContain("another");
    expect(plan.isContinuation).toBe(false);
  });

  it("falls back to a plain plan for the current message when there is no active context to replay", async () => {
    const client = new DeterministicModelClient();

    const plan = await client.createRetrievalPlan(
      createInput({ activeContext: null, userMessage: "show me more" }),
    );

    expect(plan).toMatchObject({
      intent: "clarify",
      isContinuation: false,
    });
  });

  it("sets isContinuation to false for an ordinary fresh request", async () => {
    const client = new DeterministicModelClient();

    const plan = await client.createRetrievalPlan(
      createInput({ userMessage: "show phones" }),
    );

    expect(plan.isContinuation).toBe(false);
  });
});

describe("fixtureCatalog", () => {
  it("has more than six smartphones so a continuation can reveal a non-overlapping remainder", async () => {
    const catalogClient = new FixtureCatalogClient();
    const smartphones = await catalogClient.listCategoryProducts("smartphones");

    expect(smartphones.length).toBeGreaterThan(6);
    expect(new Set(fixtureCatalog.map((product) => product.id)).size).toBe(
      fixtureCatalog.length,
    );
  });
});
