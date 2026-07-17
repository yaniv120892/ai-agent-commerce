import "server-only";

import type { Redis } from "ioredis";

import { FixtureCatalogClient } from "@/domain/testing/deterministic-clients";

import { CachingCatalogClient } from "./caching-catalog-client";
import { CatalogClient } from "./catalog-client";
import type { CatalogClientContract } from "./types";

export type CreateCatalogClientOptions = {
  e2eMode: boolean;
  dummyJsonBaseUrl: string;
  dummyJsonTimeoutMs: number;
  redisClient: Redis;
  cacheConfig: {
    listTtlSeconds: number;
    detailTtlSeconds: number;
  };
};

export function createCatalogClient(
  options: CreateCatalogClientOptions,
): CatalogClientContract {
  if (options.e2eMode) {
    return new FixtureCatalogClient();
  }

  return new CachingCatalogClient(
    new CatalogClient(
      fetch,
      options.dummyJsonBaseUrl,
      options.dummyJsonTimeoutMs,
    ),
    options.redisClient,
    options.cacheConfig,
  );
}
