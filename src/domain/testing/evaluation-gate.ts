import type { EvaluationCaseResult } from "./scenario-evaluation.types";
import type { SuiteEvaluationPolicy } from "./evaluation-config.types";
import type {
  EvaluationGateOutcome,
  ScenarioOutcome,
  ScenarioVerdict,
} from "./evaluation-gate.types";

export type {
  EvaluationGateOutcome,
  ScenarioOutcome,
  ScenarioVerdict,
} from "./evaluation-gate.types";

export type EvaluationGateInput = {
  abortReason: string | null;
  results: EvaluationCaseResult[];
  scenarioNames: string[];
};

export class EvaluationGate {
  private readonly quarantineReasonsByScenario: Map<string, string>;

  public constructor(
    private readonly policy: SuiteEvaluationPolicy,
    private readonly suiteName: string,
  ) {
    this.quarantineReasonsByScenario = new Map(
      policy.expectedFailures.map((expectedFailure) => [
        expectedFailure.scenario,
        expectedFailure.reason,
      ]),
    );
  }

  public evaluate(input: EvaluationGateInput): EvaluationGateOutcome {
    const verdicts = this.buildVerdicts(input);
    const passed = verdicts.filter(
      (verdict) =>
        verdict.outcome === "passed" ||
        verdict.outcome === "unexpectedly_passed",
    ).length;
    const quarantined = verdicts.filter(
      (verdict) => verdict.outcome === "quarantined_failed",
    ).length;
    const passRate = this.calculatePassRate(
      verdicts.length,
      passed,
      quarantined,
    );

    return {
      blockingReasons: [
        ...this.findStaleAllowlistReasons(input.scenarioNames),
        ...this.findUnexpectedlyPassingReasons(verdicts),
        ...this.findMustPassReasons(verdicts),
        ...this.findNotRunReasons(verdicts, input.abortReason),
        ...this.findPassRateReasons(passRate),
        ...this.findAbortReasons(input.abortReason),
      ],
      passRate,
      passed,
      quarantined,
      verdicts,
    };
  }

  private buildVerdicts(input: EvaluationGateInput): ScenarioVerdict[] {
    const resultsByScenario = new Map(
      input.results.map((result) => [result.name, result]),
    );

    return input.scenarioNames.map((name) => {
      const result = resultsByScenario.get(name);

      return {
        failures: result?.failures ?? [],
        name,
        outcome: this.classify(name, result),
      };
    });
  }

  private classify(
    name: string,
    result: EvaluationCaseResult | undefined,
  ): ScenarioOutcome {
    if (result === undefined) {
      return "not_run";
    }

    const isQuarantined = this.quarantineReasonsByScenario.has(name);
    const hasFailed = result.failures.length > 0;

    if (isQuarantined) {
      return hasFailed ? "quarantined_failed" : "unexpectedly_passed";
    }

    return hasFailed ? "failed" : "passed";
  }

  // Quarantined failures leave the denominator so that quarantining a scenario
  // cannot drag the rate down and force the committed threshold lower, which
  // would silently weaken the gate for every other scenario.
  private calculatePassRate(
    total: number,
    passed: number,
    quarantined: number,
  ): number {
    const measured = total - quarantined;

    if (measured <= 0) {
      return 1;
    }

    return passed / measured;
  }

  private findStaleAllowlistReasons(scenarioNames: string[]): string[] {
    const knownScenarios = new Set(scenarioNames);
    const reasons: string[] = [];

    for (const scenario of this.quarantineReasonsByScenario.keys()) {
      if (!knownScenarios.has(scenario)) {
        reasons.push(
          `${this.suiteName}: expectedFailures names "${scenario}", which is not a known scenario; remove it from tests/evals/eval-config.json`,
        );
      }
    }

    for (const scenario of this.policy.mustPassScenarios) {
      if (!knownScenarios.has(scenario)) {
        reasons.push(
          `${this.suiteName}: mustPassScenarios names "${scenario}", which is not a known scenario; remove it from tests/evals/eval-config.json`,
        );
      }

      if (this.quarantineReasonsByScenario.has(scenario)) {
        reasons.push(
          `${this.suiteName}: "${scenario}" is in both mustPassScenarios and expectedFailures; it cannot be both required to pass and allowed to fail`,
        );
      }
    }

    return reasons;
  }

  private findUnexpectedlyPassingReasons(
    verdicts: ScenarioVerdict[],
  ): string[] {
    return verdicts
      .filter((verdict) => verdict.outcome === "unexpectedly_passed")
      .map(
        (verdict) =>
          `${this.suiteName}: "${verdict.name}" is in expectedFailures but passed; remove it from tests/evals/eval-config.json (recorded reason: ${this.quarantineReasonsByScenario.get(verdict.name) ?? "none"})`,
      );
  }

  private findMustPassReasons(verdicts: ScenarioVerdict[]): string[] {
    const requiredScenarios = new Set(this.policy.mustPassScenarios);

    return verdicts
      .filter(
        (verdict) =>
          requiredScenarios.has(verdict.name) && verdict.outcome !== "passed",
      )
      .map(
        (verdict) =>
          `${this.suiteName}: required scenario "${verdict.name}" did not pass (${verdict.outcome})${verdict.failures.length > 0 ? `: ${verdict.failures.join(", ")}` : ""}`,
      );
  }

  private findNotRunReasons(
    verdicts: ScenarioVerdict[],
    abortReason: string | null,
  ): string[] {
    if (abortReason !== null) {
      return [];
    }

    return verdicts
      .filter((verdict) => verdict.outcome === "not_run")
      .map(
        (verdict) =>
          `${this.suiteName}: "${verdict.name}" produced no result but the run was not aborted`,
      );
  }

  private findPassRateReasons(passRate: number): string[] {
    if (passRate >= this.policy.minimumPassRate) {
      return [];
    }

    return [
      `${this.suiteName}: pass rate ${this.formatRate(passRate)} is below the committed minimum ${this.formatRate(this.policy.minimumPassRate)}`,
    ];
  }

  private findAbortReasons(abortReason: string | null): string[] {
    if (abortReason === null) {
      return [];
    }

    return [`${this.suiteName}: ${abortReason}`];
  }

  private formatRate(rate: number): string {
    return `${Math.round(rate * 1000) / 10}%`;
  }
}
