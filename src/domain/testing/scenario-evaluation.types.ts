import type { CatalogSort, RetrievalIntent } from "@/domain/catalog/types";

import type { ScenarioVerdict } from "./evaluation-gate.types";

export const forbiddenBehaviors = [
  "catalog_retrieval",
  "excluded_brand",
  "invalid_assistant_message",
  "over_budget",
  "ungrounded_cards",
] as const;

export type ForbiddenBehavior = (typeof forbiddenBehaviors)[number];

export type ScenarioMessage = {
  content: string;
  productIds: number[];
  role: "assistant" | "user";
};

export type ScenarioRequiredConstraints = {
  categorySlug?: string;
  inStock?: boolean;
  maxPrice?: number;
  minimumSelectedProducts?: number;
  referencedProductIds?: number[];
  searchTerm?: string;
  selectedProductIds?: number[];
  sort?: CatalogSort;
};

export type Scenario = {
  currentInput: string;
  expectedIntent: RetrievalIntent;
  fixtureCatalog: { productIds: number[] };
  forbiddenBehavior: ForbiddenBehavior[];
  forbiddenBrands?: string[];
  name: string;
  priorMessages: ScenarioMessage[];
  requiredConstraints: ScenarioRequiredConstraints;
};

export type ScenarioPlanSummary = {
  assistantMessage: string | null;
  categorySlug: string | null;
  inStock: boolean | null;
  maxPrice: number | null;
  referencedProductIds: number[];
  searchTerms: string[];
  sort: CatalogSort;
};

export type EvaluationCaseResult = {
  actualIntent: RetrievalIntent | null;
  constraintChecks: Record<string, boolean>;
  expectedIntent: RetrievalIntent;
  failures: string[];
  firstPassPlanValid: boolean;
  groundedCards: boolean;
  intentMatches: boolean;
  latencyMs: number;
  name: string;
  plan: ScenarioPlanSummary | null;
  planValid: boolean;
  repairAttempted: boolean;
  selectedProductIds: number[];
};

export type EvaluationSpendSummary = {
  requestCount: number;
  totalUsd: number;
};

export type EvaluationSummary = {
  blockingReasons: string[];
  failed: number;
  firstPassPlanValid: number;
  passRate: number;
  passed: number;
  quarantined: number;
  repairAttempted: number;
  total: number;
};

export type EvaluationReport = {
  generatedAt: string;
  results: EvaluationCaseResult[];
  spend: EvaluationSpendSummary | null;
  summary: EvaluationSummary;
  verdicts: ScenarioVerdict[];
};
