import "server-only";

import { CatalogClient } from "@/domain/catalog/catalog-client";
import type { CatalogClientContract } from "@/domain/catalog/types";
import { FixtureCatalogClient } from "@/domain/testing/deterministic-clients";
import { environment } from "@/lib/env";

export function getCatalogClient(): CatalogClientContract {
  return environment.e2eMode
    ? new FixtureCatalogClient()
    : new CatalogClient(
        fetch,
        environment.dummyJsonBaseUrl,
        environment.dummyJsonTimeoutMs,
      );
}
