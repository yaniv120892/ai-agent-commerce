import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { z } from "zod";

import type { CatalogProduct } from "@/domain/catalog/types";
import { catalogSorts, retrievalIntents } from "@/domain/catalog/types";
import type {
  PersistedMessage,
  ProductCardSnapshot,
} from "@/domain/conversations/types";

import { forbiddenBehaviors } from "./scenario-evaluation.types";
import type {
  ForbiddenBehavior,
  Scenario,
  ScenarioMessage,
  ScenarioPlanSummary,
} from "./scenario-evaluation.types";

export type {
  EvaluationCaseResult,
  EvaluationReport,
  ForbiddenBehavior,
  Scenario,
  ScenarioMessage,
  ScenarioPlanSummary,
  ScenarioRequiredConstraints,
} from "./scenario-evaluation.types";
export { forbiddenBehaviors } from "./scenario-evaluation.types";

export type ProductLookup = (productId: number) => CatalogProduct;

const scenariosPath = resolve(process.cwd(), "tests/evals/scenarios.json");

const scenarioMessageSchema = z
  .object({
    content: z.string().min(1),
    productIds: z.array(z.number().int().positive()),
    role: z.enum(["assistant", "user"]),
  })
  .strict();

const scenarioRequiredConstraintsSchema = z
  .object({
    categorySlug: z.string().min(1).optional(),
    inStock: z.boolean().optional(),
    maxPrice: z.number().finite().nonnegative().optional(),
    referencedProductIds: z.array(z.number().int().positive()).optional(),
    searchTerm: z.string().min(1).optional(),
    selectedProductIds: z.array(z.number().int().positive()).optional(),
    sort: z.enum(catalogSorts).optional(),
  })
  .strict();

const scenarioSchema = z
  .object({
    currentInput: z.string().min(1),
    expectedIntent: z.enum(retrievalIntents),
    fixtureCatalog: z
      .object({ productIds: z.array(z.number().int().positive()) })
      .strict(),
    forbiddenBehavior: z.array(z.enum(forbiddenBehaviors)),
    name: z.string().min(1),
    priorMessages: z.array(scenarioMessageSchema),
    requiredConstraints: scenarioRequiredConstraintsSchema,
  })
  .strict() satisfies z.ZodType<Scenario>;

const scenarioSetSchema = z
  .array(scenarioSchema)
  .min(1)
  .superRefine(reportDuplicateScenarioNames);

export async function loadScenarios(): Promise<Scenario[]> {
  const contents = await readFile(scenariosPath, "utf8");
  const parsedScenarios = scenarioSetSchema.safeParse(JSON.parse(contents));

  if (!parsedScenarios.success) {
    throw new Error(
      `Invalid evaluation scenarios in ${scenariosPath}:\n${z.prettifyError(parsedScenarios.error)}`,
    );
  }

  return parsedScenarios.data;
}

export function createHistory(
  messages: ScenarioMessage[],
  getProduct: ProductLookup,
): PersistedMessage[] {
  return messages.map((message, index) => ({
    content: message.content,
    createdAt: `2026-07-17T00:00:0${index}.000Z`,
    // Scenario messages carry no intent, so infer a focused product from an
    // assistant turn that surfaced exactly one card — the product_detail shape
    // production records focusedProductId for.
    focusedProductId:
      message.role === "assistant" && message.productIds.length === 1
        ? message.productIds[0]
        : null,
    id: `scenario-message-${index}`,
    lastCategorySlug: null,
    lastSearchTerms: [],
    productCards: message.productIds.map((productId) =>
      createProductCard(productId, getProduct),
    ),
    retrievalAnchorMessage: null,
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

  if (scenario.requiredConstraints.categorySlug !== undefined) {
    checks.categorySlug =
      plan.categorySlug === scenario.requiredConstraints.categorySlug;
  }

  if (scenario.requiredConstraints.inStock !== undefined) {
    checks.inStock = plan.inStock === scenario.requiredConstraints.inStock;
  }

  if (scenario.requiredConstraints.sort !== undefined) {
    checks.sort = plan.sort === scenario.requiredConstraints.sort;
  }

  return checks;
}

export function checkForbiddenBehavior(
  forbiddenBehavior: ForbiddenBehavior[],
  selectedProducts: { price: number }[],
  selectedProductIds: number[],
  planMaxPrice: number | null,
  groundedProductIds: Set<number>,
  assistantMessage: string | null = null,
): string[] {
  const failures: string[] = [];

  if (
    forbiddenBehavior.includes("catalog_retrieval") &&
    selectedProductIds.length > 0
  ) {
    failures.push("forbidden catalog retrieval occurred");
  }

  if (
    forbiddenBehavior.includes("invalid_assistant_message") &&
    isInvalidAssistantMessage(assistantMessage)
  ) {
    failures.push(
      `assistant message is not a usable reply: ${JSON.stringify(assistantMessage)}`,
    );
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

function isInvalidAssistantMessage(assistantMessage: string | null): boolean {
  if (assistantMessage === null) {
    return true;
  }

  const normalized = assistantMessage.trim().toLowerCase();

  return normalized.length === 0 || normalized === "null";
}

function reportDuplicateScenarioNames(
  scenarios: { name: string }[],
  context: z.RefinementCtx,
): void {
  const seenNames = new Set<string>();

  for (const [index, scenario] of scenarios.entries()) {
    if (seenNames.has(scenario.name)) {
      context.addIssue({
        code: "custom",
        message: `Duplicate scenario name "${scenario.name}"; names key the expected-failure allowlist and must be unique`,
        path: [index, "name"],
      });
    }

    seenNames.add(scenario.name);
  }
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
