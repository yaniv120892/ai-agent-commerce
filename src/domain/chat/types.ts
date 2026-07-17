import type { RetrievalPlan, ValidatedRetrievalPlan } from "../catalog/types";
import type {
  PersistedMessage,
  ProductCardSnapshot,
} from "../conversations/types";

export type { RetrievalPlan, ValidatedRetrievalPlan } from "../catalog/types";

export type ActiveRetrievalContext = {
  categorySlug: string | null;
};

export type PlanRepairContext = {
  rejectedPlan: RetrievalPlan;
  validationError: string;
};

export type ModelPlanInput = {
  userMessage: string;
  history: PersistedMessage[];
  allowedCategorySlugs: string[];
  priorProductIds: number[];
  activeContext: ActiveRetrievalContext | null;
  repairContext: PlanRepairContext | null;
};

export type PlanRequestInput = Omit<ModelPlanInput, "repairContext">;

export type PlanAttemptOutcome = {
  plan: ValidatedRetrievalPlan;
  firstPassValid: boolean;
  repairAttempted: boolean;
};

export type ModelReplyInput = {
  userMessage: string;
  intent: RetrievalPlan["intent"];
  products: ProductCardSnapshot[];
};

export type OpenAIModelSelection = {
  plannerModel: string;
  replyModel: string;
};

export interface ModelClient {
  createRetrievalPlan(input: ModelPlanInput): Promise<RetrievalPlan>;
  createGroundedReply(input: ModelReplyInput): Promise<string>;
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
