import { describe, expect, it } from "vitest";

import type { SuiteEvaluationPolicy } from "./evaluation-config.types";
import { EvaluationGate } from "./evaluation-gate";
import type { EvaluationCaseResult } from "./scenario-evaluation.types";

function createResult(
  name: string,
  failures: string[] = [],
): EvaluationCaseResult {
  return {
    actualIntent: "search",
    constraintChecks: {},
    expectedIntent: "search",
    failures,
    firstPassPlanValid: true,
    groundedCards: true,
    intentMatches: failures.length === 0,
    latencyMs: 1,
    name,
    plan: null,
    planValid: true,
    repairAttempted: false,
    selectedProductIds: [],
  };
}

function createPolicy(
  overrides: Partial<SuiteEvaluationPolicy> = {},
): SuiteEvaluationPolicy {
  return {
    expectedFailures: [],
    minimumPassRate: 1,
    mustPassScenarios: [],
    ...overrides,
  };
}

describe("EvaluationGate", () => {
  it("passes when every scenario passes", () => {
    const gate = new EvaluationGate(createPolicy(), "offline");

    const outcome = gate.evaluate({
      abortReason: null,
      results: [createResult("a"), createResult("b")],
      scenarioNames: ["a", "b"],
    });

    expect(outcome.blockingReasons).toEqual([]);
    expect(outcome.passRate).toBe(1);
    expect(outcome.verdicts.map((verdict) => verdict.outcome)).toEqual([
      "passed",
      "passed",
    ]);
  });

  it("blocks when a scenario fails", () => {
    const gate = new EvaluationGate(createPolicy(), "offline");

    const outcome = gate.evaluate({
      abortReason: null,
      results: [createResult("a"), createResult("b", ["wrong intent"])],
      scenarioNames: ["a", "b"],
    });

    expect(outcome.verdicts[1]?.outcome).toBe("failed");
    expect(outcome.passRate).toBe(0.5);
    expect(outcome.blockingReasons).toHaveLength(1);
    expect(outcome.blockingReasons[0]).toContain("below the committed minimum");
  });

  it("tolerates a quarantined scenario that fails", () => {
    const gate = new EvaluationGate(
      createPolicy({
        expectedFailures: [{ reason: "known red, see YAN-10", scenario: "b" }],
      }),
      "offline",
    );

    const outcome = gate.evaluate({
      abortReason: null,
      results: [createResult("a"), createResult("b", ["wrong intent"])],
      scenarioNames: ["a", "b"],
    });

    expect(outcome.verdicts[1]?.outcome).toBe("quarantined_failed");
    expect(outcome.blockingReasons).toEqual([]);
  });

  it("excludes quarantined scenarios from the pass rate denominator", () => {
    const gate = new EvaluationGate(
      createPolicy({
        expectedFailures: [{ reason: "known red", scenario: "b" }],
      }),
      "offline",
    );

    const outcome = gate.evaluate({
      abortReason: null,
      results: [createResult("a"), createResult("b", ["wrong intent"])],
      scenarioNames: ["a", "b"],
    });

    expect(outcome.passRate).toBe(1);
    expect(outcome.quarantined).toBe(1);
  });

  it("blocks when a quarantined scenario unexpectedly passes", () => {
    const gate = new EvaluationGate(
      createPolicy({
        expectedFailures: [
          { reason: "fake has no shoe handling", scenario: "b" },
        ],
      }),
      "offline",
    );

    const outcome = gate.evaluate({
      abortReason: null,
      results: [createResult("a"), createResult("b")],
      scenarioNames: ["a", "b"],
    });

    expect(outcome.verdicts[1]?.outcome).toBe("unexpectedly_passed");
    expect(outcome.blockingReasons).toHaveLength(1);
    expect(outcome.blockingReasons[0]).toContain("but passed");
    expect(outcome.blockingReasons[0]).toContain("fake has no shoe handling");
  });

  it("counts an unexpectedly passing scenario as a pass, so the stale allowlist is the only complaint", () => {
    const gate = new EvaluationGate(
      createPolicy({
        expectedFailures: [{ reason: "known red", scenario: "b" }],
      }),
      "offline",
    );

    const outcome = gate.evaluate({
      abortReason: null,
      results: [createResult("a"), createResult("b")],
      scenarioNames: ["a", "b"],
    });

    expect(outcome.passRate).toBe(1);
    expect(outcome.blockingReasons).toHaveLength(1);
    expect(outcome.blockingReasons[0]).not.toContain("below the committed");
  });

  it("blocks when the allowlist names a scenario that no longer exists", () => {
    const gate = new EvaluationGate(
      createPolicy({
        expectedFailures: [{ reason: "stale", scenario: "deleted_scenario" }],
      }),
      "offline",
    );

    const outcome = gate.evaluate({
      abortReason: null,
      results: [createResult("a")],
      scenarioNames: ["a"],
    });

    expect(outcome.blockingReasons).toHaveLength(1);
    expect(outcome.blockingReasons[0]).toContain("not a known scenario");
  });

  it("blocks when mustPassScenarios names a scenario that no longer exists", () => {
    const gate = new EvaluationGate(
      createPolicy({ mustPassScenarios: ["deleted_scenario"] }),
      "online",
    );

    const outcome = gate.evaluate({
      abortReason: null,
      results: [createResult("a")],
      scenarioNames: ["a"],
    });

    expect(outcome.blockingReasons).toHaveLength(1);
    expect(outcome.blockingReasons[0]).toContain("not a known scenario");
  });

  it("blocks when a scenario is both required and quarantined", () => {
    const gate = new EvaluationGate(
      createPolicy({
        expectedFailures: [{ reason: "known red", scenario: "a" }],
        mustPassScenarios: ["a"],
      }),
      "online",
    );

    const outcome = gate.evaluate({
      abortReason: null,
      results: [createResult("a", ["boom"])],
      scenarioNames: ["a"],
    });

    expect(outcome.blockingReasons.join("\n")).toContain("cannot be both");
  });

  it("blocks a failing required scenario even when the pass rate is met", () => {
    const gate = new EvaluationGate(
      createPolicy({
        minimumPassRate: 0.5,
        mustPassScenarios: ["injection"],
      }),
      "online",
    );

    const outcome = gate.evaluate({
      abortReason: null,
      results: [
        createResult("a"),
        createResult("b"),
        createResult("c"),
        createResult("injection", ["leaked the system prompt"]),
      ],
      scenarioNames: ["a", "b", "c", "injection"],
    });

    expect(outcome.passRate).toBe(0.75);
    expect(outcome.passRate).toBeGreaterThanOrEqual(0.5);
    expect(outcome.blockingReasons).toHaveLength(1);
    expect(outcome.blockingReasons[0]).toContain(
      'required scenario "injection" did not pass',
    );
  });

  it("blocks on a spend abort even when every executed scenario passed", () => {
    const gate = new EvaluationGate(
      createPolicy({ minimumPassRate: 0.85 }),
      "online",
    );

    const outcome = gate.evaluate({
      abortReason: "run aborted: spend cap $1.50 exceeded after 2/4 scenarios",
      results: [createResult("a"), createResult("b")],
      scenarioNames: ["a", "b", "c", "d"],
    });

    expect(outcome.verdicts[2]?.outcome).toBe("not_run");
    expect(outcome.blockingReasons.join("\n")).toContain("spend cap");
  });

  it("never counts an unrun scenario as a pass", () => {
    const gate = new EvaluationGate(
      createPolicy({ minimumPassRate: 0.85 }),
      "online",
    );

    const outcome = gate.evaluate({
      abortReason: "run aborted: spend cap exceeded",
      results: [createResult("a"), createResult("b")],
      scenarioNames: ["a", "b", "c", "d"],
    });

    expect(outcome.passed).toBe(2);
    expect(outcome.passRate).toBe(0.5);
  });

  it("blocks when a scenario produced no result without an abort", () => {
    const gate = new EvaluationGate(createPolicy(), "offline");

    const outcome = gate.evaluate({
      abortReason: null,
      results: [createResult("a")],
      scenarioNames: ["a", "b"],
    });

    expect(outcome.blockingReasons.join("\n")).toContain(
      "produced no result but the run was not aborted",
    );
  });

  it("accepts a pass rate at exactly the committed minimum", () => {
    const gate = new EvaluationGate(
      createPolicy({ minimumPassRate: 0.75 }),
      "online",
    );

    const outcome = gate.evaluate({
      abortReason: null,
      results: [
        createResult("a"),
        createResult("b"),
        createResult("c"),
        createResult("d", ["flaked"]),
      ],
      scenarioNames: ["a", "b", "c", "d"],
    });

    expect(outcome.passRate).toBe(0.75);
    expect(outcome.blockingReasons).toEqual([]);
  });
});
