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

type CreatePlanValidator = (allowedCategorySlugs: string[]) => PlanValidation;

export class PlanRepairService {
  public constructor(
    private readonly modelClient: PlanCreation,
    private readonly createPlanValidator: CreatePlanValidator,
  ) {}

  public async createValidPlan(
    input: PlanRequestInput,
  ): Promise<PlanAttemptOutcome> {
    const planValidator = this.createPlanValidator(input.allowedCategorySlugs);
    const firstAttempt = await this.createPlan(input, null);

    try {
      return {
        firstPassValid: true,
        plan: planValidator.validate(firstAttempt, input.priorProductIds),
        repairAttempted: false,
      };
    } catch (error) {
      if (!this.isInvalidPlanError(error)) {
        throw error;
      }

      return this.repairPlan(input, planValidator, firstAttempt, error.message);
    }
  }

  private async repairPlan(
    input: PlanRequestInput,
    planValidator: PlanValidation,
    rejectedPlan: RetrievalPlan,
    validationError: string,
  ): Promise<PlanAttemptOutcome> {
    const repairedPlan = await this.createPlan(input, {
      rejectedPlan,
      validationError,
    });

    return {
      firstPassValid: false,
      plan: planValidator.validate(repairedPlan, input.priorProductIds),
      repairAttempted: true,
    };
  }

  private async createPlan(
    input: PlanRequestInput,
    repairContext: PlanRepairContext | null,
  ): Promise<RetrievalPlan> {
    return this.modelClient.createRetrievalPlan({ ...input, repairContext });
  }

  private isInvalidPlanError(error: unknown): error is CatalogError {
    return (
      error instanceof CatalogError && error.code === "INVALID_RETRIEVAL_PLAN"
    );
  }
}
