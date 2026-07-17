import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { CatalogProduct } from "@/domain/catalog/types";
import type {
  PersistedMessage,
  ProductCardSnapshot,
} from "@/domain/conversations/types";

import type {
  Scenario,
  ScenarioMessage,
  ScenarioPlanSummary,
} from "./scenario-evaluation.types";

export type {
  EvaluationCaseResult,
  EvaluationReport,
  Scenario,
  ScenarioMessage,
  ScenarioPlanSummary,
  ScenarioRequiredConstraints,
} from "./scenario-evaluation.types";

export type ProductLookup = (productId: number) => CatalogProduct;

const scenariosPath = resolve(process.cwd(), "tests/evals/scenarios.json");

export async function loadScenarios(): Promise<Scenario[]> {
  const contents = await readFile(scenariosPath, "utf8");
  const scenarios: unknown = JSON.parse(contents);

  if (!Array.isArray(scenarios)) {
    throw new Error("Evaluation scenarios must be an array");
  }

  return scenarios as Scenario[];
}

export function createHistory(
  messages: ScenarioMessage[],
  getProduct: ProductLookup,
): PersistedMessage[] {
  return messages.map((message, index) => ({
    content: message.content,
    createdAt: `2026-07-17T00:00:0${index}.000Z`,
    id: `scenario-message-${index}`,
    productCards: message.productIds.map((productId) =>
      createProductCard(productId, getProduct),
    ),
    role: message.role,
    status: "complete",
  }));
}

export function collectPriorProductIds(history: PersistedMessage[]): number[] {
  return [
    ...new Set(
      history.flatMap((message) =>
        message.productCards.map((product) => product.productId),
      ),
    ),
  ];
}

export function hasSameIds(actual: number[], expected: number[]): boolean {
  return (
    actual.length === expected.length &&
    actual.every((id, index) => id === expected[index])
  );
}

export function checkConstraints(
  scenario: Scenario,
  plan: ScenarioPlanSummary,
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

export function checkForbiddenBehavior(
  forbiddenBehavior: string[],
  selectedProducts: { price: number }[],
  selectedProductIds: number[],
  planMaxPrice: number | null,
  groundedProductIds: Set<number>,
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
    selectedProductIds.some((productId) => !groundedProductIds.has(productId))
  ) {
    failures.push("selected product is not in the fixture catalog");
  }

  return failures;
}

function createProductCard(
  productId: number,
  getProduct: ProductLookup,
): ProductCardSnapshot {
  const product = getProduct(productId);

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
