import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

import { deriveActiveContext } from "../src/domain/chat/active-context";
import { CatalogResolver } from "../src/domain/catalog/catalog-resolver";
import type {
  CatalogProduct,
  RetrievalIntent,
} from "../src/domain/catalog/types";
import type {
  PersistedMessage,
  ProductCardSnapshot,
} from "../src/domain/conversations/types";
import {
  DeterministicModelClient,
  FixtureCatalogClient,
  fixtureCatalog,
} from "../src/domain/testing/deterministic-clients";

type ScenarioMessage = {
  content: string;
  productIds: number[];
  role: "assistant" | "user";
};

type Scenario = {
  currentInput: string;
  expectedIntent: RetrievalIntent;
  fixtureCatalog: { productIds: number[] };
  forbiddenBehavior: string[];
  name: string;
  priorMessages: ScenarioMessage[];
  requiredConstraints: {
    maxPrice?: number;
    referencedProductIds?: number[];
    searchTerm?: string;
    selectedProductIds?: number[];
  };
};

type EvaluationCaseResult = {
  actualIntent: RetrievalIntent | null;
  constraintChecks: Record<string, boolean>;
  expectedIntent: RetrievalIntent;
  failures: string[];
  groundedCards: boolean;
  intentMatches: boolean;
  latencyMs: number;
  name: string;
  planValid: boolean;
  selectedProductIds: number[];
};

type EvaluationReport = {
  generatedAt: string;
  results: EvaluationCaseResult[];
  summary: {
    failed: number;
    passed: number;
    total: number;
  };
};

const scenariosPath = resolve(process.cwd(), "tests/evals/scenarios.json");
const artifactsDirectory = resolve(process.cwd(), "artifacts/evaluations");

async function loadScenarios(): Promise<Scenario[]> {
  const contents = await readFile(scenariosPath, "utf8");
  const scenarios: unknown = JSON.parse(contents);

  if (!Array.isArray(scenarios)) {
    throw new Error("Evaluation scenarios must be an array");
  }

  return scenarios as Scenario[];
}

function createHistory(messages: ScenarioMessage[]): PersistedMessage[] {
  return messages.map((message, index) => ({
    content: message.content,
    createdAt: `2026-07-17T00:00:0${index}.000Z`,
    id: `scenario-message-${index}`,
    productCards: message.productIds.map((productId) =>
      createProductCard(productId),
    ),
    role: message.role,
    status: "complete",
  }));
}

function createProductCard(productId: number): ProductCardSnapshot {
  const product = getFixtureProduct(productId);

  return {
    category: product.category,
    imageUrl: product.thumbnail,
    price: product.price,
    productId: product.id,
    rating: product.rating,
    shortDescription: product.description,
    title: product.title,
  };
}

function getFixtureProduct(productId: number): CatalogProduct {
  const product = fixtureCatalog.find((item) => item.id === productId);

  if (product === undefined) {
    throw new Error(`Fixture catalog does not contain product ${productId}`);
  }

  return product;
}

function selectFixtureCatalog(scenario: Scenario): CatalogProduct[] {
  return scenario.fixtureCatalog.productIds.map(getFixtureProduct);
}

function collectPriorProductIds(history: PersistedMessage[]): number[] {
  return [
    ...new Set(
      history.flatMap((message) =>
        message.productCards.map((product) => product.productId),
      ),
    ),
  ];
}

function hasSameIds(actual: number[], expected: number[]): boolean {
  return (
    actual.length === expected.length &&
    actual.every((id, index) => id === expected[index])
  );
}

function checkConstraints(
  scenario: Scenario,
  plan: {
    maxPrice: number | null;
    referencedProductIds: number[];
    searchTerms: string[];
  },
  selectedProductIds: number[],
): Record<string, boolean> {
  const checks: Record<string, boolean> = {};

  if (scenario.requiredConstraints.maxPrice !== undefined) {
    checks.maxPrice = plan.maxPrice === scenario.requiredConstraints.maxPrice;
  }

  if (scenario.requiredConstraints.searchTerm !== undefined) {
    checks.searchTerm = plan.searchTerms.includes(
      scenario.requiredConstraints.searchTerm,
    );
  }

  if (scenario.requiredConstraints.referencedProductIds !== undefined) {
    checks.referencedProductIds = hasSameIds(
      plan.referencedProductIds,
      scenario.requiredConstraints.referencedProductIds,
    );
  }

  if (scenario.requiredConstraints.selectedProductIds !== undefined) {
    checks.selectedProductIds = hasSameIds(
      selectedProductIds,
      scenario.requiredConstraints.selectedProductIds,
    );
  }

  return checks;
}

function checkForbiddenBehavior(
  forbiddenBehavior: string[],
  selectedProducts: CatalogProduct[],
  selectedProductIds: number[],
  planMaxPrice: number | null,
  fixtureProductIds: Set<number>,
): string[] {
  const failures: string[] = [];

  if (
    forbiddenBehavior.includes("catalog_retrieval") &&
    selectedProductIds.length > 0
  ) {
    failures.push("forbidden catalog retrieval occurred");
  }

  if (
    forbiddenBehavior.includes("over_budget") &&
    planMaxPrice !== null &&
    selectedProducts.some((product) => product.price > planMaxPrice)
  ) {
    failures.push("selected product exceeds the requested budget");
  }

  if (
    forbiddenBehavior.includes("ungrounded_cards") &&
    selectedProductIds.some((productId) => !fixtureProductIds.has(productId))
  ) {
    failures.push("selected product is not in the fixture catalog");
  }

  return failures;
}

async function evaluateScenario(
  scenario: Scenario,
): Promise<EvaluationCaseResult> {
  const startedAt = performance.now();
  const products = selectFixtureCatalog(scenario);
  const history = createHistory(scenario.priorMessages);
  const priorProductIds = collectPriorProductIds(history);
  const resolver = new CatalogResolver(new FixtureCatalogClient(products), [
    ...new Set(products.map((product) => product.category)),
  ]);
  const modelClient = new DeterministicModelClient();
  const failures: string[] = [];
  let actualIntent: RetrievalIntent | null = null;
  let constraintChecks: Record<string, boolean> = {};
  let selectedProductIds: number[] = [];
  let planValid = false;

  try {
    const plan = await modelClient.createRetrievalPlan({
      activeContext: deriveActiveContext(history),
      allowedCategorySlugs: [
        ...new Set(products.map((product) => product.category)),
      ],
      history,
      priorProductIds,
      userMessage: scenario.currentInput,
    });
    const resolved = await resolver.resolve(plan, priorProductIds);
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
    groundedCards: selectedProductIds.every((productId) =>
      products.some((product) => product.id === productId),
    ),
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
      passed: results.filter((result) => result.failures.length === 0).length,
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
