import { z } from "zod";

import type { ProductCardSnapshot } from "@/domain/conversations/types";

import {
  CatalogError,
  catalogSorts,
  retrievalIntents,
  type CatalogClientContract,
  type CatalogProduct,
  type ResolvedCatalogResult,
  type RetrievalPlan,
} from "./types";

const retrievalPlanSchema = z
  .object({
    intent: z.enum(retrievalIntents),
    searchTerms: z.array(z.string().trim().min(1).max(100)).max(2),
    categorySlug: z.string().trim().min(1).max(100).nullable(),
    maxPrice: z.number().finite().nonnegative().max(1_000_000).nullable(),
    minRating: z.number().finite().min(0).max(5).nullable(),
    inStock: z.boolean().nullable(),
    sort: z.enum(catalogSorts),
    referencedProductIds: z.array(z.number().int().positive()).max(2),
    assistantMessage: z.string().trim().min(1).max(1_000).nullable(),
  })
  .strict();

type RankedProduct = {
  product: CatalogProduct;
  upstreamIndex: number;
  titleMatchesSearchTerm: boolean;
};

export class CatalogResolver {
  public constructor(private readonly catalogClient: CatalogClientContract) {}

  public async listAllowedCategorySlugs(): Promise<string[]> {
    return this.catalogClient.listCategorySlugs();
  }

  public async resolve(
    plan: RetrievalPlan,
    priorProductIds: number[],
  ): Promise<ResolvedCatalogResult> {
    const allowedCategorySlugs = await this.listAllowedCategorySlugs();
    const validatedPlan = this.validatePlan(
      plan,
      priorProductIds,
      new Set(allowedCategorySlugs),
    );
    const products = await this.retrieveProducts(validatedPlan);
    const productCards = this.rankProducts(products, validatedPlan).map(
      (product) => this.mapProductCard(product),
    );

    return {
      productCards: productCards.slice(0, 6),
    };
  }

  private validatePlan(
    plan: RetrievalPlan,
    priorProductIds: number[],
    allowedCategorySlugs: Set<string>,
  ): RetrievalPlan {
    const parsedPlan = retrievalPlanSchema.safeParse(plan);

    if (!parsedPlan.success) {
      throw new CatalogError(
        "INVALID_RETRIEVAL_PLAN",
        "Retrieval plan has invalid fields",
      );
    }

    const validatedPlan = parsedPlan.data;

    this.validateIntentFields(validatedPlan);

    if (
      validatedPlan.categorySlug !== null &&
      !allowedCategorySlugs.has(validatedPlan.categorySlug)
    ) {
      throw new CatalogError(
        "INVALID_RETRIEVAL_PLAN",
        "Retrieval plan selected an unapproved category",
      );
    }

    const allowedPriorProductIds = new Set(priorProductIds);

    if (
      validatedPlan.referencedProductIds.some(
        (productId) => !allowedPriorProductIds.has(productId),
      )
    ) {
      throw new CatalogError(
        "INVALID_RETRIEVAL_PLAN",
        "Retrieval plan referenced a product outside the conversation",
      );
    }

    return validatedPlan;
  }

  private async retrieveProducts(
    plan: RetrievalPlan,
  ): Promise<CatalogProduct[]> {
    switch (plan.intent) {
      case "search":
        return this.catalogClient.searchProducts(plan.searchTerms.join(" "));
      case "browse_category":
        if (plan.categorySlug !== null) {
          return this.catalogClient.listCategoryProducts(plan.categorySlug);
        }

        return this.catalogClient.listProducts();
      case "product_detail":
      case "compare":
        return Promise.all(
          plan.referencedProductIds.map((productId) =>
            this.catalogClient.getProduct(productId),
          ),
        );
      case "clarify":
      case "unsupported":
        return [];
    }
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
        return;
    }
  }

  private hasFilters(plan: RetrievalPlan): boolean {
    return (
      plan.maxPrice !== null ||
      plan.minRating !== null ||
      plan.inStock !== null ||
      plan.sort !== "relevance"
    );
  }

  private throwInvalidPlan(message: string): never {
    throw new CatalogError("INVALID_RETRIEVAL_PLAN", message);
  }

  private rankProducts(
    products: CatalogProduct[],
    plan: RetrievalPlan,
  ): CatalogProduct[] {
    return products
      .filter((product) => this.matchesFilters(product, plan))
      .map((product, upstreamIndex) => ({
        product,
        upstreamIndex,
        titleMatchesSearchTerm: this.titleMatchesSearchTerm(product, plan),
      }))
      .sort((left, right) => this.compareProducts(left, right, plan))
      .map(({ product }) => product);
  }

  private matchesFilters(
    product: CatalogProduct,
    plan: RetrievalPlan,
  ): boolean {
    if (plan.categorySlug !== null && product.category !== plan.categorySlug) {
      return false;
    }

    if (plan.maxPrice !== null && product.price > plan.maxPrice) {
      return false;
    }

    if (plan.minRating !== null && product.rating < plan.minRating) {
      return false;
    }

    if (plan.inStock === true && product.stock <= 0) {
      return false;
    }

    if (plan.inStock === false && product.stock > 0) {
      return false;
    }

    return true;
  }

  private titleMatchesSearchTerm(
    product: CatalogProduct,
    plan: RetrievalPlan,
  ): boolean {
    const normalizedTitle = this.normalizeText(product.title);
    const titleTokens = new Set(normalizedTitle.split(" "));

    return plan.searchTerms.some((searchTerm) => {
      const normalizedSearchTerm = this.normalizeText(searchTerm);

      return (
        normalizedTitle === normalizedSearchTerm ||
        titleTokens.has(normalizedSearchTerm)
      );
    });
  }

  private compareProducts(
    left: RankedProduct,
    right: RankedProduct,
    plan: RetrievalPlan,
  ): number {
    if (left.titleMatchesSearchTerm !== right.titleMatchesSearchTerm) {
      return (
        Number(right.titleMatchesSearchTerm) -
        Number(left.titleMatchesSearchTerm)
      );
    }

    if (
      plan.sort === "price_asc" &&
      left.product.price !== right.product.price
    ) {
      return left.product.price - right.product.price;
    }

    if (
      plan.sort === "price_desc" &&
      left.product.price !== right.product.price
    ) {
      return right.product.price - left.product.price;
    }

    if (
      plan.sort === "rating_desc" &&
      left.product.rating !== right.product.rating
    ) {
      return right.product.rating - left.product.rating;
    }

    if (plan.sort === "relevance") {
      if (left.upstreamIndex !== right.upstreamIndex) {
        return left.upstreamIndex - right.upstreamIndex;
      }
    }

    return left.product.id - right.product.id;
  }

  private mapProductCard(product: CatalogProduct): ProductCardSnapshot {
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

  private normalizeText(value: string): string {
    return value
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  }
}
