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

export const fixtureCatalog: CatalogProduct[] = [
  {
    availabilityStatus: "In Stock",
    category: "smartphones",
    description: "Compact phone with a dependable camera.",
    id: 101,
    images: ["https://example.test/orbit-phone-mini.png"],
    price: 299,
    rating: 4.5,
    stock: 12,
    thumbnail: "https://example.test/orbit-phone-mini.png",
    title: "Orbit Phone Mini",
  },
  {
    availabilityStatus: "In Stock",
    category: "smartphones",
    description: "Phone with a bright display and long battery life.",
    id: 102,
    images: ["https://example.test/atlas-phone-pro.png"],
    price: 399,
    rating: 4.8,
    stock: 7,
    thumbnail: "https://example.test/atlas-phone-pro.png",
    title: "Atlas Phone Pro",
  },
  {
    availabilityStatus: "Low Stock",
    category: "smartphones",
    description: "Premium phone for demanding mobile work.",
    id: 103,
    images: ["https://example.test/titan-phone-max.png"],
    price: 699,
    rating: 4.9,
    stock: 2,
    thumbnail: "https://example.test/titan-phone-max.png",
    title: "Titan Phone Max",
  },
  {
    availabilityStatus: "In Stock",
    category: "laptops",
    description: "Lightweight laptop for daily work.",
    id: 201,
    images: ["https://example.test/nova-laptop-air.png"],
    price: 749,
    rating: 4.6,
    stock: 9,
    thumbnail: "https://example.test/nova-laptop-air.png",
    title: "Nova Laptop Air",
  },
  {
    availabilityStatus: "Out of Stock",
    category: "tablets",
    description: "Tablet for reading and watching video.",
    id: 301,
    images: ["https://example.test/lyra-tablet.png"],
    price: 349,
    rating: 4.2,
    stock: 0,
    thumbnail: "https://example.test/lyra-tablet.png",
    title: "Lyra Tablet",
  },
];

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
        maxPrice: null,
        minRating: null,
        referencedProductIds: [ordinalProductId],
        searchTerms: [],
        sort: "relevance",
      };
    }

    const categorySlug = this.findCategory(normalizedMessage);

    if (categorySlug !== null && !this.hasSearchIntent(normalizedMessage)) {
      return {
        assistantMessage: null,
        categorySlug,
        inStock: null,
        intent: "browse_category",
        maxPrice: this.findMaximumPrice(normalizedMessage),
        minRating: null,
        referencedProductIds: [],
        searchTerms: [],
        sort: this.findSort(normalizedMessage),
      };
    }

    const searchTerm = this.findSearchTerm(normalizedMessage, input);

    if (searchTerm === null) {
      return this.createNonRetrievalPlan(
        "clarify",
        "Which product category should I search?",
      );
    }

    return {
      assistantMessage: null,
      categorySlug: null,
      inStock: normalizedMessage.includes("in stock") ? true : null,
      intent: "search",
      maxPrice: this.findMaximumPrice(normalizedMessage),
      minRating: null,
      referencedProductIds: [],
      searchTerms: [searchTerm],
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

  private findSearchTerm(value: string, input: ModelPlanInput): string | null {
    const category = this.findCategory(value);

    if (category !== null) {
      return category === "smartphones" ? "phone" : category.slice(0, -1);
    }

    const historyText = input.history
      .map((message) => message.content)
      .join(" ");
    const historyCategory = this.findCategory(this.normalizeText(historyText));

    if (historyCategory === "smartphones") {
      return "phone";
    }

    return historyCategory === null ? null : historyCategory.slice(0, -1);
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

  private hasMultipleRequests(value: string): boolean {
    return value.includes(" and ") && this.findCategory(value) !== null;
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
