import type { RetrievalPlan } from "../catalog/types";
import type {
  PersistedMessage,
  ProductCardSnapshot,
} from "../conversations/types";

export type { RetrievalPlan } from "../catalog/types";

export type ActiveRetrievalContext = {
  categorySlug: string | null;
};

export type ModelPlanInput = {
  userMessage: string;
  history: PersistedMessage[];
  allowedCategorySlugs: string[];
  priorProductIds: number[];
  activeContext: ActiveRetrievalContext | null;
};

export type ModelReplyInput = {
  userMessage: string;
  intent: RetrievalPlan["intent"];
  products: ProductCardSnapshot[];
};

export type ModelTitleInput = {
  userMessage: string;
};

export interface ModelClient {
  createRetrievalPlan(input: ModelPlanInput): Promise<RetrievalPlan>;
  createGroundedReply(input: ModelReplyInput): Promise<string>;
  createConversationTitle(input: ModelTitleInput): Promise<string>;
}

export type StartConversationInput = {
  content: string;
  clientRequestId: string;
};

export type AppendMessageInput = StartConversationInput & {
  conversationId: string;
};

export type ChatErrorCode =
  | "CATALOG_UNAVAILABLE"
  | "INVALID_MESSAGE"
  | "INVALID_RETRIEVAL_PLAN"
  | "MODEL_UNAVAILABLE"
  | "PERSISTENCE_UNAVAILABLE"
  | "UNKNOWN_CONVERSATION";

export type ChatError = {
  code: ChatErrorCode;
  message: string;
};

export type ChatResponse =
  | {
      status: "complete";
      conversationId: string;
      assistantMessage: PersistedMessage;
    }
  | {
      status: "pending";
      conversationId: string;
      assistantMessage: PersistedMessage;
    }
  | {
      status: "error";
      conversationId: string | null;
      assistantMessage: PersistedMessage | null;
      error: ChatError;
    };
