import type { Prisma, PrismaClient } from "@/generated/prisma/client";

import type {
  AppendedAssistantReply,
  PersistedConversation,
  PersistedMessage,
  ProductCardSnapshot,
  ConversationSummary,
  ConversationSummaryQuery,
} from "./types";

const productCardInclude = {
  productCards: {
    orderBy: {
      position: "asc",
    },
  },
} as const satisfies Prisma.MessageInclude;

const conversationInclude = {
  messages: {
    include: productCardInclude,
    orderBy: {
      sequence: "asc",
    },
  },
} as const satisfies Prisma.ConversationInclude;

const conversationSummarySelect = {
  createdAt: true,
  id: true,
  title: true,
  updatedAt: true,
} as const satisfies Prisma.ConversationSelect;

const userMessageWithReplyInclude = {
  assistantReply: {
    include: productCardInclude,
  },
} as const satisfies Prisma.MessageInclude;

type ConversationWithMessages = Prisma.ConversationGetPayload<{
  include: typeof conversationInclude;
}>;

type ConversationSummaryRow = Prisma.ConversationGetPayload<{
  select: typeof conversationSummarySelect;
}>;

type MessageWithProductCards = Prisma.MessageGetPayload<{
  include: typeof productCardInclude;
}>;

type RequestLinkedAssistantReply = {
  assistantMessage: MessageWithProductCards;
  userMessageContent: string;
};

type CreateConversationInput = {
  title: string;
  content: string;
  clientRequestId: string;
};

type AppendMessageInput = {
  conversationId: string;
  content: string;
  clientRequestId: string;
};

type CompleteAssistantMessageInput = {
  conversationId: string;
  messageId: string;
  content: string;
  productCards: ProductCardSnapshot[];
  lastSearchTerms: string[];
  lastCategorySlug: string | null;
};

type FailAssistantMessageInput = {
  conversationId: string;
  messageId: string;
};

export class ConversationRepository {
  public constructor(private readonly prisma: PrismaClient) {}

  public async listConversationSummaries(
    query: ConversationSummaryQuery,
  ): Promise<ConversationSummary[]> {
    const conversations = await this.prisma.conversation.findMany({
      orderBy: {
        updatedAt: "desc",
      },
      select: conversationSummarySelect,
      skip: query.offset,
      take: query.limit,
    });

    return conversations.map((conversation) =>
      this.mapConversationSummary(conversation),
    );
  }

  public async getConversation(
    conversationId: string,
  ): Promise<PersistedConversation | null> {
    const conversation = await this.prisma.conversation.findUnique({
      include: conversationInclude,
      where: {
        id: conversationId,
      },
    });

    return conversation ? this.mapConversation(conversation) : null;
  }

  public async createConversationWithPendingReply(
    input: CreateConversationInput,
  ): Promise<PersistedConversation> {
    return this.prisma.$transaction(async (transaction) => {
      const conversation = await transaction.conversation.create({
        data: {
          title: input.title,
        },
      });
      const userMessage = await transaction.message.create({
        data: {
          clientRequestId: input.clientRequestId,
          content: input.content,
          conversationId: conversation.id,
          role: "user",
          sequence: 0,
          status: "complete",
        },
      });
      const assistantMessage = await transaction.message.create({
        data: {
          content: "",
          conversationId: conversation.id,
          replyToMessageId: userMessage.id,
          role: "assistant",
          sequence: 1,
          status: "pending",
        },
      });

      return {
        createdAt: conversation.createdAt.toISOString(),
        id: conversation.id,
        messages: [
          this.mapMessage({ ...userMessage, productCards: [] }),
          this.mapMessage({ ...assistantMessage, productCards: [] }),
        ],
        title: conversation.title,
        updatedAt: conversation.updatedAt.toISOString(),
      };
    });
  }

  public async appendMessageWithPendingReply(
    input: AppendMessageInput,
  ): Promise<AppendedAssistantReply> {
    const existingAssistantMessage = await this.findAssistantReplyForRequest(
      this.prisma,
      input,
    );

    if (existingAssistantMessage) {
      return this.resolveExistingAssistantReply(
        input,
        existingAssistantMessage,
      );
    }

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const sequence = await this.nextMessageSequence(
          transaction,
          input.conversationId,
        );
        const userMessage = await transaction.message.create({
          data: {
            clientRequestId: input.clientRequestId,
            content: input.content,
            conversationId: input.conversationId,
            role: "user",
            sequence,
            status: "complete",
          },
        });
        const assistantMessage = await transaction.message.create({
          data: {
            content: "",
            conversationId: input.conversationId,
            replyToMessageId: userMessage.id,
            role: "assistant",
            sequence: sequence + 1,
            status: "pending",
          },
        });

        return {
          assistantMessage: this.mapMessage({
            ...assistantMessage,
            productCards: [],
          }),
          state: "created",
          userMessageContent: userMessage.content,
        };
      });
    } catch (error) {
      if (!this.isUniqueConstraintError(error)) {
        throw error;
      }

      const retriedAssistantMessage = await this.findAssistantReplyForRequest(
        this.prisma,
        input,
      );

      if (!retriedAssistantMessage) {
        throw error;
      }

      return this.resolveExistingAssistantReply(input, retriedAssistantMessage);
    }
  }

  public async completeAssistantMessage(
    input: CompleteAssistantMessageInput,
  ): Promise<PersistedMessage> {
    return this.prisma.$transaction(async (transaction) => {
      const updatedMessage = await transaction.message.updateMany({
        data: {
          content: input.content,
          lastCategorySlug: input.lastCategorySlug,
          lastSearchTerms: input.lastSearchTerms,
          status: "complete",
        },
        where: {
          conversationId: input.conversationId,
          id: input.messageId,
          role: "assistant",
          status: "pending",
        },
      });

      if (updatedMessage.count !== 1) {
        throw new Error("Pending assistant message was not found");
      }

      await transaction.messageProductCard.deleteMany({
        where: {
          messageId: input.messageId,
        },
      });
      await transaction.messageProductCard.createMany({
        data: input.productCards.map((productCard, position) => ({
          ...productCard,
          messageId: input.messageId,
          position,
        })),
      });
      await transaction.conversation.update({
        data: {
          updatedAt: new Date(),
        },
        where: {
          id: input.conversationId,
        },
      });

      const assistantMessage = await transaction.message.findUnique({
        include: productCardInclude,
        where: {
          id: input.messageId,
        },
      });

      if (!assistantMessage) {
        throw new Error("Completed assistant message was not found");
      }

      return this.mapMessage(assistantMessage);
    });
  }

  public async failAssistantMessage(
    input: FailAssistantMessageInput,
  ): Promise<void> {
    await this.prisma.message.updateMany({
      data: {
        status: "failed",
      },
      where: {
        conversationId: input.conversationId,
        id: input.messageId,
        role: "assistant",
        status: "pending",
      },
    });
  }

  private async findAssistantReplyForRequest(
    prisma: PrismaClient | Prisma.TransactionClient,
    input: AppendMessageInput,
  ): Promise<RequestLinkedAssistantReply | null> {
    const userMessage = await prisma.message.findUnique({
      include: userMessageWithReplyInclude,
      where: {
        conversationId_clientRequestId: {
          clientRequestId: input.clientRequestId,
          conversationId: input.conversationId,
        },
      },
    });

    if (!userMessage?.assistantReply) {
      return null;
    }

    return {
      assistantMessage: userMessage.assistantReply,
      userMessageContent: userMessage.content,
    };
  }

  private async resolveExistingAssistantReply(
    input: AppendMessageInput,
    requestLinkedReply: RequestLinkedAssistantReply,
  ): Promise<AppendedAssistantReply> {
    const { assistantMessage, userMessageContent } = requestLinkedReply;

    if (assistantMessage.status !== "failed") {
      return {
        assistantMessage: this.mapMessage(assistantMessage),
        state: "existing",
        userMessageContent,
      };
    }

    return this.retryFailedAssistantReply(input, assistantMessage.id);
  }

  private async retryFailedAssistantReply(
    input: AppendMessageInput,
    assistantMessageId: string,
  ): Promise<AppendedAssistantReply> {
    return this.prisma.$transaction(async (transaction) => {
      const updatedMessage = await transaction.message.updateMany({
        data: {
          content: "",
          status: "pending",
        },
        where: {
          conversationId: input.conversationId,
          id: assistantMessageId,
          role: "assistant",
          status: "failed",
        },
      });

      const assistantMessage = await this.findAssistantReplyForRequest(
        transaction,
        input,
      );

      if (!assistantMessage) {
        throw new Error("Request-linked assistant message was not found");
      }

      return {
        assistantMessage: this.mapMessage(assistantMessage.assistantMessage),
        state: updatedMessage.count === 1 ? "retried" : "existing",
        userMessageContent: assistantMessage.userMessageContent,
      };
    });
  }

  private async nextMessageSequence(
    prisma: Prisma.TransactionClient,
    conversationId: string,
  ): Promise<number> {
    const lastMessage = await prisma.message.findFirst({
      orderBy: {
        sequence: "desc",
      },
      where: {
        conversationId,
      },
    });

    return (lastMessage?.sequence ?? -1) + 1;
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    );
  }

  private mapConversation(
    conversation: ConversationWithMessages,
  ): PersistedConversation {
    return {
      createdAt: conversation.createdAt.toISOString(),
      id: conversation.id,
      messages: conversation.messages.map((message) =>
        this.mapMessage(message),
      ),
      title: conversation.title,
      updatedAt: conversation.updatedAt.toISOString(),
    };
  }

  private mapConversationSummary(
    conversation: ConversationSummaryRow,
  ): ConversationSummary {
    return {
      createdAt: conversation.createdAt.toISOString(),
      id: conversation.id,
      title: conversation.title,
      updatedAt: conversation.updatedAt.toISOString(),
    };
  }

  private mapMessage(message: MessageWithProductCards): PersistedMessage {
    return {
      content: message.content,
      createdAt: message.createdAt.toISOString(),
      id: message.id,
      lastCategorySlug: message.lastCategorySlug,
      lastSearchTerms: message.lastSearchTerms,
      productCards: message.productCards.map((productCard) =>
        this.mapProductCard(productCard),
      ),
      role: message.role,
      status: message.status,
    };
  }

  private mapProductCard(
    productCard: MessageWithProductCards["productCards"][number],
  ): ProductCardSnapshot {
    return {
      category: productCard.category,
      imageUrl: productCard.imageUrl,
      price: productCard.price.toNumber(),
      productId: productCard.productId,
      rating: productCard.rating?.toNumber() ?? null,
      shortDescription: productCard.shortDescription,
      title: productCard.title,
    };
  }
}
