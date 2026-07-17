import "server-only";

import { getCatalogClient } from "@/app/api/catalog-dependencies";
import { CatalogResolver } from "@/domain/catalog/catalog-resolver";
import { PlanValidator } from "@/domain/catalog/plan-validator";
import { ChatService } from "@/domain/chat/chat-service";
import { createModelClient } from "@/domain/chat/model-client-factory";
import { PlanRepairService } from "@/domain/chat/plan-repair-service";
import { ReplyCompletionCache } from "@/domain/chat/reply-completion-cache";
import { ConversationRepository } from "@/domain/conversations/conversation-repository";
import { prisma } from "@/lib/db/prisma";
import { environment } from "@/lib/env";

type ConversationApiDependencies = {
  chatService: ChatService;
  conversationRepository: ConversationRepository;
};

const replyCompletionCache = new ReplyCompletionCache();

export function getConversationApiDependencies(): ConversationApiDependencies {
  const conversationRepository = new ConversationRepository(prisma);
  const catalogResolver = new CatalogResolver(getCatalogClient());
  const modelClient = createModelClient({
    e2eMode: environment.e2eMode,
    openAiConfig: {
      apiKey: environment.openAiApiKey,
      maxOutputTokens: environment.openAiMaxOutputTokens,
      maxRetries: environment.openAiMaxRetries,
      models: environment.openAiModels,
      timeoutMs: environment.openAiTimeoutMs,
    },
  });
  const planRepairService = new PlanRepairService(
    modelClient,
    (allowedCategorySlugs) => new PlanValidator(allowedCategorySlugs),
  );

  return {
    chatService: new ChatService(
      conversationRepository,
      catalogResolver,
      modelClient,
      planRepairService,
      replyCompletionCache,
    ),
    conversationRepository,
  };
}
