export type ExpectedFailure = {
  reason: string;
  scenario: string;
};

export type SuiteEvaluationPolicy = {
  expectedFailures: ExpectedFailure[];
  minimumPassRate: number;
  mustPassScenarios: string[];
};

export type ModelPricing = {
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
};

export type SpendPolicy = {
  maxUsd: number;
  pricing: Record<string, ModelPricing>;
  pricingSource: string;
};

export type OnlineEvaluationPolicy = SuiteEvaluationPolicy & {
  maxScenarios: number;
  spend: SpendPolicy;
};

export type EvaluationConfig = {
  offline: SuiteEvaluationPolicy;
  online: OnlineEvaluationPolicy;
};
