import type { ProductCardSnapshot } from "@/domain/conversations/types";

export type CatalogProduct = {
  id: number;
  title: string;
  description: string;
  brand?: string;
  category: string;
  price: number;
  rating: number;
  stock: number;
  availabilityStatus: string;
  thumbnail: string;
  images: string[];
};

export const retrievalIntents = [
  "search",
  "browse_category",
  "product_detail",
  "compare",
  "clarify",
  "unsupported",
] as const;

export type RetrievalIntent = (typeof retrievalIntents)[number];

export const catalogSorts = [
  "relevance",
  "price_asc",
  "price_desc",
  "rating_desc",
] as const;

export type CatalogSort = (typeof catalogSorts)[number];

export type RetrievalPlan = {
  intent: RetrievalIntent;
  searchTerms: string[];
  categorySlug: string | null;
  maxPrice: number | null;
  minRating: number | null;
  inStock: boolean | null;
  sort: CatalogSort;
  isContinuation: boolean;
  referencedProductIds: number[];
  assistantMessage: string | null;
};

export type ValidatedRetrievalPlan = RetrievalPlan & {
  readonly validated: true;
};

export type ResolvedCatalogResult = {
  productCards: ProductCardSnapshot[];
};

export interface CatalogClientContract {
  searchProducts(searchTerm: string): Promise<CatalogProduct[]>;
  listCategoryProducts(categorySlug: string): Promise<CatalogProduct[]>;
  listProducts(): Promise<CatalogProduct[]>;
  getProduct(productId: number): Promise<CatalogProduct>;
  listCategorySlugs(): Promise<string[]>;
}

export type CatalogErrorCode =
  | "INVALID_RETRIEVAL_PLAN"
  | "NOT_FOUND"
  | "UPSTREAM_UNAVAILABLE"
  | "INVALID_UPSTREAM_PAYLOAD";

export class CatalogError extends Error {
  public constructor(
    public readonly code: CatalogErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CatalogError";
  }
}
