import { describe, expect, it, vi } from "vitest";

import { PlanValidator } from "../catalog/plan-validator";
import type { RetrievalPlan } from "../catalog/types";

import { PlanRepairService } from "./plan-repair-service";
import type { ModelPlanInput, PlanRequestInput } from "./types";

const allowedCategorySlugs = ["smartphones", "laptops"];

function createPlan(overrides: Partial<RetrievalPlan> = {}): RetrievalPlan {
  return {
    intent: "search",
    searchTerms: ["phone"],
    categorySlug: null,
    maxPrice: null,
    minRating: null,
    inStock: null,
    sort: "relevance",
    referencedProductIds: [],
    assistantMessage: null,
    ...overrides,
  };
}

function createInvalidPlan(): RetrievalPlan {
  return createPlan({ referencedProductIds: [999], searchTerms: [] });
}

function createRequest(
  overrides: Partial<PlanRequestInput> = {},
): PlanRequestInput {
  return {
    activeContext: null,
    allowedCategorySlugs,
    history: [],
    priorProductIds: [],
    userMessage: "show me a phone",
    ...overrides,
  };
}

function createService(
  createRetrievalPlan: (input: ModelPlanInput) => Promise<RetrievalPlan>,
) {
  const modelClient = { createRetrievalPlan: vi.fn(createRetrievalPlan) };
  const service = new PlanRepairService(
    modelClient,
    (categorySlugs) => new PlanValidator(categorySlugs),
  );

  return { modelClient, service };
}

describe("PlanRepairService", () => {
  it("returns a first-pass plan without attempting repair", async () => {
    const { modelClient, service } = createService(async () => createPlan());

    const outcome = await service.createValidPlan(createRequest());

    expect(outcome).toMatchObject({
      firstPassValid: true,
      repairAttempted: false,
    });
    expect(outcome.plan.validated).toBe(true);
    expect(modelClient.createRetrievalPlan).toHaveBeenCalledOnce();
  });

  it("passes no repair context on the first attempt", async () => {
    const { modelClient, service } = createService(async () => createPlan());

    await service.createValidPlan(createRequest());

    expect(modelClient.createRetrievalPlan).toHaveBeenCalledWith(
      expect.objectContaining({ repairContext: null }),
    );
  });

  it("repairs an invalid first plan and reports the repair", async () => {
    const { modelClient, service } = createService(async (input) =>
      input.repairContext === null ? createInvalidPlan() : createPlan(),
    );

    const outcome = await service.createValidPlan(createRequest());

    expect(outcome).toMatchObject({
      firstPassValid: false,
      repairAttempted: true,
    });
    expect(outcome.plan).toMatchObject({ intent: "search", validated: true });
    expect(modelClient.createRetrievalPlan).toHaveBeenCalledTimes(2);
  });

  it("carries the rejected plan and validator reason into the repair attempt", async () => {
    const { modelClient, service } = createService(async (input) =>
      input.repairContext === null ? createInvalidPlan() : createPlan(),
    );

    await service.createValidPlan(createRequest());

    expect(modelClient.createRetrievalPlan).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        repairContext: {
          rejectedPlan: createInvalidPlan(),
          validationError: expect.stringContaining("Search plans require text"),
        },
      }),
    );
  });

  it("fails with the second attempt's reason after two invalid plans", async () => {
    const { modelClient, service } = createService(async (input) =>
      input.repairContext === null
        ? createInvalidPlan()
        : createPlan({
            categorySlug: "not-a-category",
            intent: "browse_category",
            searchTerms: [],
          }),
    );

    await expect(service.createValidPlan(createRequest())).rejects.toThrowError(
      expect.objectContaining({
        code: "INVALID_RETRIEVAL_PLAN",
        message: expect.stringContaining("unapproved category"),
      }),
    );
    expect(modelClient.createRetrievalPlan).toHaveBeenCalledTimes(2);
  });

  it("never attempts more than one repair", async () => {
    const { modelClient, service } = createService(async () =>
      createInvalidPlan(),
    );

    await expect(service.createValidPlan(createRequest())).rejects.toThrowError(
      expect.objectContaining({ code: "INVALID_RETRIEVAL_PLAN" }),
    );
    expect(modelClient.createRetrievalPlan).toHaveBeenCalledTimes(2);
  });

  it("propagates a model transport failure on the first attempt", async () => {
    const { modelClient, service } = createService(async () => {
      throw new Error("openai unavailable");
    });

    await expect(service.createValidPlan(createRequest())).rejects.toThrowError(
      "openai unavailable",
    );
    expect(modelClient.createRetrievalPlan).toHaveBeenCalledOnce();
  });

  it("propagates a model transport failure raised by the repair attempt", async () => {
    const { service } = createService(async (input) => {
      if (input.repairContext === null) {
        return createInvalidPlan();
      }

      throw new Error("openai unavailable");
    });

    await expect(service.createValidPlan(createRequest())).rejects.toThrowError(
      "openai unavailable",
    );
  });

  it("validates against the prior product IDs of the request", async () => {
    const { service } = createService(async () =>
      createPlan({
        intent: "product_detail",
        referencedProductIds: [7],
        searchTerms: [],
      }),
    );

    const outcome = await service.createValidPlan(
      createRequest({ priorProductIds: [7] }),
    );

    expect(outcome.firstPassValid).toBe(true);
    expect(outcome.plan).toMatchObject({
      intent: "product_detail",
      referencedProductIds: [7],
    });
  });
});
