import { afterEach, describe, expect, it, vi } from "vitest";

import { CachingCatalogClient } from "@/domain/catalog/caching-catalog-client";
import type { CatalogClientContract } from "@/domain/catalog/types";
import { redisClient } from "@/lib/redis/redis-client";

const sampleProduct = {
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
};

const ttlConfig = { listTtlSeconds: 300, detailTtlSeconds: 1800 };

function createWrappedClient(): CatalogClientContract {
  return {
    getProduct: vi.fn().mockResolvedValue(sampleProduct),
    listCategoryProducts: vi.fn().mockResolvedValue([sampleProduct]),
    listCategorySlugs: vi.fn().mockResolvedValue(["smartphones"]),
    listProducts: vi.fn().mockResolvedValue([sampleProduct]),
    searchProducts: vi.fn().mockResolvedValue([sampleProduct]),
  };
}

describe("CachingCatalogClient against a real Redis", () => {
  afterEach(async () => {
    await redisClient.del(
      "catalog:v1:search:phone",
      "catalog:v1:category:smartphones",
      "catalog:v1:list:all",
      "catalog:v1:product:1",
      "catalog:v1:category-slugs",
    );
  });

  it("persists a cached response in Redis across client instances", async () => {
    const wrapped = createWrappedClient();
    const firstClient = new CachingCatalogClient(
      wrapped,
      redisClient,
      ttlConfig,
    );

    await firstClient.searchProducts("phone");

    const secondClient = new CachingCatalogClient(
      createWrappedClient(),
      redisClient,
      ttlConfig,
    );
    const result = await secondClient.searchProducts("phone");

    expect(result).toEqual([sampleProduct]);
    expect(wrapped.searchProducts).toHaveBeenCalledTimes(1);
  });

  it("stores each endpoint under its expected TTL bucket", async () => {
    const client = new CachingCatalogClient(
      createWrappedClient(),
      redisClient,
      ttlConfig,
    );

    await client.getProduct(1);

    const ttl = await redisClient.ttl("catalog:v1:product:1");

    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(ttlConfig.detailTtlSeconds);
  });
});
