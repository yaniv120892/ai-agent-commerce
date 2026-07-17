import type { ProductCardSnapshot } from "@/domain/conversations/types";

import {
  CatalogError,
  type CatalogClientContract,
  type CatalogProduct,
  type ResolvedCatalogResult,
  type RetrievalPlan,
  type ValidatedRetrievalPlan,
} from "./types";

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
    plan: ValidatedRetrievalPlan,
    allowedCategorySlugs: string[],
    priorProductIds: number[] = [],
  ): Promise<ResolvedCatalogResult> {
    const allowedCategorySlugSet = new Set(allowedCategorySlugs);
    const products = await this.retrieveProducts(plan);
    const rankedProducts = this.rankProducts(products, plan);
    const eligibleProducts = plan.isContinuation
      ? this.excludeShownProducts(rankedProducts, priorProductIds)
      : rankedProducts;
    const productCards = eligibleProducts.map((product) =>
      this.mapProductCard(product, allowedCategorySlugSet),
    );

    return {
      productCards: productCards.slice(0, 6),
    };
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

  private excludeShownProducts(
    products: CatalogProduct[],
    priorProductIds: number[],
  ): CatalogProduct[] {
    const shownProductIds = new Set(priorProductIds);

    return products.filter((product) => !shownProductIds.has(product.id));
  }

  private mapProductCard(
    product: CatalogProduct,
    allowedCategorySlugs: Set<string>,
  ): ProductCardSnapshot {
    if (!allowedCategorySlugs.has(product.category)) {
      throw new CatalogError(
        "INVALID_UPSTREAM_PAYLOAD",
        `Catalog service returned an unapproved category "${product.category}" for product ${product.id}`,
      );
    }

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
