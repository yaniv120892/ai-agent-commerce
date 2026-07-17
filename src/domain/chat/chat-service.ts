import type { CatalogResolver } from "../catalog/catalog-resolver";
import { CatalogError } from "../catalog/types";
import type { ConversationRepository } from "../conversations/conversation-repository";
import {
  CONVERSATION_TITLE_MAX_LENGTH,
  MESSAGE_CONTENT_MAX_LENGTH,
} from "../conversations/constants";
import type {
  AppendedAssistantReply,
  PersistedConversation,
  PersistedMessage,
  ProductCardSnapshot,
} from "../conversations/types";

import type {
  ActiveRetrievalContext,
  AppendMessageInput,
  ChatErrorCode,
  ChatResponse,
  ModelClient,
  RetrievalPlan,
  StartConversationInput,
} from "./types";
import { deriveActiveContext } from "./active-context";
import {
  ReplyCompletionCache,
  type ReplyCompletion,
} from "./reply-completion-cache";

type ConversationStore = Pick<
  ConversationRepository,
  | "appendMessageWithPendingReply"
  | "completeAssistantMessage"
  | "createConversationWithPendingReply"
  | "failAssistantMessage"
  | "getConversation"
>;

type CatalogResolution = Pick<CatalogResolver, "resolve">;

type MessageContext = {
  history: PersistedMessage[];
  priorProductIds: number[];
  activeContext: ActiveRetrievalContext | null;
};

export class ChatService {
  public constructor(
    private readonly conversationRepository: ConversationStore,
    private readonly catalogResolver: CatalogResolution,
    private readonly modelClient: ModelClient,
    private readonly allowedCategorySlugs: string[],
    private readonly replyCompletionCache = new ReplyCompletionCache(),
  ) {}

  public async startConversation(
    input: StartConversationInput,
  ): Promise<ChatResponse> {
    const content = this.validateMessage(input.content);

    if (content === null) {
      return this.createErrorResponse(
        "INVALID_MESSAGE",
        `Message content must be between 1 and ${MESSAGE_CONTENT_MAX_LENGTH.toLocaleString("en-US")} characters.`,
        null,
        null,
      );
    }

    let conversation: PersistedConversation;

    try {
      conversation =
        await this.conversationRepository.createConversationWithPendingReply({
          clientRequestId: input.clientRequestId,
          content,
          title: this.createConversationTitle(content),
        });
    } catch {
      return this.createErrorResponse(
        "PERSISTENCE_UNAVAILABLE",
        "Conversation storage is unavailable. Please retry.",
        null,
        null,
      );
    }

    const assistantMessage = this.findPendingAssistantMessage(conversation);

    if (assistantMessage === null) {
      return this.createErrorResponse(
        "PERSISTENCE_UNAVAILABLE",
        "Conversation storage did not create a pending reply.",
        conversation.id,
        null,
      );
    }

    return this.generateReply(
      conversation.id,
      assistantMessage,
      content,
      this.createMessageContext(conversation.messages),
    );
  }

  public async appendMessage(input: AppendMessageInput): Promise<ChatResponse> {
    const content = this.validateMessage(input.content);

    if (content === null) {
      return this.createErrorResponse(
        "INVALID_MESSAGE",
        `Message content must be between 1 and ${MESSAGE_CONTENT_MAX_LENGTH.toLocaleString("en-US")} characters.`,
        input.conversationId,
        null,
      );
    }

    let conversation: PersistedConversation | null;

    try {
      conversation = await this.conversationRepository.getConversation(
        input.conversationId,
      );
    } catch {
      return this.createErrorResponse(
        "PERSISTENCE_UNAVAILABLE",
        "Conversation storage is unavailable. Please retry.",
        input.conversationId,
        null,
      );
    }

    if (conversation === null) {
      return this.createErrorResponse(
        "UNKNOWN_CONVERSATION",
        "This conversation is no longer available.",
        input.conversationId,
        null,
      );
    }

    const messageContext = this.createMessageContext(conversation.messages);
    let appendedReply: AppendedAssistantReply;

    try {
      appendedReply =
        await this.conversationRepository.appendMessageWithPendingReply({
          clientRequestId: input.clientRequestId,
          content,
          conversationId: input.conversationId,
        });
    } catch {
      return this.createErrorResponse(
        "PERSISTENCE_UNAVAILABLE",
        "Conversation storage is unavailable. Please retry.",
        input.conversationId,
        null,
      );
    }

    const { assistantMessage } = appendedReply;

    const cachedCompletion = this.replyCompletionCache.get(
      input.conversationId,
      assistantMessage.id,
    );

    if (assistantMessage.status === "pending" && cachedCompletion !== null) {
      return this.completeAssistantMessage(
        input.conversationId,
        assistantMessage,
        cachedCompletion.content,
        cachedCompletion.productCards,
      );
    }

    if (appendedReply.state === "existing") {
      return this.returnExistingAssistantReply(
        input.conversationId,
        assistantMessage,
      );
    }

    return this.generateReply(
      input.conversationId,
      assistantMessage,
      appendedReply.userMessageContent,
      messageContext,
    );
  }

  private async generateReply(
    conversationId: string,
    assistantMessage: PersistedMessage,
    userMessage: string,
    messageContext: MessageContext,
  ): Promise<ChatResponse> {
    let plan: RetrievalPlan;

    try {
      plan = await this.modelClient.createRetrievalPlan({
        activeContext: messageContext.activeContext,
        allowedCategorySlugs: this.allowedCategorySlugs,
        history: messageContext.history,
        priorProductIds: messageContext.priorProductIds,
        userMessage,
      });
    } catch {
      return this.failAssistantMessage(
        "MODEL_UNAVAILABLE",
        "The assistant is temporarily unavailable. Please retry.",
        conversationId,
        assistantMessage,
      );
    }

    if (plan.intent === "clarify" || plan.intent === "unsupported") {
      if (plan.assistantMessage === null) {
        return this.failAssistantMessage(
          "INVALID_RETRIEVAL_PLAN",
          "The assistant returned an invalid response. Please retry.",
          conversationId,
          assistantMessage,
        );
      }

      return this.completeAssistantMessage(
        conversationId,
        assistantMessage,
        plan.assistantMessage,
        [],
      );
    }

    let productCards: ProductCardSnapshot[];

    try {
      const result = await this.catalogResolver.resolve(
        plan,
        messageContext.priorProductIds,
      );
      productCards = result.productCards;
    } catch (error) {
      const code =
        error instanceof CatalogError && error.code === "INVALID_RETRIEVAL_PLAN"
          ? "INVALID_RETRIEVAL_PLAN"
          : "CATALOG_UNAVAILABLE";

      return this.failAssistantMessage(
        code,
        "Catalog results are temporarily unavailable. Please retry.",
        conversationId,
        assistantMessage,
      );
    }

    let content: string;

    try {
      content = await this.modelClient.createGroundedReply({
        intent: plan.intent,
        products: productCards,
        userMessage,
      });
    } catch {
      return this.failAssistantMessage(
        "MODEL_UNAVAILABLE",
        "The assistant is temporarily unavailable. Please retry.",
        conversationId,
        assistantMessage,
      );
    }

    return this.completeAssistantMessage(
      conversationId,
      assistantMessage,
      content,
      productCards,
    );
  }

  private returnExistingAssistantReply(
    conversationId: string,
    assistantMessage: PersistedMessage,
  ): ChatResponse {
    if (assistantMessage.status === "complete") {
      return {
        assistantMessage,
        conversationId,
        status: "complete",
      };
    }

    if (assistantMessage.status === "pending") {
      return {
        assistantMessage,
        conversationId,
        status: "pending",
      };
    }

    return this.createErrorResponse(
      "MODEL_UNAVAILABLE",
      "The previous assistant request failed. Please retry.",
      conversationId,
      assistantMessage,
    );
  }

  private async completeAssistantMessage(
    conversationId: string,
    assistantMessage: PersistedMessage,
    content: string,
    productCards: ProductCardSnapshot[],
  ): Promise<ChatResponse> {
    try {
      const completedAssistantMessage =
        await this.conversationRepository.completeAssistantMessage({
          content,
          conversationId,
          messageId: assistantMessage.id,
          productCards,
        });
      this.replyCompletionCache.delete(conversationId, assistantMessage.id);

      return {
        assistantMessage: completedAssistantMessage,
        conversationId,
        status: "complete",
      };
    } catch {
      this.replyCompletionCache.set(conversationId, assistantMessage.id, {
        content,
        productCards,
      });

      return this.failAssistantMessage(
        "PERSISTENCE_UNAVAILABLE",
        "Conversation storage is unavailable. Please retry.",
        conversationId,
        assistantMessage,
      );
    }
  }

  private async failAssistantMessage(
    code: Extract<
      ChatErrorCode,
      | "CATALOG_UNAVAILABLE"
      | "INVALID_RETRIEVAL_PLAN"
      | "MODEL_UNAVAILABLE"
      | "PERSISTENCE_UNAVAILABLE"
    >,
    message: string,
    conversationId: string,
    assistantMessage: PersistedMessage,
  ): Promise<ChatResponse> {
    try {
      await this.conversationRepository.failAssistantMessage({
        conversationId,
        messageId: assistantMessage.id,
      });
    } catch {
      return this.createErrorResponse(
        "PERSISTENCE_UNAVAILABLE",
        "Conversation storage is unavailable. Please retry.",
        conversationId,
        assistantMessage,
      );
    }

    return this.createErrorResponse(code, message, conversationId, {
      ...assistantMessage,
      status: "failed",
    });
  }

  private createMessageContext(messages: PersistedMessage[]): MessageContext {
    const history = messages
      .filter((message) => message.status === "complete")
      .slice(-12);

    return {
      activeContext: deriveActiveContext(history),
      history,
      priorProductIds: [
        ...new Set(
          history.flatMap((message) =>
            message.productCards.map((productCard) => productCard.productId),
          ),
        ),
      ],
    };
  }

  private findPendingAssistantMessage(
    conversation: PersistedConversation,
  ): PersistedMessage | null {
    return (
      conversation.messages.find(
        (message) =>
          message.role === "assistant" && message.status === "pending",
      ) ?? null
    );
  }

  private validateMessage(content: string): string | null {
    const trimmedContent = content.trim();

    if (
      trimmedContent.length === 0 ||
      trimmedContent.length > MESSAGE_CONTENT_MAX_LENGTH
    ) {
      return null;
    }

    return trimmedContent;
  }

  private createConversationTitle(content: string): string {
    return content.slice(0, CONVERSATION_TITLE_MAX_LENGTH);
  }

  private createErrorResponse(
    code: ChatErrorCode,
    message: string,
    conversationId: string | null,
    assistantMessage: PersistedMessage | null,
  ): ChatResponse {
    return {
      assistantMessage,
      conversationId,
      error: {
        code,
        message,
      },
      status: "error",
    };
  }
}
