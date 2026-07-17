import "server-only";

import { CachingCatalogClient } from "@/domain/catalog/caching-catalog-client";
import { CatalogClient } from "@/domain/catalog/catalog-client";
import type { CatalogClientContract } from "@/domain/catalog/types";
import { FixtureCatalogClient } from "@/domain/testing/deterministic-clients";
import { environment } from "@/lib/env";
import { redisClient } from "@/lib/redis/redis-client";

function createCatalogClient(): CatalogClientContract {
  if (environment.e2eMode) {
    return new FixtureCatalogClient();
  }

  const originClient = new CatalogClient(
    fetch,
    environment.dummyJsonBaseUrl,
    environment.dummyJsonTimeoutMs,
  );

  if (redisClient === null) {
    return originClient;
  }

  return new CachingCatalogClient(originClient, redisClient, {
    listTtlSeconds: environment.catalogCacheListTtlSeconds,
    detailTtlSeconds: environment.catalogCacheDetailTtlSeconds,
  });
}

const catalogClient: CatalogClientContract = createCatalogClient();

export function getCatalogClient(): CatalogClientContract {
  return catalogClient;
}
