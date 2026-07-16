export type MessageRole = "user" | "assistant";
export type MessageStatus = "pending" | "complete" | "failed";

export type ProductCardSnapshot = {
  productId: number;
  title: string;
  shortDescription: string;
  price: number;
  imageUrl: string;
  category: string;
  rating: number | null;
};

export type PersistedMessage = {
  id: string;
  role: MessageRole;
  content: string;
  status: MessageStatus;
  createdAt: string;
  productCards: ProductCardSnapshot[];
};

export type PersistedConversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: PersistedMessage[];
};

export type AppendedAssistantReply = {
  assistantMessage: PersistedMessage;
  state: "created" | "existing" | "retried";
};
