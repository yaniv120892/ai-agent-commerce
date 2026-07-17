import type {
  CatalogProduct,
  CatalogClientContract,
  RetrievalPlan,
} from "@/domain/catalog/types";
import { CatalogError } from "@/domain/catalog/types";
import type {
  ModelClient,
  ModelPlanInput,
  ModelReplyInput,
} from "@/domain/chat/types";

import { fixtureCatalog } from "./fixture-catalog";

export { fixtureCatalog, getFixtureProduct } from "./fixture-catalog";

export class FixtureCatalogClient implements CatalogClientContract {
  public constructor(
    private readonly products: CatalogProduct[] = fixtureCatalog,
  ) {}

  public async searchProducts(searchTerm: string): Promise<CatalogProduct[]> {
    const normalizedSearchTerm = this.normalizeText(searchTerm).replace(
      /s$/u,
      "",
    );

    return this.products.filter((product) =>
      this.normalizeText(
        `${product.title} ${product.description} ${product.category}`,
      ).includes(normalizedSearchTerm),
    );
  }

  public async listCategoryProducts(
    categorySlug: string,
  ): Promise<CatalogProduct[]> {
    return this.products.filter((product) => product.category === categorySlug);
  }

  public async listProducts(): Promise<CatalogProduct[]> {
    return this.products;
  }

  public async getProduct(productId: number): Promise<CatalogProduct> {
    const product = this.products.find((item) => item.id === productId);

    if (product === undefined) {
      throw new CatalogError("NOT_FOUND", "Catalog product was not found");
    }

    return product;
  }

  public async listCategorySlugs(): Promise<string[]> {
    return [...new Set(this.products.map((product) => product.category))];
  }

  private normalizeText(value: string): string {
    return value
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  }
}

// Ignores input.repairContext: this fake only ever emits plans that pass
// PlanValidator, so the repair path is unreachable here by construction.
// PlanRepairService's own tests cover repair with purpose-built stubs.
export class DeterministicModelClient implements ModelClient {
  public async createRetrievalPlan(
    input: ModelPlanInput,
  ): Promise<RetrievalPlan> {
    const normalizedMessage = this.normalizeText(input.userMessage);

    if (this.isPromptInjection(normalizedMessage)) {
      return this.createNonRetrievalPlan(
        "unsupported",
        "I can only help with products in this catalog.",
      );
    }

    if (this.isOffCatalogRequest(normalizedMessage)) {
      return this.createNonRetrievalPlan(
        "unsupported",
        "I can only help with products in this catalog.",
      );
    }

    const retryCategorySlug =
      input.activeContext?.lastAttemptedSearch?.categorySlug;

    if (
      retryCategorySlug !== undefined &&
      retryCategorySlug !== null &&
      this.isAgreement(normalizedMessage)
    ) {
      return {
        assistantMessage: null,
        categorySlug: retryCategorySlug,
        inStock: null,
        intent: "browse_category",
        isContinuation: false,
        maxPrice: null,
        minRating: null,
        referencedProductIds: [],
        searchTerms: [],
        sort: "relevance",
      };
    }

    if (normalizedMessage.includes("compare")) {
      return this.createComparisonPlan(input.priorProductIds);
    }

    if (this.hasMultipleRequests(normalizedMessage)) {
      return this.createNonRetrievalPlan(
        "clarify",
        "Please choose one product request at a time.",
      );
    }

    const ordinalProductId = this.resolveOrdinalReference(
      normalizedMessage,
      input.priorProductIds,
    );

    if (ordinalProductId !== null) {
      return {
        assistantMessage: null,
        categorySlug: null,
        inStock: null,
        intent: "product_detail",
        isContinuation: false,
        maxPrice: null,
        minRating: null,
        referencedProductIds: [ordinalProductId],
        searchTerms: [],
        sort: "relevance",
      };
    }

    if (
      this.hasContinuationIntent(normalizedMessage) &&
      input.activeContext?.lastResolvedUserMessage != null
    ) {
      const replayedPlan = this.buildSearchOrBrowsePlan(
        this.normalizeText(input.activeContext.lastResolvedUserMessage),
        input,
      );

      return { ...replayedPlan, isContinuation: true };
    }

    return this.buildSearchOrBrowsePlan(normalizedMessage, input);
  }

  private buildSearchOrBrowsePlan(
    normalizedMessage: string,
    input: ModelPlanInput,
  ): RetrievalPlan {
    const categorySlug = this.findCategory(normalizedMessage);

    if (categorySlug !== null && !this.hasSearchIntent(normalizedMessage)) {
      return {
        assistantMessage: null,
        categorySlug,
        inStock: null,
        intent: "browse_category",
        isContinuation: false,
        maxPrice: this.findMaximumPrice(normalizedMessage),
        minRating: null,
        referencedProductIds: [],
        searchTerms: [],
        sort: this.findSort(normalizedMessage),
      };
    }

    const searchTerms = this.findSearchTerms(normalizedMessage, input);

    if (searchTerms === null) {
      return this.createNonRetrievalPlan(
        "clarify",
        "Which product category should I search?",
      );
    }

    return {
      assistantMessage: null,
      categorySlug:
        categorySlug === null
          ? (input.activeContext?.categorySlug ?? null)
          : null,
      inStock: normalizedMessage.includes("in stock") ? true : null,
      intent: "search",
      isContinuation: false,
      maxPrice: this.findMaximumPrice(normalizedMessage),
      minRating: null,
      referencedProductIds: [],
      searchTerms,
      sort: this.findSort(normalizedMessage),
    };
  }

  public async createGroundedReply(input: ModelReplyInput): Promise<string> {
    if (input.products.length === 0) {
      return "I could not find a matching catalog product.";
    }

    return `I found ${input.products.length} matching catalog product${input.products.length === 1 ? "" : "s"}.`;
  }

  private createComparisonPlan(priorProductIds: number[]): RetrievalPlan {
    if (priorProductIds.length < 2) {
      return this.createNonRetrievalPlan(
        "clarify",
        "Please ask about two products before requesting a comparison.",
      );
    }

    return {
      assistantMessage: null,
      categorySlug: null,
      inStock: null,
      intent: "compare",
      isContinuation: false,
      maxPrice: null,
      minRating: null,
      referencedProductIds: priorProductIds.slice(0, 2),
      searchTerms: [],
      sort: "relevance",
    };
  }

  private createNonRetrievalPlan(
    intent: "clarify" | "unsupported",
    assistantMessage: string,
  ): RetrievalPlan {
    return {
      assistantMessage,
      categorySlug: null,
      inStock: null,
      intent,
      isContinuation: false,
      maxPrice: null,
      minRating: null,
      referencedProductIds: [],
      searchTerms: [],
      sort: "relevance",
    };
  }

  private findCategory(value: string): string | null {
    if (value.includes("smartphone") || value.includes("phone")) {
      return "smartphones";
    }

    if (value.includes("laptop")) {
      return "laptops";
    }

    if (value.includes("tablet")) {
      return "tablets";
    }

    return null;
  }

  private findMaximumPrice(value: string): number | null {
    const match = value.match(/(?:under|below|less than|\$)\s*\$?(\d+)/u);

    return match === null ? null : Number(match[1]);
  }

  private findSearchTerms(
    value: string,
    input: ModelPlanInput,
  ): string[] | null {
    const category = this.findCategory(value);

    if (category !== null) {
      return [this.categoryToSearchTerm(category)];
    }

    const activeCategorySlug = input.activeContext?.categorySlug ?? null;

    if (activeCategorySlug === null) {
      return null;
    }

    return [
      this.categoryToSearchTerm(activeCategorySlug),
      ...this.extractAttributeTerms(value),
    ].slice(0, 2);
  }

  private categoryToSearchTerm(categorySlug: string): string {
    return categorySlug === "smartphones" ? "phone" : categorySlug.slice(0, -1);
  }

  private extractAttributeTerms(value: string): string[] {
    const ignoredTerms = new Set([
      "a",
      "again",
      "an",
      "and",
      "another",
      "are",
      "below",
      "best",
      "cheapest",
      "else",
      "expensive",
      "find",
      "for",
      "highest",
      "i",
      "in",
      "is",
      "it",
      "least",
      "less",
      "lowest",
      "me",
      "more",
      "most",
      "need",
      "of",
      "on",
      "one",
      "only",
      "or",
      "others",
      "please",
      "price",
      "rated",
      "search",
      "show",
      "some",
      "than",
      "that",
      "the",
      "this",
      "under",
      "want",
      "with",
      "עוד",
    ]);

    return value
      .split(" ")
      .filter(
        (token) =>
          token.length > 0 &&
          !ignoredTerms.has(token) &&
          !/^\$?\d+$/u.test(token),
      )
      .slice(0, 1);
  }

  private findSort(value: string): RetrievalPlan["sort"] {
    if (value.includes("cheapest") || value.includes("lowest price")) {
      return "price_asc";
    }

    if (value.includes("most expensive") || value.includes("highest price")) {
      return "price_desc";
    }

    if (value.includes("highest rated") || value.includes("best rated")) {
      return "rating_desc";
    }

    return "relevance";
  }

  private hasContinuationIntent(value: string): boolean {
    const continuationTokens = new Set([
      "more",
      "another",
      "others",
      "else",
      "again",
      "עוד",
    ]);

    return value.split(" ").some((token) => continuationTokens.has(token));
  }

  private hasMultipleRequests(value: string): boolean {
    return value.includes(" and ") && this.findCategory(value) !== null;
  }

  private isAgreement(value: string): boolean {
    return [
      "do it",
      "sure",
      "yes",
      "yeah",
      "ok",
      "okay",
      "go ahead",
      "try that",
    ].some((phrase) => value.includes(phrase));
  }

  private hasSearchIntent(value: string): boolean {
    return /(?:show|find|search|need|want|under|below|cheapest|highest)/u.test(
      value,
    );
  }

  private isOffCatalogRequest(value: string): boolean {
    return /(?:flight|hotel|restaurant|weather)/u.test(value);
  }

  private isPromptInjection(value: string): boolean {
    return /(?:ignore previous|system prompt|developer message|jailbreak)/u.test(
      value,
    );
  }

  private normalizeText(value: string): string {
    return value
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}$]+/gu, " ")
      .trim();
  }

  private resolveOrdinalReference(
    value: string,
    priorProductIds: number[],
  ): number | null {
    if (value.includes("first") && priorProductIds[0] !== undefined) {
      return priorProductIds[0];
    }

    if (value.includes("second") && priorProductIds[1] !== undefined) {
      return priorProductIds[1];
    }

    return null;
  }
}
