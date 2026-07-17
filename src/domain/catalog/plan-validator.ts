import { z } from "zod";

import {
  CatalogError,
  type RetrievalPlan,
  type ValidatedRetrievalPlan,
} from "./types";

const retrievalPlanSchema = z
  .object({
    intent: z.enum([
      "search",
      "browse_category",
      "product_detail",
      "compare",
      "clarify",
      "unsupported",
    ]),
    searchTerms: z.array(z.string().trim().min(1).max(100)).max(2),
    categorySlug: z.string().trim().min(1).max(100).nullable(),
    maxPrice: z.number().finite().nonnegative().max(1_000_000).nullable(),
    minRating: z.number().finite().min(0).max(5).nullable(),
    inStock: z.boolean().nullable(),
    sort: z.enum(["relevance", "price_asc", "price_desc", "rating_desc"]),
    isContinuation: z.boolean(),
    referencedProductIds: z.array(z.number().int().positive()).max(2),
    assistantMessage: z.string().trim().min(1).max(1_000).nullable(),
  })
  .strict();

export class PlanValidator {
  private readonly allowedCategorySlugs: Set<string>;

  public constructor(allowedCategorySlugs: string[]) {
    this.allowedCategorySlugs = new Set(allowedCategorySlugs);
  }

  public validate(
    plan: RetrievalPlan,
    priorProductIds: number[],
  ): ValidatedRetrievalPlan {
    const parsedPlan = retrievalPlanSchema.safeParse(plan);

    if (!parsedPlan.success) {
      throw new CatalogError(
        "INVALID_RETRIEVAL_PLAN",
        "Retrieval plan has invalid fields",
      );
    }

    const validatedPlan = parsedPlan.data;

    this.validateIntentFields(validatedPlan);
    this.validateCategorySlug(validatedPlan);
    this.validateReferencedProductIds(validatedPlan, priorProductIds);

    return { ...validatedPlan, validated: true };
  }

  private validateIntentFields(plan: RetrievalPlan): void {
    switch (plan.intent) {
      case "search":
        if (
          plan.searchTerms.length === 0 ||
          plan.referencedProductIds.length > 0
        ) {
          this.throwInvalidPlan(
            "Search plans require text and no product references",
          );
        }
        return;
      case "browse_category":
        if (
          plan.searchTerms.length > 0 ||
          plan.referencedProductIds.length > 0
        ) {
          this.throwInvalidPlan(
            "Category browsing plans cannot contain text or product references",
          );
        }
        return;
      case "product_detail":
        if (
          plan.categorySlug !== null ||
          plan.searchTerms.length > 0 ||
          plan.referencedProductIds.length !== 1 ||
          this.hasFilters(plan)
        ) {
          this.throwInvalidPlan(
            "Product detail plans require one product reference only",
          );
        }
        return;
      case "compare":
        if (
          plan.categorySlug !== null ||
          plan.searchTerms.length > 0 ||
          plan.referencedProductIds.length !== 2 ||
          this.hasFilters(plan)
        ) {
          this.throwInvalidPlan(
            "Comparison plans require two product references only",
          );
        }
        return;
      case "clarify":
      case "unsupported":
        if (
          plan.categorySlug !== null ||
          plan.searchTerms.length > 0 ||
          plan.referencedProductIds.length > 0 ||
          this.hasFilters(plan) ||
          plan.sort !== "relevance"
        ) {
          this.throwInvalidPlan(
            "Non-retrieval plans cannot contain catalog constraints",
          );
        }

        if (plan.assistantMessage === null) {
          this.throwInvalidPlan(
            `Non-retrieval plans require an assistantMessage (intent: ${plan.intent})`,
          );
        }
        return;
    }
  }

  private validateCategorySlug(plan: RetrievalPlan): void {
    if (
      plan.categorySlug !== null &&
      !this.allowedCategorySlugs.has(plan.categorySlug)
    ) {
      this.throwInvalidPlan(
        `Retrieval plan selected an unapproved category (categorySlug: ${plan.categorySlug})`,
      );
    }
  }

  private validateReferencedProductIds(
    plan: RetrievalPlan,
    priorProductIds: number[],
  ): void {
    const allowedPriorProductIds = new Set(priorProductIds);
    const unknownProductIds = plan.referencedProductIds.filter(
      (productId) => !allowedPriorProductIds.has(productId),
    );

    if (unknownProductIds.length > 0) {
      this.throwInvalidPlan(
        `Retrieval plan referenced a product outside the conversation (productIds: ${unknownProductIds.join(", ")})`,
      );
    }

    const distinctProductIds = new Set(plan.referencedProductIds);
    if (distinctProductIds.size !== plan.referencedProductIds.length) {
      this.throwInvalidPlan(
        `Retrieval plan referenced the same product more than once (productIds: ${plan.referencedProductIds.join(", ")})`,
      );
    }
  }

  private hasFilters(plan: RetrievalPlan): boolean {
    return (
      plan.maxPrice !== null ||
      plan.minRating !== null ||
      plan.inStock !== null ||
      plan.sort !== "relevance" ||
      plan.isContinuation
    );
  }

  private throwInvalidPlan(message: string): never {
    throw new CatalogError("INVALID_RETRIEVAL_PLAN", message);
  }
}
