import "server-only";

import { getCatalogClient } from "@/app/api/catalog-dependencies";
import { CatalogResolver } from "@/domain/catalog/catalog-resolver";
import { ChatService } from "@/domain/chat/chat-service";
import { OpenAIModelClient } from "@/domain/chat/openai-model-client";
import { ReplyCompletionCache } from "@/domain/chat/reply-completion-cache";
import { DeterministicModelClient } from "@/domain/testing/deterministic-clients";
import { ConversationRepository } from "@/domain/conversations/conversation-repository";
import { prisma } from "@/lib/db/prisma";
import { environment } from "@/lib/env";

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

export function getConversationApiDependencies(): ConversationApiDependencies {
  const conversationRepository = new ConversationRepository(prisma);
  const catalogResolver = new CatalogResolver(
    getCatalogClient(),
    allowedCategorySlugs,
  );
  const modelClient = environment.e2eMode
    ? new DeterministicModelClient()
    : new OpenAIModelClient({
        apiKey: environment.openAiApiKey,
        maxOutputTokens: environment.openAiMaxOutputTokens,
        maxRetries: environment.openAiMaxRetries,
        models: environment.openAiModels,
        timeoutMs: environment.openAiTimeoutMs,
      });

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
