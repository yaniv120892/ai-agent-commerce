import "server-only";

import { CachingCatalogClient } from "@/domain/catalog/caching-catalog-client";
import { CatalogClient } from "@/domain/catalog/catalog-client";
import type { CatalogClientContract } from "@/domain/catalog/types";
import { FixtureCatalogClient } from "@/domain/testing/deterministic-clients";
import { environment } from "@/lib/env";
import { redisClient } from "@/lib/redis/redis-client";

const catalogClient: CatalogClientContract = environment.e2eMode
  ? new FixtureCatalogClient()
  : new CachingCatalogClient(
      new CatalogClient(
        fetch,
        environment.dummyJsonBaseUrl,
        environment.dummyJsonTimeoutMs,
      ),
      redisClient,
      {
        listTtlSeconds: environment.catalogCacheListTtlSeconds,
        detailTtlSeconds: environment.catalogCacheDetailTtlSeconds,
      },
    );

export function getCatalogClient(): CatalogClientContract {
  return catalogClient;
}
