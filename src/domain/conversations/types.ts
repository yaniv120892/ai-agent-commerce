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
  lastSearchTerms: string[];
  lastCategorySlug: string | null;
  focusedProductId: number | null;
  retrievalAnchorMessage: string | null;
};

export type PersistedConversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: PersistedMessage[];
};

export type ConversationSummary = Omit<PersistedConversation, "messages">;

export type ConversationSummaryQuery = {
  limit: number;
  offset: number;
};

export type AppendedAssistantReply = {
  assistantMessage: PersistedMessage;
  state: "created" | "existing" | "retried";
  userMessageContent: string;
};
