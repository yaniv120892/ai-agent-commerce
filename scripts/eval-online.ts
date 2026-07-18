import "dotenv/config";

import { performance } from "node:perf_hooks";

import { deriveActiveContext } from "../src/domain/chat/active-context";
import { CatalogClient } from "../src/domain/catalog/catalog-client";
import { CatalogResolver } from "../src/domain/catalog/catalog-resolver";
import { PlanValidator } from "../src/domain/catalog/plan-validator";
import { PlanRepairService } from "../src/domain/chat/plan-repair-service";
import type { RetrievalIntent } from "../src/domain/catalog/types";
import { getFixtureProduct } from "../src/domain/testing/deterministic-clients";
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
import { SpendMeter } from "../src/domain/testing/spend-meter";
import type { SpendSnapshot } from "../src/domain/testing/spend-meter";
import { resolveOpenAIModelSelection } from "../src/lib/openai-model-config";

// Two constraints tuned against the deterministic fixture do not survive
// contact with a real model and a live catalog, so the online suite does not
// treat them as fatal: `selectedProductIds`, because the live DummyJSON
// catalog decides its own results, and `searchTerm`, because the real planner
// captures the category through `categorySlug` and puts natural query wording
// in `searchTerms` rather than the fixture's category tokens. The structured
// plan fields (intent, maxPrice, inStock, sort, categorySlug,
// referencedProductIds) and the forbidden-behavior checks still run.
const nonFatalConstraints: ReadonlySet<string> = new Set([
  "searchTerm",
  "selectedProductIds",
]);

// A real planner legitimately answers "show me laptops" or "the cheapest
// laptop" with either `search` or `browse_category`; the resolver accepts both
// as product-returning plans and the meaningful distinctions (category, price,
// sort, stock) are asserted through the plan fields. Which of the two the model
// picks is not a correctness boundary, so the online suite treats them as one
// class. This never relaxes clarify/unsupported/compare/product_detail.
const retrievalIntentClass: ReadonlySet<RetrievalIntent> =
  new Set<RetrievalIntent>(["browse_category", "search"]);

function intentsMatch(
  expected: RetrievalIntent,
  actual: RetrievalIntent,
): boolean {
  if (expected === actual) {
    return true;
  }

  if (retrievalIntentClass.has(expected) && retrievalIntentClass.has(actual)) {
    return true;
  }

  // A scenario that expects a refusal (unsupported) is also satisfied when the
  // real planner declines by asking to clarify: for an off-catalog request that
  // is an equally safe non-retrieval response, and the forbidden-behavior checks
  // still enforce that nothing was retrieved and a real reply was returned. The
  // reverse is not true — a scenario that expects clarify must not accept
  // unsupported, or a genuinely answerable request could be silently refused.
  return expected === "unsupported" && actual === "clarify";
}

async function evaluateScenario(
  scenario: Scenario,
  planRepairService: PlanRepairService,
  catalogResolver: CatalogResolver,
  catalogClient: CatalogClient,
  allowedCategorySlugs: string[],
): Promise<EvaluationCaseResult> {
  const startedAt = performance.now();
  const history = createHistory(scenario.priorMessages, getFixtureProduct);
  const priorProductIds = collectPriorProductIds(history);
  const failures: string[] = [];
  let actualIntent: RetrievalIntent | null = null;
  let capturedPlan: ScenarioPlanSummary | null = null;
  let constraintChecks: Record<string, boolean> = {};
  let selectedProductIds: number[] = [];
  let planValid = false;
  let firstPassPlanValid = false;
  let repairAttempted = false;

  try {
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

    const resolved = await catalogResolver.resolve(
      plan,
      allowedCategorySlugs,
      priorProductIds,
    );

    actualIntent = plan.intent;
    capturedPlan = plan;
    planValid = true;
    selectedProductIds = resolved.productCards.map((card) => card.productId);
    const selectedProducts =
      scenario.forbiddenBrands === undefined
        ? resolved.productCards
        : await Promise.all(
            selectedProductIds.map((productId) =>
              catalogClient.getProduct(productId),
            ),
          );
    constraintChecks = checkConstraints(scenario, plan, selectedProductIds);

    if (!intentsMatch(scenario.expectedIntent, actualIntent)) {
      failures.push(
        `expected intent ${scenario.expectedIntent}, received ${actualIntent}`,
      );
    }

    for (const [name, passed] of Object.entries(constraintChecks)) {
      if (!passed && !nonFatalConstraints.has(name)) {
        failures.push(`required constraint failed: ${name}`);
      }
    }

    failures.push(
      ...checkForbiddenBehavior(
        scenario.forbiddenBehavior,
        selectedProducts,
        selectedProductIds,
        plan.maxPrice,
        // Online has no artificial catalog scope to violate: every card the
        // resolver returns already came from the live catalog client, so
        // "grounded" is defined as "the resolver actually returned it".
        new Set(selectedProductIds),
        plan.assistantMessage,
        scenario.forbiddenBrands,
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
    firstPassPlanValid,
    groundedCards: selectedProductIds.every((productId) => productId > 0),
    intentMatches:
      actualIntent !== null &&
      intentsMatch(scenario.expectedIntent, actualIntent),
    latencyMs: Math.round((performance.now() - startedAt) * 100) / 100,
    name: scenario.name,
    plan: capturedPlan,
    planValid,
    repairAttempted,
    selectedProductIds,
  };
}

async function main(): Promise<void> {
  if (process.env.RUN_ONLINE_EVAL !== "true") {
    console.log(
      "Online evaluation skipped: set RUN_ONLINE_EVAL=true to run it.",
    );
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;

  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error("OPENAI_API_KEY is required when RUN_ONLINE_EVAL=true");
  }

  const config = await loadEvaluationConfig();
  const scenarios = await loadScenarios();

  if (scenarios.length > config.online.maxScenarios) {
    throw new Error(
      `The online evaluation has ${scenarios.length} scenarios but the committed budget allows ${config.online.maxScenarios}. Raise maxScenarios in tests/evals/eval-config.json once the extra spend is intended.`,
    );
  }

  const models = resolveOpenAIModelSelection(process.env);
  const spendMeter = new SpendMeter(config.online.spend.pricing);

  spendMeter.assertPricingExistsFor([models.plannerModel, models.replyModel]);

  console.log(
    `Evaluating ${scenarios.length} scenarios with planner model ${models.plannerModel}, capped at $${config.online.spend.maxUsd.toFixed(2)}`,
  );

  const catalogClient = new CatalogClient(fetch, "https://dummyjson.com", 5000);
  const catalogResolver = new CatalogResolver(catalogClient);
  const allowedCategorySlugs = await catalogResolver.listAllowedCategorySlugs();
  const { OpenAIModelClient } =
    await import("../src/domain/chat/openai-model-client");
  const modelClient = new OpenAIModelClient({
    apiKey,
    fetch: spendMeter.createFetch(),
    maxOutputTokens: 2000,
    maxRetries: 1,
    models,
    timeoutMs: 20000,
  });
  const planRepairService = new PlanRepairService(
    modelClient,
    (categorySlugs) => new PlanValidator(categorySlugs),
  );
  const results: EvaluationCaseResult[] = [];
  let abortReason: string | null = null;

  for (const scenario of scenarios) {
    if (spendMeter.snapshot.totalUsd >= config.online.spend.maxUsd) {
      abortReason = `run aborted: spend cap $${config.online.spend.maxUsd.toFixed(2)} reached after ${results.length}/${scenarios.length} scenarios ($${spendMeter.snapshot.totalUsd.toFixed(4)} spent)`;
      break;
    }

    const result = await evaluateScenario(
      scenario,
      planRepairService,
      catalogResolver,
      catalogClient,
      allowedCategorySlugs,
    );

    results.push(result);
    console.log(JSON.stringify(result));
  }

  abortReason ??= findMeteringFailure(spendMeter.snapshot);

  const gate = new EvaluationGate(config.online, "online");
  const gateOutcome = gate.evaluate({
    abortReason,
    results,
    scenarioNames: scenarios.map((scenario) => scenario.name),
  });
  const report = createEvaluationReport(results, gateOutcome, {
    requestCount: spendMeter.snapshot.requestCount,
    totalUsd: spendMeter.snapshot.totalUsd,
  });
  const reportPath = await writeEvaluationReport("online", report);

  console.log(`Online evaluation report: ${reportPath}`);
  console.log(
    `Spent $${spendMeter.snapshot.totalUsd.toFixed(4)} across ${spendMeter.snapshot.requestCount} requests`,
  );
  console.log(JSON.stringify(report.summary));

  if (gateOutcome.blockingReasons.length > 0) {
    throw new Error(
      `Online evaluation gate failed:\n${gateOutcome.blockingReasons
        .map((reason) => `  - ${reason}`)
        .join("\n")}`,
    );
  }
}

// Metering that silently reports $0 is worse than no cap at all, so a run that
// could not account for every billed call fails rather than trusting the total.
function findMeteringFailure(snapshot: SpendSnapshot): string | null {
  if (snapshot.unpricedModels.length > 0) {
    return `run aborted: no committed pricing for ${snapshot.unpricedModels.join(", ")}, so spend could not be metered`;
  }

  if (snapshot.usageMissingCount > 0) {
    return `run aborted: ${snapshot.usageMissingCount} response(s) reported no token usage, so spend could not be metered`;
  }

  return null;
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Online evaluation failed",
  );
  process.exitCode = 1;
});
