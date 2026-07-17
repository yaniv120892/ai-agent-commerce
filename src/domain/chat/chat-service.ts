import type { CatalogResolver } from "../catalog/catalog-resolver";
import { CatalogError } from "../catalog/types";
import type { PlanRepairService } from "./plan-repair-service";
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

import {
  ModelError,
  retryableByChatErrorCode,
  type ActiveRetrievalContext,
  type AppendMessageInput,
  type ChatErrorCode,
  type ChatResponse,
  type CompletedRetrievalSummary,
  type ModelClient,
  type PlanAttemptOutcome,
  type RetrievalPlan,
  type StartConversationInput,
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

type CatalogResolution = Pick<
  CatalogResolver,
  "listAllowedCategorySlugs" | "resolve"
>;

type PlanCreation = Pick<PlanRepairService, "createValidPlan">;

type MessageContext = {
  history: PersistedMessage[];
  priorProductIds: number[];
  activeContext: ActiveRetrievalContext | null;
};

type ModelChatErrorCode = Extract<
  ChatErrorCode,
  | "MODEL_AUTH_FAILED"
  | "MODEL_RATE_LIMITED"
  | "MODEL_REFUSED"
  | "MODEL_TIMEOUT"
  | "MODEL_UNAVAILABLE"
>;

const modelErrorMessageByChatErrorCode: Record<ModelChatErrorCode, string> = {
  MODEL_AUTH_FAILED:
    "The assistant is not configured correctly. Please contact support.",
  MODEL_RATE_LIMITED:
    "The assistant is receiving too many requests. Please retry in a moment.",
  MODEL_REFUSED:
    "The assistant could not generate a response for that request.",
  MODEL_TIMEOUT: "The assistant took too long to respond. Please retry.",
  MODEL_UNAVAILABLE: "The assistant is temporarily unavailable. Please retry.",
};

const INVALID_RETRIEVAL_PLAN_MESSAGE =
  "The assistant could not turn that request into a valid catalog lookup. Try rephrasing.";

export class ChatService {
  public constructor(
    private readonly conversationRepository: ConversationStore,
    private readonly catalogResolver: CatalogResolution,
    private readonly modelClient: ModelClient,
    private readonly planRepairService: PlanCreation,
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
      input.requestId,
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
        cachedCompletion.retrievalSummary,
        cachedCompletion.retrievalAnchorMessage,
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
      input.requestId,
    );
  }

  private async generateReply(
    conversationId: string,
    assistantMessage: PersistedMessage,
    userMessage: string,
    messageContext: MessageContext,
    requestId: string,
  ): Promise<ChatResponse> {
    let allowedCategorySlugs: string[];

    try {
      allowedCategorySlugs =
        await this.catalogResolver.listAllowedCategorySlugs();
    } catch {
      return this.failAssistantMessage(
        "CATALOG_UNAVAILABLE",
        "Catalog categories are temporarily unavailable. Please retry.",
        conversationId,
        assistantMessage,
      );
    }

    let planOutcome: PlanAttemptOutcome;

    try {
      planOutcome = await this.planRepairService.createValidPlan({
        activeContext: messageContext.activeContext,
        allowedCategorySlugs,
        history: messageContext.history,
        priorProductIds: messageContext.priorProductIds,
        userMessage,
      });
    } catch (error) {
      if (
        error instanceof CatalogError &&
        error.code === "INVALID_RETRIEVAL_PLAN"
      ) {
        return this.failAssistantMessage(
          "INVALID_RETRIEVAL_PLAN",
          INVALID_RETRIEVAL_PLAN_MESSAGE,
          conversationId,
          assistantMessage,
        );
      }

      return this.failFromModelError(
        error,
        requestId,
        conversationId,
        assistantMessage,
      );
    }

    this.logPlanValidation(planOutcome);

    const plan = planOutcome.plan;

    if (plan.intent === "clarify" || plan.intent === "unsupported") {
      if (plan.assistantMessage === null) {
        return this.failAssistantMessage(
          "INVALID_RETRIEVAL_PLAN",
          INVALID_RETRIEVAL_PLAN_MESSAGE,
          conversationId,
          assistantMessage,
        );
      }

      return this.completeAssistantMessage(
        conversationId,
        assistantMessage,
        plan.assistantMessage,
        [],
        { categorySlug: null, searchTerms: [] },
        null,
      );
    }

    let productCards: ProductCardSnapshot[];

    try {
      const result = await this.catalogResolver.resolve(
        plan,
        allowedCategorySlugs,
        messageContext.priorProductIds,
      );
      productCards = result.productCards;
    } catch (error) {
      if (
        error instanceof CatalogError &&
        error.code === "INVALID_RETRIEVAL_PLAN"
      ) {
        return this.failAssistantMessage(
          "INVALID_RETRIEVAL_PLAN",
          INVALID_RETRIEVAL_PLAN_MESSAGE,
          conversationId,
          assistantMessage,
        );
      }

      return this.failAssistantMessage(
        "CATALOG_UNAVAILABLE",
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
    } catch (error) {
      return this.failFromModelError(
        error,
        requestId,
        conversationId,
        assistantMessage,
      );
    }

    return this.completeAssistantMessage(
      conversationId,
      assistantMessage,
      content,
      productCards,
      { categorySlug: plan.categorySlug, searchTerms: plan.searchTerms },
      this.computeRetrievalAnchorMessage(plan, userMessage, messageContext),
    );
  }

  private computeRetrievalAnchorMessage(
    plan: RetrievalPlan,
    userMessage: string,
    messageContext: MessageContext,
  ): string | null {
    if (plan.intent !== "search" && plan.intent !== "browse_category") {
      return null;
    }

    if (!plan.isContinuation) {
      return userMessage;
    }

    return messageContext.activeContext?.lastResolvedUserMessage ?? userMessage;
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
    retrievalSummary: CompletedRetrievalSummary,
    retrievalAnchorMessage: string | null,
  ): Promise<ChatResponse> {
    try {
      const completedAssistantMessage =
        await this.conversationRepository.completeAssistantMessage({
          content,
          conversationId,
          lastCategorySlug: retrievalSummary.categorySlug,
          lastSearchTerms: retrievalSummary.searchTerms,
          messageId: assistantMessage.id,
          productCards,
          retrievalAnchorMessage,
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
        retrievalSummary,
        retrievalAnchorMessage,
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
      | "MODEL_AUTH_FAILED"
      | "MODEL_RATE_LIMITED"
      | "MODEL_REFUSED"
      | "MODEL_TIMEOUT"
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

  private failFromModelError(
    error: unknown,
    requestId: string,
    conversationId: string,
    assistantMessage: PersistedMessage,
  ): Promise<ChatResponse> {
    const code = this.toModelChatErrorCode(error);
    console.error("Model call failed", {
      code,
      conversationId,
      error,
      requestId,
    });

    return this.failAssistantMessage(
      code,
      modelErrorMessageByChatErrorCode[code],
      conversationId,
      assistantMessage,
    );
  }

  private toModelChatErrorCode(error: unknown): ModelChatErrorCode {
    if (!(error instanceof ModelError)) {
      return "MODEL_UNAVAILABLE";
    }

    switch (error.code) {
      case "AUTH_FAILED":
        return "MODEL_AUTH_FAILED";
      case "RATE_LIMITED":
        return "MODEL_RATE_LIMITED";
      case "REFUSED":
        return "MODEL_REFUSED";
      case "TIMEOUT":
        return "MODEL_TIMEOUT";
      case "UNAVAILABLE":
        return "MODEL_UNAVAILABLE";
      default:
        return "MODEL_UNAVAILABLE";
    }
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

  private logPlanValidation(planOutcome: PlanAttemptOutcome): void {
    console.info(
      JSON.stringify({
        event: "plan_validation",
        firstPassValid: planOutcome.firstPassValid,
        repairAttempted: planOutcome.repairAttempted,
      }),
    );
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
        retryable: retryableByChatErrorCode[code],
      },
      status: "error",
    };
  }
}
