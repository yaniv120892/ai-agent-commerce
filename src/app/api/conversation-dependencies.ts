import "server-only";

import { CachingCatalogClient } from "@/domain/catalog/caching-catalog-client";
import { CatalogClient } from "@/domain/catalog/catalog-client";
import { CatalogResolver } from "@/domain/catalog/catalog-resolver";
import type { CatalogClientContract } from "@/domain/catalog/types";
import { ChatService } from "@/domain/chat/chat-service";
import { OpenAIModelClient } from "@/domain/chat/openai-model-client";
import { ReplyCompletionCache } from "@/domain/chat/reply-completion-cache";
import {
  DeterministicModelClient,
  FixtureCatalogClient,
} from "@/domain/testing/deterministic-clients";
import { ConversationRepository } from "@/domain/conversations/conversation-repository";
import { prisma } from "@/lib/db/prisma";
import { environment } from "@/lib/env";
import { redisClient } from "@/lib/redis/redis-client";

const allowedCategorySlugs = [
  "beauty",
  "fragrances",
  "furniture",
  "groceries",
  "home-decoration",
  "kitchen-accessories",
  "laptops",
  "mens-shirts",
  "mens-shoes",
  "mens-watches",
  "mobile-accessories",
  "motorcycle",
  "skin-care",
  "smartphones",
  "sports-accessories",
  "sunglasses",
  "tablets",
  "tops",
  "vehicle",
  "womens-bags",
  "womens-dresses",
  "womens-jewellery",
  "womens-shoes",
  "womens-watches",
];

type ConversationApiDependencies = {
  chatService: ChatService;
  conversationRepository: ConversationRepository;
};

const replyCompletionCache = new ReplyCompletionCache();
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

export function getConversationApiDependencies(): ConversationApiDependencies {
  const conversationRepository = new ConversationRepository(prisma);
  const catalogResolver = new CatalogResolver(
    catalogClient,
    allowedCategorySlugs,
  );
  const modelClient = environment.e2eMode
    ? new DeterministicModelClient()
    : new OpenAIModelClient(environment.openAiApiKey);

  return {
    chatService: new ChatService(
      conversationRepository,
      catalogResolver,
      modelClient,
      allowedCategorySlugs,
      replyCompletionCache,
    ),
    conversationRepository,
  };
}
