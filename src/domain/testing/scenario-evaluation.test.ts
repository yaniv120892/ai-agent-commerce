import { describe, expect, it } from "vitest";

import { getFixtureProduct } from "./deterministic-clients";
import {
  checkConstraints,
  checkForbiddenBehavior,
  collectPriorProductIds,
  createHistory,
  hasSameIds,
} from "./scenario-evaluation";
import type { Scenario, ScenarioPlanSummary } from "./scenario-evaluation";

function createScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    currentInput: "Show phones under $400",
    expectedIntent: "search",
    fixtureCatalog: { productIds: [101, 102] },
    forbiddenBehavior: [],
    name: "test_scenario",
    priorMessages: [],
    requiredConstraints: {},
    ...overrides,
  };
}

function createPlanSummary(
  overrides: Partial<ScenarioPlanSummary> = {},
): ScenarioPlanSummary {
  return {
    assistantMessage: null,
    maxPrice: null,
    referencedProductIds: [],
    searchTerms: [],
    ...overrides,
  };
}

describe("hasSameIds", () => {
  it("matches identical ordered id lists", () => {
    expect(hasSameIds([101, 102], [101, 102])).toBe(true);
  });

  it("rejects lists of different length", () => {
    expect(hasSameIds([101], [101, 102])).toBe(false);
  });

  it("rejects lists with the same ids in a different order", () => {
    expect(hasSameIds([102, 101], [101, 102])).toBe(false);
  });
});

describe("checkConstraints", () => {
  it("only evaluates constraints declared on the scenario", () => {
    const scenario = createScenario({
      requiredConstraints: { maxPrice: 400 },
    });
    const checks = checkConstraints(
      scenario,
      createPlanSummary({ maxPrice: 400 }),
      [],
    );

    expect(checks).toEqual({ maxPrice: true });
  });

  it("reports a failing searchTerm constraint", () => {
    const scenario = createScenario({
      requiredConstraints: { searchTerm: "phone" },
    });
    const checks = checkConstraints(
      scenario,
      createPlanSummary({ searchTerms: ["laptop"] }),
      [],
    );

    expect(checks.searchTerm).toBe(false);
  });

  it("checks selectedProductIds against the resolved cards", () => {
    const scenario = createScenario({
      requiredConstraints: { selectedProductIds: [101, 102] },
    });

    expect(
      checkConstraints(scenario, createPlanSummary(), [101, 102])
        .selectedProductIds,
    ).toBe(true);
    expect(
      checkConstraints(scenario, createPlanSummary(), [101]).selectedProductIds,
    ).toBe(false);
  });
});

describe("checkForbiddenBehavior", () => {
  it("flags catalog retrieval when the scenario forbids it", () => {
    const failures = checkForbiddenBehavior(
      ["catalog_retrieval"],
      [],
      [101],
      null,
      new Set([101]),
    );

    expect(failures).toContain("forbidden catalog retrieval occurred");
  });

  it("flags a product priced above the plan's max price", () => {
    const failures = checkForbiddenBehavior(
      ["over_budget"],
      [{ price: 500 }],
      [101],
      400,
      new Set([101]),
    );

    expect(failures).toContain("selected product exceeds the requested budget");
  });

  it("flags a product outside the grounded set", () => {
    const failures = checkForbiddenBehavior(
      ["ungrounded_cards"],
      [],
      [999],
      null,
      new Set([101, 102]),
    );

    expect(failures).toContain(
      "selected product is not in the fixture catalog",
    );
  });

  it("returns no failures when nothing is forbidden", () => {
    const failures = checkForbiddenBehavior(
      [],
      [{ price: 999 }],
      [999],
      100,
      new Set(),
    );

    expect(failures).toEqual([]);
  });

  it("flags a null assistant message when the scenario forbids it", () => {
    const failures = checkForbiddenBehavior(
      ["invalid_assistant_message"],
      [],
      [],
      null,
      new Set(),
      null,
    );

    expect(failures).toContain("assistant message is not a usable reply: null");
  });

  it('flags the literal string "null" as an invalid assistant message', () => {
    const failures = checkForbiddenBehavior(
      ["invalid_assistant_message"],
      [],
      [],
      null,
      new Set(),
      "null",
    );

    expect(failures).toContain(
      'assistant message is not a usable reply: "null"',
    );
  });

  it("does not flag a real assistant message", () => {
    const failures = checkForbiddenBehavior(
      ["invalid_assistant_message"],
      [],
      [],
      null,
      new Set(),
      "I don't see a food category, but I can show you groceries.",
    );

    expect(failures).toEqual([]);
  });
});

describe("createHistory / collectPriorProductIds", () => {
  it("builds product cards from the supplied lookup and collects unique ids", () => {
    const history = createHistory(
      [
        { content: "Show me phones", productIds: [], role: "user" },
        {
          content: "Here are phones.",
          productIds: [101, 102, 101],
          role: "assistant",
        },
      ],
      getFixtureProduct,
    );

    expect(history).toHaveLength(2);
    expect(history[1].productCards.map((card) => card.productId)).toEqual([
      101, 102, 101,
    ]);
    expect(collectPriorProductIds(history)).toEqual([101, 102]);
  });
});
