import { describe, expect, it, vi } from "vitest";

import { CatalogClient } from "./catalog-client";
import { CatalogResolver } from "./catalog-resolver";
import type { RetrievalPlan, ValidatedRetrievalPlan } from "./types";

const allowedCategorySlugs = ["smartphones", "laptops"];

const catalogProducts = [
  {
    id: 1,
    title: "Phone Ultra",
    description: "Premium phone",
    category: "smartphones",
    price: 399,
    rating: 4.8,
    stock: 8,
    availabilityStatus: "In Stock",
    thumbnail: "https://example.test/1.png",
    images: ["https://example.test/1.png"],
  },
  {
    id: 2,
    title: "Phone Mini",
    description: "Compact phone",
    category: "smartphones",
    price: 199,
    rating: 4.5,
    stock: 12,
    availabilityStatus: "In Stock",
    thumbnail: "https://example.test/2.png",
    images: ["https://example.test/2.png"],
  },
  {
    id: 3,
    title: "Phone Plus",
    description: "Large phone",
    category: "smartphones",
    price: 299,
    rating: 4.6,
    stock: 5,
    availabilityStatus: "In Stock",
    thumbnail: "https://example.test/3.png",
    images: ["https://example.test/3.png"],
  },
];

function createPlan(
  overrides: Partial<RetrievalPlan> = {},
): ValidatedRetrievalPlan {
  return {
    intent: "search",
    searchTerms: ["phone"],
    categorySlug: null,
    maxPrice: null,
    minRating: null,
    inStock: null,
    sort: "relevance",
    isContinuation: false,
    referencedProductIds: [],
    assistantMessage: null,
    ...overrides,
    validated: true,
  };
}

function createCatalogClient() {
  return {
    getProduct: vi.fn(),
    listCategoryProducts: vi.fn(),
    listCategorySlugs: vi.fn(),
    listProducts: vi.fn(),
    searchProducts: vi.fn().mockResolvedValue(catalogProducts),
  };
}

describe("CatalogResolver", () => {
  it("delegates the allowed category allowlist to the catalog client", async () => {
    const catalogClient = createCatalogClient();
    catalogClient.listCategorySlugs.mockResolvedValue(["smartphones"]);
    const resolver = new CatalogResolver(catalogClient);

    await expect(resolver.listAllowedCategorySlugs()).resolves.toEqual([
      "smartphones",
    ]);
  });

  it("filters a search result by max price and sorts ascending by price", async () => {
    const catalogClient = createCatalogClient();
    const resolver = new CatalogResolver(catalogClient);

    const result = await resolver.resolve(
      createPlan({ maxPrice: 300, sort: "price_asc" }),
      allowedCategorySlugs,
    );

    expect(result.productCards.map((product) => product.productId)).toEqual([
      2, 3,
    ]);
    expect(catalogClient.searchProducts).toHaveBeenCalledWith("phone");
  });

  it("ranks an exact normalized title token above an earlier non-match", async () => {
    const catalogClient = createCatalogClient();
    catalogClient.searchProducts.mockResolvedValue([
      {
        ...catalogProducts[0],
        id: 2,
        title: "Premium Device",
      },
      {
        ...catalogProducts[1],
        id: 1,
        title: "Phone Mini",
      },
    ]);
    const resolver = new CatalogResolver(catalogClient);

    const result = await resolver.resolve(createPlan(), allowedCategorySlugs);

    expect(result.productCards.map((product) => product.productId)).toEqual([
      1, 2,
    ]);
  });

  it("uses the category endpoint for a valid category browse", async () => {
    const catalogClient = createCatalogClient();
    catalogClient.listCategoryProducts.mockResolvedValue(catalogProducts);
    const resolver = new CatalogResolver(catalogClient);

    await resolver.resolve(
      createPlan({
        categorySlug: "smartphones",
        intent: "browse_category",
        searchTerms: [],
      }),
      allowedCategorySlugs,
    );

    expect(catalogClient.listCategoryProducts).toHaveBeenCalledWith(
      "smartphones",
    );
    expect(catalogClient.searchProducts).not.toHaveBeenCalled();
  });

  it("uses the generic products endpoint for a category browse without a category", async () => {
    const catalogClient = createCatalogClient();
    catalogClient.listProducts.mockResolvedValue(catalogProducts);
    const resolver = new CatalogResolver(catalogClient);

    await resolver.resolve(
      createPlan({
        intent: "browse_category",
        searchTerms: [],
      }),
      allowedCategorySlugs,
    );

    expect(catalogClient.listProducts).toHaveBeenCalledOnce();
    expect(catalogClient.listCategoryProducts).not.toHaveBeenCalled();
    expect(catalogClient.searchProducts).not.toHaveBeenCalled();
  });

  it("uses the product details endpoint for a valid product detail", async () => {
    const catalogClient = createCatalogClient();
    catalogClient.getProduct.mockResolvedValue(catalogProducts[0]);
    const resolver = new CatalogResolver(catalogClient);

    await resolver.resolve(
      createPlan({
        intent: "product_detail",
        referencedProductIds: [1],
        searchTerms: [],
      }),
      allowedCategorySlugs,
    );

    expect(catalogClient.getProduct).toHaveBeenCalledWith(1);
    expect(catalogClient.searchProducts).not.toHaveBeenCalled();
  });

  it("uses the product details endpoint for a valid comparison", async () => {
    const catalogClient = createCatalogClient();
    catalogClient.getProduct
      .mockResolvedValueOnce(catalogProducts[0])
      .mockResolvedValueOnce(catalogProducts[1]);
    const resolver = new CatalogResolver(catalogClient);

    await resolver.resolve(
      createPlan({
        intent: "compare",
        referencedProductIds: [1, 2],
        searchTerms: [],
      }),
      allowedCategorySlugs,
    );

    expect(catalogClient.getProduct).toHaveBeenNthCalledWith(1, 1);
    expect(catalogClient.getProduct).toHaveBeenNthCalledWith(2, 2);
    expect(catalogClient.searchProducts).not.toHaveBeenCalled();
  });

  it("applies category, rating, and stock filters locally", async () => {
    const catalogClient = createCatalogClient();
    catalogClient.searchProducts.mockResolvedValue([
      {
        ...catalogProducts[0],
        id: 4,
        rating: 4.7,
        stock: 3,
      },
      {
        ...catalogProducts[1],
        id: 5,
        rating: 4.4,
      },
      {
        ...catalogProducts[2],
        category: "laptops",
        id: 6,
        rating: 4.9,
      },
      {
        ...catalogProducts[2],
        id: 7,
        rating: 4.9,
        stock: 0,
      },
    ]);
    const resolver = new CatalogResolver(catalogClient);

    const result = await resolver.resolve(
      createPlan({
        categorySlug: "smartphones",
        inStock: true,
        minRating: 4.5,
      }),
      allowedCategorySlugs,
    );

    expect(result.productCards.map((product) => product.productId)).toEqual([
      4,
    ]);
  });

  it("throws on an upstream product whose category is not in the allowlist", async () => {
    const catalogClient = createCatalogClient();
    catalogClient.searchProducts.mockResolvedValue([
      { ...catalogProducts[0], category: "unapproved-category" },
    ]);
    const resolver = new CatalogResolver(catalogClient);

    await expect(
      resolver.resolve(createPlan(), allowedCategorySlugs),
    ).rejects.toMatchObject({ code: "INVALID_UPSTREAM_PAYLOAD" });
  });

  it("caps resolved product cards at six", async () => {
    const catalogClient = createCatalogClient();
    catalogClient.searchProducts.mockResolvedValue(
      Array.from({ length: 7 }, (_, index) => ({
        ...catalogProducts[0],
        id: index + 1,
      })),
    );
    const resolver = new CatalogResolver(catalogClient);

    const result = await resolver.resolve(createPlan(), allowedCategorySlugs);

    expect(result.productCards).toHaveLength(6);
  });

  it("does not exclude prior product IDs when isContinuation is false", async () => {
    const catalogClient = createCatalogClient();
    const resolver = new CatalogResolver(catalogClient);

    const result = await resolver.resolve(
      createPlan(),
      allowedCategorySlugs,
      [1, 2, 3],
    );

    expect(result.productCards.map((product) => product.productId)).toEqual([
      1, 2, 3,
    ]);
  });

  it("excludes prior product IDs from the ranked list before the six-card cap when isContinuation is true", async () => {
    const catalogClient = createCatalogClient();
    catalogClient.searchProducts.mockResolvedValue(
      Array.from({ length: 9 }, (_, index) => ({
        ...catalogProducts[0],
        id: index + 1,
      })),
    );
    const resolver = new CatalogResolver(catalogClient);

    const result = await resolver.resolve(
      createPlan({ isContinuation: true }),
      allowedCategorySlugs,
      [1, 2, 3, 4, 5, 6],
    );

    expect(result.productCards.map((product) => product.productId)).toEqual([
      7, 8, 9,
    ]);
  });

  it("returns an empty result rather than throwing when a continuation has already shown every candidate", async () => {
    const catalogClient = createCatalogClient();
    const resolver = new CatalogResolver(catalogClient);

    const result = await resolver.resolve(
      createPlan({ isContinuation: true }),
      allowedCategorySlugs,
      [1, 2, 3],
    );

    expect(result.productCards).toEqual([]);
  });
});

describe("CatalogClient", () => {
  it("uses the configured base URL with fixed paths and encoded search values", async () => {
    const fetchFunction = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ products: catalogProducts }), {
        status: 200,
      }),
    );
    const catalogClient = new CatalogClient(
      fetchFunction,
      "https://dummyjson.test",
      100,
    );

    await catalogClient.searchProducts("phone case&cover");

    expect(fetchFunction).toHaveBeenCalledOnce();
    expect(fetchFunction.mock.calls[0][0].toString()).toBe(
      "https://dummyjson.test/products/search?limit=100&q=phone+case%26cover",
    );
  });

  it("retries a server error once before returning a validated response", async () => {
    const fetchFunction = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ products: catalogProducts }), {
          status: 200,
        }),
      );
    const catalogClient = new CatalogClient(
      fetchFunction,
      "https://dummyjson.test",
      100,
    );

    const products = await catalogClient.listProducts();

    expect(products.map((product) => product.id)).toEqual([1, 2, 3]);
    expect(fetchFunction).toHaveBeenCalledTimes(2);
  });

  it("retries a network failure once before returning a validated response", async () => {
    const fetchFunction = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Network unavailable"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ products: catalogProducts }), {
          status: 200,
        }),
      );
    const catalogClient = new CatalogClient(
      fetchFunction,
      "https://dummyjson.test",
      100,
    );

    const products = await catalogClient.listProducts();

    expect(products.map((product) => product.id)).toEqual([1, 2, 3]);
    expect(fetchFunction).toHaveBeenCalledTimes(2);
  });

  it("aborts timed out requests and retries once", async () => {
    vi.useFakeTimers();
    const fetchFunction = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Timed out", "AbortError"));
          });
        }),
    );
    const catalogClient = new CatalogClient(
      fetchFunction,
      "https://dummyjson.test",
      100,
    );

    try {
      const result = catalogClient.listProducts();
      const rejectedResult = expect(result).rejects.toMatchObject({
        code: "UPSTREAM_UNAVAILABLE",
      });

      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(100);

      await rejectedResult;
      expect(fetchFunction).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("maps malformed successful responses to an invalid upstream payload error", async () => {
    const fetchFunction = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ products: [{ id: "not-a-number" }] }), {
        status: 200,
      }),
    );
    const catalogClient = new CatalogClient(
      fetchFunction,
      "https://dummyjson.test",
      100,
    );

    await expect(catalogClient.listProducts()).rejects.toMatchObject({
      code: "INVALID_UPSTREAM_PAYLOAD",
    });
  });
});
