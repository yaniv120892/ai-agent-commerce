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
      createdAt: "asc",
    },
  },
} as const satisfies Prisma.ConversationInclude;

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
          status: "complete",
        },
      });
      const assistantMessage = await transaction.message.create({
        data: {
          content: "",
          conversationId: conversation.id,
          role: "assistant",
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
    const existingUserMessage = await this.prisma.message.findUnique({
      where: {
        conversationId_clientRequestId: {
          clientRequestId: input.clientRequestId,
          conversationId: input.conversationId,
        },
      },
    });

    if (existingUserMessage) {
      const existingAssistantMessage = await this.findPendingOrFailedAssistant(
        this.prisma,
        input.conversationId,
      );

      if (!existingAssistantMessage) {
        throw new Error(
          "No pending or failed assistant message exists for request",
        );
      }

      return this.mapMessage(existingAssistantMessage);
    }

    return this.prisma.$transaction(async (transaction) => {
      await transaction.message.create({
        data: {
          clientRequestId: input.clientRequestId,
          content: input.content,
          conversationId: input.conversationId,
          role: "user",
          status: "complete",
        },
      });
      const assistantMessage = await transaction.message.create({
        data: {
          content: "",
          conversationId: input.conversationId,
          role: "assistant",
          status: "pending",
        },
      });

      return this.mapMessage({ ...assistantMessage, productCards: [] });
    });
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

  private async findPendingOrFailedAssistant(
    prisma: PrismaClient | Prisma.TransactionClient,
    conversationId: string,
  ): Promise<MessageWithProductCards | null> {
    return prisma.message.findFirst({
      include: productCardInclude,
      orderBy: {
        createdAt: "desc",
      },
      where: {
        conversationId,
        role: "assistant",
        status: {
          in: ["pending", "failed"],
        },
      },
    });
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
