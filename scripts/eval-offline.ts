import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

import { deriveActiveContext } from "../src/domain/chat/active-context";
import { CatalogResolver } from "../src/domain/catalog/catalog-resolver";
import { PlanValidator } from "../src/domain/catalog/plan-validator";
import { PlanRepairService } from "../src/domain/chat/plan-repair-service";
import type {
  CatalogProduct,
  RetrievalIntent,
} from "../src/domain/catalog/types";
import {
  DeterministicModelClient,
  FixtureCatalogClient,
  getFixtureProduct,
} from "../src/domain/testing/deterministic-clients";
import {
  checkConstraints,
  checkForbiddenBehavior,
  collectPriorProductIds,
  createHistory,
  loadScenarios,
} from "../src/domain/testing/scenario-evaluation";
import type {
  EvaluationCaseResult,
  EvaluationReport,
  Scenario,
} from "../src/domain/testing/scenario-evaluation";

const artifactsDirectory = resolve(process.cwd(), "artifacts/evaluations");

function selectFixtureCatalog(scenario: Scenario): CatalogProduct[] {
  return scenario.fixtureCatalog.productIds.map(getFixtureProduct);
}

async function evaluateScenario(
  scenario: Scenario,
): Promise<EvaluationCaseResult> {
  const startedAt = performance.now();
  const products = selectFixtureCatalog(scenario);
  const history = createHistory(scenario.priorMessages, getFixtureProduct);
  const priorProductIds = collectPriorProductIds(history);
  const resolver = new CatalogResolver(new FixtureCatalogClient(products));
  const planRepairService = new PlanRepairService(
    new DeterministicModelClient(),
    (allowedCategorySlugs) => new PlanValidator(allowedCategorySlugs),
  );
  const failures: string[] = [];
  let actualIntent: RetrievalIntent | null = null;
  let constraintChecks: Record<string, boolean> = {};
  let selectedProductIds: number[] = [];
  let planValid = false;
  let firstPassPlanValid = false;
  let repairAttempted = false;

  try {
    const allowedCategorySlugs = await resolver.listAllowedCategorySlugs();
    const planOutcome = await planRepairService.createValidPlan({
      activeContext: deriveActiveContext(history),
      allowedCategorySlugs,
      history,
      priorProductIds,
      userMessage: scenario.currentInput,
    });
    const plan = planOutcome.plan;

    firstPassPlanValid = planOutcome.firstPassValid;
    repairAttempted = planOutcome.repairAttempted;

    const resolved = await resolver.resolve(plan, allowedCategorySlugs);
    const selectedProducts = resolved.productCards.map((card) =>
      getFixtureProduct(card.productId),
    );

    actualIntent = plan.intent;
    planValid = true;
    selectedProductIds = resolved.productCards.map((card) => card.productId);
    constraintChecks = checkConstraints(scenario, plan, selectedProductIds);

    if (actualIntent !== scenario.expectedIntent) {
      failures.push(
        `expected intent ${scenario.expectedIntent}, received ${actualIntent}`,
      );
    }

    for (const [name, passed] of Object.entries(constraintChecks)) {
      if (!passed) {
        failures.push(`required constraint failed: ${name}`);
      }
    }

    failures.push(
      ...checkForbiddenBehavior(
        scenario.forbiddenBehavior,
        selectedProducts,
        selectedProductIds,
        plan.maxPrice,
        new Set(products.map((product) => product.id)),
        plan.assistantMessage,
      ),
    );
  } catch (error) {
    failures.push(
      error instanceof Error
        ? `invalid plan: ${error.message}`
        : "invalid plan",
    );
  }

  return {
    actualIntent,
    constraintChecks,
    expectedIntent: scenario.expectedIntent,
    failures,
    firstPassPlanValid,
    groundedCards: selectedProductIds.every((productId) =>
      products.some((product) => product.id === productId),
    ),
    intentMatches: actualIntent === scenario.expectedIntent,
    latencyMs: Math.round((performance.now() - startedAt) * 100) / 100,
    name: scenario.name,
    planValid,
    repairAttempted,
    selectedProductIds,
  };
}

async function writeReport(report: EvaluationReport): Promise<string> {
  await mkdir(artifactsDirectory, { recursive: true });
  const reportPath = resolve(
    artifactsDirectory,
    `offline-${report.generatedAt.replaceAll(/[:.]/gu, "-")}.json`,
  );

  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  return reportPath;
}

async function main(): Promise<void> {
  const scenarios = await loadScenarios();
  const results = await Promise.all(scenarios.map(evaluateScenario));
  const report: EvaluationReport = {
    generatedAt: new Date().toISOString(),
    results,
    summary: {
      failed: results.filter((result) => result.failures.length > 0).length,
      firstPassPlanValid: results.filter((result) => result.firstPassPlanValid)
        .length,
      passed: results.filter((result) => result.failures.length === 0).length,
      repairAttempted: results.filter((result) => result.repairAttempted)
        .length,
      total: results.length,
    },
  };
  const reportPath = await writeReport(report);

  console.log(`Offline evaluation report: ${reportPath}`);
  console.log(JSON.stringify(report.summary));

  if (report.summary.failed > 0) {
    process.exitCode = 1;
  }
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Offline evaluation failed",
  );
  process.exitCode = 1;
});
