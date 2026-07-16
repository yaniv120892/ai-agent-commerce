import type { Prisma, PrismaClient } from "@/generated/prisma/client";

import type {
  PersistedConversation,
  PersistedMessage,
  ProductCardSnapshot,
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

const userMessageWithReplyInclude = {
  assistantReply: {
    include: productCardInclude,
  },
} as const satisfies Prisma.MessageInclude;

type ConversationWithMessages = Prisma.ConversationGetPayload<{
  include: typeof conversationInclude;
}>;

type MessageWithProductCards = Prisma.MessageGetPayload<{
  include: typeof productCardInclude;
}>;

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
};

type FailAssistantMessageInput = {
  conversationId: string;
  messageId: string;
};

export class ConversationRepository {
  public constructor(private readonly prisma: PrismaClient) {}

  public async listConversations(): Promise<PersistedConversation[]> {
    const conversations = await this.prisma.conversation.findMany({
      include: conversationInclude,
      orderBy: {
        updatedAt: "desc",
      },
    });

    return conversations.map((conversation) =>
      this.mapConversation(conversation),
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
  ): Promise<PersistedMessage> {
    const existingAssistantMessage = await this.findAssistantReplyForRequest(
      this.prisma,
      input,
    );

    if (existingAssistantMessage) {
      return this.mapMessage(existingAssistantMessage);
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

        return this.mapMessage({ ...assistantMessage, productCards: [] });
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

      return this.mapMessage(retriedAssistantMessage);
    }
  }

  public async completeAssistantMessage(
    input: CompleteAssistantMessageInput,
  ): Promise<PersistedMessage> {
    return this.prisma.$transaction(async (transaction) => {
      const updatedMessage = await transaction.message.updateMany({
        data: {
          content: input.content,
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
  ): Promise<MessageWithProductCards | null> {
    const userMessage = await prisma.message.findUnique({
      include: userMessageWithReplyInclude,
      where: {
        conversationId_clientRequestId: {
          clientRequestId: input.clientRequestId,
          conversationId: input.conversationId,
        },
      },
    });

    return userMessage?.assistantReply ?? null;
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

  private mapMessage(message: MessageWithProductCards): PersistedMessage {
    return {
      content: message.content,
      createdAt: message.createdAt.toISOString(),
      id: message.id,
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
