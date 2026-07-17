import type { Redis } from "ioredis";

import type { CatalogClientContract, CatalogProduct } from "./types";

type CatalogCacheTtlConfig = {
  listTtlSeconds: number;
  detailTtlSeconds: number;
};

type CatalogCacheStats = {
  hits: number;
  misses: number;
};

const CACHE_KEY_PREFIX = "catalog:v1";

export class CachingCatalogClient implements CatalogClientContract {
  private hits = 0;

  private misses = 0;

  public constructor(
    private readonly wrapped: CatalogClientContract,
    private readonly redis: Redis,
    private readonly config: CatalogCacheTtlConfig,
  ) {}

  public async searchProducts(searchTerm: string): Promise<CatalogProduct[]> {
    return this.cached(
      this.buildSearchKey(searchTerm),
      this.config.listTtlSeconds,
      () => this.wrapped.searchProducts(searchTerm),
    );
  }

  public async listCategoryProducts(
    categorySlug: string,
  ): Promise<CatalogProduct[]> {
    return this.cached(
      this.buildCategoryKey(categorySlug),
      this.config.listTtlSeconds,
      () => this.wrapped.listCategoryProducts(categorySlug),
    );
  }

  public async listProducts(): Promise<CatalogProduct[]> {
    return this.cached(
      `${CACHE_KEY_PREFIX}:list:all`,
      this.config.listTtlSeconds,
      () => this.wrapped.listProducts(),
    );
  }

  public async getProduct(productId: number): Promise<CatalogProduct> {
    return this.cached(
      `${CACHE_KEY_PREFIX}:product:${productId}`,
      this.config.detailTtlSeconds,
      () => this.wrapped.getProduct(productId),
    );
  }

  public async listCategorySlugs(): Promise<string[]> {
    return this.cached(
      `${CACHE_KEY_PREFIX}:category-slugs`,
      this.config.detailTtlSeconds,
      () => this.wrapped.listCategorySlugs(),
    );
  }

  public getCacheStats(): CatalogCacheStats {
    return { hits: this.hits, misses: this.misses };
  }

  private async cached<T>(
    key: string,
    ttlSeconds: number,
    fetcher: () => Promise<T>,
  ): Promise<T> {
    const cachedValue = await this.tryRedisGet(key);

    if (cachedValue !== null) {
      this.hits += 1;
      const parsedValue: T = JSON.parse(cachedValue);
      return parsedValue;
    }

    this.misses += 1;
    const result = await fetcher();

    await this.tryRedisSet(key, JSON.stringify(result), ttlSeconds);

    return result;
  }

  private async tryRedisGet(key: string): Promise<string | null> {
    try {
      return await this.redis.get(key);
    } catch (error) {
      console.error(`Catalog cache read failed for key "${key}"`, error);
      return null;
    }
  }

  private async tryRedisSet(
    key: string,
    value: string,
    ttlSeconds: number,
  ): Promise<void> {
    try {
      await this.redis.setex(key, ttlSeconds, value);
    } catch (error) {
      // Fail open: a cache write failure must not fail the underlying request.
      console.error(`Catalog cache write failed for key "${key}"`, error);
    }
  }

  private buildSearchKey(searchTerm: string): string {
    return `${CACHE_KEY_PREFIX}:search:${searchTerm.trim().toLowerCase()}`;
  }

  private buildCategoryKey(categorySlug: string): string {
    return `${CACHE_KEY_PREFIX}:category:${categorySlug.trim().toLowerCase()}`;
  }
}
