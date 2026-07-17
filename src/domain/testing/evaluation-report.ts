import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { EvaluationGateOutcome } from "./evaluation-gate.types";
import type {
  EvaluationCaseResult,
  EvaluationReport,
  EvaluationSpendSummary,
} from "./scenario-evaluation.types";

const artifactsDirectory = resolve(process.cwd(), "artifacts/evaluations");

export function createEvaluationReport(
  results: EvaluationCaseResult[],
  gateOutcome: EvaluationGateOutcome,
  spend: EvaluationSpendSummary | null = null,
): EvaluationReport {
  return {
    generatedAt: new Date().toISOString(),
    results,
    spend,
    summary: {
      blockingReasons: gateOutcome.blockingReasons,
      failed: gateOutcome.verdicts.filter(
        (verdict) => verdict.outcome === "failed",
      ).length,
      firstPassPlanValid: results.filter((result) => result.firstPassPlanValid)
        .length,
      passRate: gateOutcome.passRate,
      passed: gateOutcome.passed,
      quarantined: gateOutcome.quarantined,
      repairAttempted: results.filter((result) => result.repairAttempted)
        .length,
      total: gateOutcome.verdicts.length,
    },
    verdicts: gateOutcome.verdicts,
  };
}

export async function writeEvaluationReport(
  suiteName: string,
  report: EvaluationReport,
): Promise<string> {
  await mkdir(artifactsDirectory, { recursive: true });
  const reportPath = resolve(
    artifactsDirectory,
    `${suiteName}-${report.generatedAt.replaceAll(/[:.]/gu, "-")}.json`,
  );

  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  return reportPath;
}
