import RedisMock from "ioredis-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CachingCatalogClient } from "./caching-catalog-client";
import { CatalogError, type CatalogClientContract } from "./types";

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

describe("CachingCatalogClient", () => {
  let redis: RedisMock;

  beforeEach(async () => {
    redis = new RedisMock();
    await redis.flushall();
  });

  it("calls the wrapped client and stores the result on a miss", async () => {
    const wrapped = createWrappedClient();
    const client = new CachingCatalogClient(wrapped, redis, ttlConfig);

    const result = await client.searchProducts("phone");

    expect(result).toEqual([sampleProduct]);
    expect(wrapped.searchProducts).toHaveBeenCalledTimes(1);
    expect(await redis.get("catalog:v1:search:phone")).toEqual(
      JSON.stringify([sampleProduct]),
    );
  });

  it("returns from the cache on a hit without calling the wrapped client", async () => {
    const wrapped = createWrappedClient();
    const client = new CachingCatalogClient(wrapped, redis, ttlConfig);

    await client.searchProducts("phone");
    const result = await client.searchProducts("phone");

    expect(result).toEqual([sampleProduct]);
    expect(wrapped.searchProducts).toHaveBeenCalledTimes(1);
  });

  it("normalizes search terms so equivalent terms share a cache entry", async () => {
    const wrapped = createWrappedClient();
    const client = new CachingCatalogClient(wrapped, redis, ttlConfig);

    await client.searchProducts("Phone");
    await client.searchProducts("  phone  ");

    expect(wrapped.searchProducts).toHaveBeenCalledTimes(1);
  });

  it("uses the list TTL bucket for search/category/list endpoints", async () => {
    const wrapped = createWrappedClient();
    const client = new CachingCatalogClient(wrapped, redis, ttlConfig);

    await client.searchProducts("phone");
    await client.listCategoryProducts("smartphones");
    await client.listProducts();

    expect(await redis.ttl("catalog:v1:search:phone")).toBe(300);
    expect(await redis.ttl("catalog:v1:category:smartphones")).toBe(300);
    expect(await redis.ttl("catalog:v1:list:all")).toBe(300);
  });

  it("uses the detail TTL bucket for product/category-slug endpoints", async () => {
    const wrapped = createWrappedClient();
    const client = new CachingCatalogClient(wrapped, redis, ttlConfig);

    await client.getProduct(1);
    await client.listCategorySlugs();

    expect(await redis.ttl("catalog:v1:product:1")).toBe(1800);
    expect(await redis.ttl("catalog:v1:category-slugs")).toBe(1800);
  });

  it("never caches a thrown CatalogError", async () => {
    const wrapped = createWrappedClient();
    vi.mocked(wrapped.getProduct).mockRejectedValue(
      new CatalogError("NOT_FOUND", "Catalog product was not found"),
    );
    const client = new CachingCatalogClient(wrapped, redis, ttlConfig);

    await expect(client.getProduct(999)).rejects.toThrow(CatalogError);
    await expect(client.getProduct(999)).rejects.toThrow(CatalogError);

    expect(wrapped.getProduct).toHaveBeenCalledTimes(2);
    expect(await redis.get("catalog:v1:product:999")).toBeNull();
  });

  it("falls open to the wrapped client when a Redis read fails", async () => {
    const wrapped = createWrappedClient();
    vi.spyOn(redis, "get").mockRejectedValueOnce(new Error("connection lost"));
    const client = new CachingCatalogClient(wrapped, redis, ttlConfig);

    const result = await client.searchProducts("phone");

    expect(result).toEqual([sampleProduct]);
    expect(wrapped.searchProducts).toHaveBeenCalledTimes(1);
  });

  it("falls open to returning the fetched result when a Redis write fails", async () => {
    const wrapped = createWrappedClient();
    vi.spyOn(redis, "setex").mockRejectedValueOnce(
      new Error("connection lost"),
    );
    const client = new CachingCatalogClient(wrapped, redis, ttlConfig);

    const result = await client.searchProducts("phone");

    expect(result).toEqual([sampleProduct]);
  });

  it("tracks hit/miss counts", async () => {
    const wrapped = createWrappedClient();
    const client = new CachingCatalogClient(wrapped, redis, ttlConfig);

    await client.searchProducts("phone");
    await client.searchProducts("phone");
    await client.searchProducts("tablet");

    expect(client.getCacheStats()).toEqual({ hits: 1, misses: 2 });
  });
});
