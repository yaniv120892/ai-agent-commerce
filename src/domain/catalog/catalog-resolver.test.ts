import { describe, expect, it, vi } from "vitest";

import { CatalogClient } from "./catalog-client";
import { CatalogResolver } from "./catalog-resolver";
import type { RetrievalPlan } from "./types";

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

function createPlan(overrides: Partial<RetrievalPlan> = {}): RetrievalPlan {
  return {
    intent: "search",
    searchTerms: ["phone"],
    categorySlug: null,
    maxPrice: null,
    minRating: null,
    inStock: null,
    sort: "relevance",
    referencedProductIds: [],
    assistantMessage: null,
    ...overrides,
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
  it("filters a search result by max price and sorts ascending by price", async () => {
    const catalogClient = createCatalogClient();
    const resolver = new CatalogResolver(catalogClient, ["smartphones"]);

    const result = await resolver.resolve(
      createPlan({ maxPrice: 300, sort: "price_asc" }),
      [],
    );

    expect(result.productCards.map((product) => product.productId)).toEqual([
      2, 3,
    ]);
    expect(catalogClient.searchProducts).toHaveBeenCalledWith("phone");
  });

  it("rejects a category not present in the category allowlist", async () => {
    const catalogClient = createCatalogClient();
    const resolver = new CatalogResolver(catalogClient, ["smartphones"]);

    await expect(
      resolver.resolve(
        createPlan({
          categorySlug: "unapproved-category",
          intent: "browse_category",
          searchTerms: [],
        }),
        [],
      ),
    ).rejects.toMatchObject({ code: "INVALID_RETRIEVAL_PLAN" });

    expect(catalogClient.searchProducts).not.toHaveBeenCalled();
    expect(catalogClient.listCategoryProducts).not.toHaveBeenCalled();
    expect(catalogClient.listProducts).not.toHaveBeenCalled();
  });

  it("resolves ordinal references only from prior conversation product IDs", async () => {
    const catalogClient = createCatalogClient();
    const resolver = new CatalogResolver(catalogClient, ["smartphones"]);

    await expect(
      resolver.resolve(
        createPlan({
          intent: "product_detail",
          referencedProductIds: [12],
          searchTerms: [],
        }),
        [10, 11],
      ),
    ).rejects.toMatchObject({ code: "INVALID_RETRIEVAL_PLAN" });

    expect(catalogClient.getProduct).not.toHaveBeenCalled();
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
    const resolver = new CatalogResolver(catalogClient, ["smartphones"]);

    const result = await resolver.resolve(createPlan(), []);

    expect(result.productCards.map((product) => product.productId)).toEqual([
      1, 2,
    ]);
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
