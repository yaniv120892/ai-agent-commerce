import type { RetrievalIntent } from "@/domain/catalog/types";

export const forbiddenBehaviors = [
  "catalog_retrieval",
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
  maxPrice?: number;
  referencedProductIds?: number[];
  searchTerm?: string;
  selectedProductIds?: number[];
};

export type Scenario = {
  currentInput: string;
  expectedIntent: RetrievalIntent;
  fixtureCatalog: { productIds: number[] };
  forbiddenBehavior: ForbiddenBehavior[];
  name: string;
  priorMessages: ScenarioMessage[];
  requiredConstraints: ScenarioRequiredConstraints;
};

export type ScenarioPlanSummary = {
  assistantMessage: string | null;
  maxPrice: number | null;
  referencedProductIds: number[];
  searchTerms: string[];
};

export type EvaluationCaseResult = {
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

export type EvaluationReport = {
  generatedAt: string;
  results: EvaluationCaseResult[];
  summary: {
    failed: number;
    passed: number;
    total: number;
  };
};
