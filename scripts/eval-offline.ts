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
import { loadEvaluationConfig } from "../src/domain/testing/evaluation-config";
import { EvaluationGate } from "../src/domain/testing/evaluation-gate";
import {
  createEvaluationReport,
  writeEvaluationReport,
} from "../src/domain/testing/evaluation-report";
import {
  checkConstraints,
  checkForbiddenBehavior,
  collectPriorProductIds,
  createHistory,
  loadScenarios,
} from "../src/domain/testing/scenario-evaluation";
import type {
  EvaluationCaseResult,
  Scenario,
  ScenarioPlanSummary,
} from "../src/domain/testing/scenario-evaluation";

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
  let capturedPlan: ScenarioPlanSummary | null = null;
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
    capturedPlan = plan;
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
        scenario.forbiddenBrands,
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
    plan: capturedPlan,
    planValid,
    repairAttempted,
    selectedProductIds,
  };
}

async function main(): Promise<void> {
  const config = await loadEvaluationConfig();
  const scenarios = await loadScenarios();
  const results = await Promise.all(scenarios.map(evaluateScenario));
  const gate = new EvaluationGate(config.offline, "offline");
  const gateOutcome = gate.evaluate({
    abortReason: null,
    results,
    scenarioNames: scenarios.map((scenario) => scenario.name),
  });
  const report = createEvaluationReport(results, gateOutcome);
  const reportPath = await writeEvaluationReport("offline", report);

  console.log(`Offline evaluation report: ${reportPath}`);
  console.log(JSON.stringify(report.summary));

  if (gateOutcome.blockingReasons.length > 0) {
    console.error(
      `\nOffline evaluation gate failed:\n${gateOutcome.blockingReasons
        .map((reason) => `  - ${reason}`)
        .join("\n")}`,
    );
    process.exitCode = 1;
  }
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Offline evaluation failed",
  );
  process.exitCode = 1;
});
