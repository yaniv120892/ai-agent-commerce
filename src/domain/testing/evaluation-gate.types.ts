export type ScenarioOutcome =
  | "failed"
  | "not_run"
  | "passed"
  | "quarantined_failed"
  | "unexpectedly_passed";

export type ScenarioVerdict = {
  failures: string[];
  name: string;
  outcome: ScenarioOutcome;
};

export type EvaluationGateOutcome = {
  blockingReasons: string[];
  passRate: number;
  passed: number;
  quarantined: number;
  verdicts: ScenarioVerdict[];
};
