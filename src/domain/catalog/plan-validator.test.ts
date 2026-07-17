import { describe, expect, it } from "vitest";

import { PlanValidator } from "./plan-validator";
import type { RetrievalPlan } from "./types";

function createPlan(overrides: Partial<RetrievalPlan> = {}): RetrievalPlan {
  return {
    intent: "search",
    searchTerms: ["phone"],
    categorySlug: null,
    maxPrice: null,
    minRating: null,
    inStock: null,
    sort: "relevance",
    isContinuation: false,
    referencedProductIds: [],
    assistantMessage: null,
    ...overrides,
  };
}

function createValidator() {
  return new PlanValidator(["smartphones", "laptops"]);
}

describe("PlanValidator", () => {
  it("marks a valid search plan as validated", () => {
    const validatedPlan = createValidator().validate(createPlan(), []);

    expect(validatedPlan).toMatchObject({
      intent: "search",
      searchTerms: ["phone"],
      validated: true,
    });
  });

  it("rejects a category not present in the category allowlist", () => {
    expect(() =>
      createValidator().validate(
        createPlan({
          categorySlug: "unapproved-category",
          intent: "browse_category",
          searchTerms: [],
        }),
        [],
      ),
    ).toThrowError(expect.objectContaining({ code: "INVALID_RETRIEVAL_PLAN" }));
  });

  it("rejects a product reference outside the prior conversation", () => {
    expect(() =>
      createValidator().validate(
        createPlan({
          intent: "product_detail",
          referencedProductIds: [12],
          searchTerms: [],
        }),
        [10, 11],
      ),
    ).toThrowError(expect.objectContaining({ code: "INVALID_RETRIEVAL_PLAN" }));
  });

  it("names the offending product IDs in the rejection reason", () => {
    expect(() =>
      createValidator().validate(
        createPlan({
          intent: "product_detail",
          referencedProductIds: [12],
          searchTerms: [],
        }),
        [10, 11],
      ),
    ).toThrowError(/12/u);
  });

  it("rejects a clarify plan carrying search terms", () => {
    expect(() =>
      createValidator().validate(
        createPlan({ assistantMessage: "Which one?", intent: "clarify" }),
        [],
      ),
    ).toThrowError(expect.objectContaining({ code: "INVALID_RETRIEVAL_PLAN" }));
  });

  it("rejects an unsupported plan carrying a category", () => {
    expect(() =>
      createValidator().validate(
        createPlan({
          assistantMessage: "Out of catalog.",
          categorySlug: "smartphones",
          intent: "unsupported",
          searchTerms: [],
        }),
        [],
      ),
    ).toThrowError(expect.objectContaining({ code: "INVALID_RETRIEVAL_PLAN" }));
  });

  it("rejects a category browse plan carrying search terms", () => {
    expect(() =>
      createValidator().validate(
        createPlan({ categorySlug: "smartphones", intent: "browse_category" }),
        [],
      ),
    ).toThrowError(expect.objectContaining({ code: "INVALID_RETRIEVAL_PLAN" }));
  });

  it("rejects a search plan carrying a product reference", () => {
    expect(() =>
      createValidator().validate(
        createPlan({ referencedProductIds: [1] }),
        [1],
      ),
    ).toThrowError(expect.objectContaining({ code: "INVALID_RETRIEVAL_PLAN" }));
  });

  it("rejects a comparison plan carrying search terms", () => {
    expect(() =>
      createValidator().validate(
        createPlan({ intent: "compare", referencedProductIds: [1, 2] }),
        [1, 2],
      ),
    ).toThrowError(expect.objectContaining({ code: "INVALID_RETRIEVAL_PLAN" }));
  });

  it("rejects a clarify plan without an assistant message", () => {
    expect(() =>
      createValidator().validate(
        createPlan({
          assistantMessage: null,
          intent: "clarify",
          searchTerms: [],
        }),
        [],
      ),
    ).toThrowError(expect.objectContaining({ code: "INVALID_RETRIEVAL_PLAN" }));
  });

  it("rejects an unsupported plan without an assistant message", () => {
    expect(() =>
      createValidator().validate(
        createPlan({
          assistantMessage: null,
          intent: "unsupported",
          searchTerms: [],
        }),
        [],
      ),
    ).toThrowError(expect.objectContaining({ code: "INVALID_RETRIEVAL_PLAN" }));
  });

  it("accepts a clarify plan carrying only an assistant message", () => {
    const validatedPlan = createValidator().validate(
      createPlan({
        assistantMessage: "Which phone did you mean?",
        intent: "clarify",
        searchTerms: [],
      }),
      [],
    );

    expect(validatedPlan).toMatchObject({
      assistantMessage: "Which phone did you mean?",
      intent: "clarify",
      validated: true,
    });
  });

  it("rejects a plan whose fields fail the schema", () => {
    expect(() =>
      createValidator().validate(createPlan({ minRating: 9 }), []),
    ).toThrowError(expect.objectContaining({ code: "INVALID_RETRIEVAL_PLAN" }));
  });

  it("accepts a continuation search plan", () => {
    const validatedPlan = createValidator().validate(
      createPlan({ isContinuation: true }),
      [],
    );

    expect(validatedPlan).toMatchObject({
      isContinuation: true,
      validated: true,
    });
  });

  it.each(["product_detail", "compare", "clarify", "unsupported"] as const)(
    "rejects a continuation flag on a %s plan",
    (intent) => {
      const basePlan =
        intent === "product_detail"
          ? createPlan({
              intent,
              isContinuation: true,
              referencedProductIds: [1],
              searchTerms: [],
            })
          : intent === "compare"
            ? createPlan({
                intent,
                isContinuation: true,
                referencedProductIds: [1, 2],
                searchTerms: [],
              })
            : createPlan({
                assistantMessage: "Which one?",
                intent,
                isContinuation: true,
                searchTerms: [],
              });
      const priorProductIds = intent === "compare" ? [1, 2] : [1];

      expect(() =>
        createValidator().validate(basePlan, priorProductIds),
      ).toThrowError(
        expect.objectContaining({ code: "INVALID_RETRIEVAL_PLAN" }),
      );
    },
  );
});
