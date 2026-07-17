import "server-only";

import { createCatalogClient } from "@/domain/catalog/catalog-client-factory";
import type { CatalogClientContract } from "@/domain/catalog/types";
import { environment } from "@/lib/env";
import { redisClient } from "@/lib/redis/redis-client";

const catalogClient: CatalogClientContract = createCatalogClient({
  e2eMode: environment.e2eMode,
  dummyJsonBaseUrl: environment.dummyJsonBaseUrl,
  dummyJsonTimeoutMs: environment.dummyJsonTimeoutMs,
  redisClient,
  cacheConfig: {
    listTtlSeconds: environment.catalogCacheListTtlSeconds,
    detailTtlSeconds: environment.catalogCacheDetailTtlSeconds,
  },
});

export function getCatalogClient(): CatalogClientContract {
  return catalogClient;
}
