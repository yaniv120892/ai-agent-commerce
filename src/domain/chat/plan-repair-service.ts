import type { PlanValidator } from "../catalog/plan-validator";
import { CatalogError, type RetrievalPlan } from "../catalog/types";

import type {
  ModelClient,
  PlanAttemptOutcome,
  PlanRepairContext,
  PlanRequestInput,
} from "./types";

type PlanValidation = Pick<PlanValidator, "validate">;

type PlanCreation = Pick<ModelClient, "createRetrievalPlan">;

export class PlanRepairService {
  public constructor(
    private readonly modelClient: PlanCreation,
    private readonly planValidator: PlanValidation,
    private readonly allowedCategorySlugs: string[],
  ) {}

  public async createValidPlan(
    input: PlanRequestInput,
  ): Promise<PlanAttemptOutcome> {
    const firstAttempt = await this.createPlan(input, null);

    try {
      return {
        firstPassValid: true,
        plan: this.planValidator.validate(firstAttempt, input.priorProductIds),
        repairAttempted: false,
      };
    } catch (error) {
      if (!this.isInvalidPlanError(error)) {
        throw error;
      }

      return this.repairPlan(input, firstAttempt, error.message);
    }
  }

  private async repairPlan(
    input: PlanRequestInput,
    rejectedPlan: RetrievalPlan,
    validationError: string,
  ): Promise<PlanAttemptOutcome> {
    const repairedPlan = await this.createPlan(input, {
      rejectedPlan,
      validationError,
    });

    return {
      firstPassValid: false,
      plan: this.planValidator.validate(repairedPlan, input.priorProductIds),
      repairAttempted: true,
    };
  }

  private async createPlan(
    input: PlanRequestInput,
    repairContext: PlanRepairContext | null,
  ): Promise<RetrievalPlan> {
    return this.modelClient.createRetrievalPlan({
      activeContext: input.activeContext,
      allowedCategorySlugs: this.allowedCategorySlugs,
      history: input.history,
      priorProductIds: input.priorProductIds,
      repairContext,
      userMessage: input.userMessage,
    });
  }

  private isInvalidPlanError(error: unknown): error is CatalogError {
    return (
      error instanceof CatalogError && error.code === "INVALID_RETRIEVAL_PLAN"
    );
  }
}
