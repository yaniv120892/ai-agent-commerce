import "dotenv/config";

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

import { CatalogClient } from "../src/domain/catalog/catalog-client";
import { CatalogResolver } from "../src/domain/catalog/catalog-resolver";
import type { RetrievalIntent } from "../src/domain/catalog/types";
import type { ModelClient } from "../src/domain/chat/types";
import { getFixtureProduct } from "../src/domain/testing/deterministic-clients";
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

const allowedCategorySlugs = ["laptops", "smartphones", "tablets"];
const artifactsDirectory = resolve(process.cwd(), "artifacts/evaluations");

// The real DummyJSON catalog decides its own search/browse results, so a
// scenario's exact selectedProductIds (tuned against the deterministic
// fixture) can't be asserted against it without making every online run
// flaky on catalog content we don't control. Plan-level checks (intent,
// maxPrice, searchTerm, referencedProductIds) and forbidden-behavior checks
// still run for every scenario.
const nonFatalConstraintsByIntent: Partial<Record<RetrievalIntent, string[]>> =
  {
    browse_category: ["selectedProductIds"],
    search: ["selectedProductIds"],
  };

async function evaluateScenario(
  scenario: Scenario,
  modelClient: ModelClient,
  catalogResolver: CatalogResolver,
): Promise<EvaluationCaseResult> {
  const startedAt = performance.now();
  const history = createHistory(scenario.priorMessages, getFixtureProduct);
  const priorProductIds = collectPriorProductIds(history);
  const failures: string[] = [];
  let actualIntent: RetrievalIntent | null = null;
  let constraintChecks: Record<string, boolean> = {};
  let selectedProductIds: number[] = [];
  let planValid = false;

  try {
    const plan = await modelClient.createRetrievalPlan({
      allowedCategorySlugs,
      history,
      priorProductIds,
      userMessage: scenario.currentInput,
    });
    const resolved = await catalogResolver.resolve(plan, priorProductIds);
    const ignoredConstraints = new Set(
      nonFatalConstraintsByIntent[plan.intent] ?? [],
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
      if (!passed && !ignoredConstraints.has(name)) {
        failures.push(`required constraint failed: ${name}`);
      }
    }

    failures.push(
      ...checkForbiddenBehavior(
        scenario.forbiddenBehavior,
        resolved.productCards,
        selectedProductIds,
        plan.maxPrice,
        // Online has no artificial catalog scope to violate: every card the
        // resolver returns already came from the live catalog client, so
        // "grounded" is defined as "the resolver actually returned it".
        new Set(selectedProductIds),
      ),
    );
  } catch (error) {
    failures.push(
      error instanceof Error
        ? `invalid plan: ${error.message}`
        : "integration failure",
    );
  }

  return {
    actualIntent,
    constraintChecks,
    expectedIntent: scenario.expectedIntent,
    failures,
    groundedCards: selectedProductIds.every((productId) => productId > 0),
    intentMatches: actualIntent === scenario.expectedIntent,
    latencyMs: Math.round((performance.now() - startedAt) * 100) / 100,
    name: scenario.name,
    planValid,
    selectedProductIds,
  };
}

async function writeReport(report: EvaluationReport): Promise<string> {
  await mkdir(artifactsDirectory, { recursive: true });
  const reportPath = resolve(
    artifactsDirectory,
    `online-${report.generatedAt.replaceAll(/[:.]/gu, "-")}.json`,
  );

  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  return reportPath;
}

async function main(): Promise<void> {
  if (process.env.RUN_ONLINE_EVAL !== "true") {
    console.log(
      "Online evaluation skipped: set RUN_ONLINE_EVAL=true to run it.",
    );
    return;
  }

  console.log(
    "Online evaluation is not CI-safe: it has external cost and availability dependencies.",
  );

  const apiKey = process.env.OPENAI_API_KEY;

  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error("OPENAI_API_KEY is required when RUN_ONLINE_EVAL=true");
  }

  const scenarios = await loadScenarios();
  const catalogClient = new CatalogClient(fetch, "https://dummyjson.com", 5000);
  const catalogResolver = new CatalogResolver(
    catalogClient,
    allowedCategorySlugs,
  );
  const { OpenAIModelClient } =
    await import("../src/domain/chat/openai-model-client");
  const modelClient = new OpenAIModelClient(apiKey);
  const results: EvaluationCaseResult[] = [];

  for (const scenario of scenarios) {
    const result = await evaluateScenario(
      scenario,
      modelClient,
      catalogResolver,
    );

    results.push(result);
    console.log(JSON.stringify(result));
  }

  const report: EvaluationReport = {
    generatedAt: new Date().toISOString(),
    results,
    summary: {
      failed: results.filter((result) => result.failures.length > 0).length,
      passed: results.filter((result) => result.failures.length === 0).length,
      total: results.length,
    },
  };
  const reportPath = await writeReport(report);

  console.log(`Online evaluation report: ${reportPath}`);
  console.log(JSON.stringify(report.summary));

  if (report.summary.failed > 0) {
    throw new Error(
      results
        .filter((result) => result.failures.length > 0)
        .map((result) => `${result.name}: ${result.failures.join(", ")}`)
        .join("\n"),
    );
  }
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Online evaluation failed",
  );
  process.exitCode = 1;
});
