import type { RetrievalPlan, ValidatedRetrievalPlan } from "../catalog/types";
import type {
  PersistedMessage,
  ProductCardSnapshot,
} from "../conversations/types";

export type { RetrievalPlan, ValidatedRetrievalPlan } from "../catalog/types";

export type LastAttemptedSearch = {
  searchTerms: string[];
  categorySlug: string | null;
};

export type ActiveRetrievalContext = {
  categorySlug: string | null;
  lastAttemptedSearch: LastAttemptedSearch | null;
  lastResolvedUserMessage: string | null;
};

export type CompletedRetrievalSummary = {
  searchTerms: string[];
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
  requestId: string;
};

export type AppendMessageInput = StartConversationInput & {
  conversationId: string;
};

export type ModelErrorCode =
  "AUTH_FAILED" | "RATE_LIMITED" | "TIMEOUT" | "REFUSED" | "UNAVAILABLE";

export class ModelError extends Error {
  public constructor(
    public readonly code: ModelErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "ModelError";
  }
}

export type ChatErrorCode =
  | "CATALOG_UNAVAILABLE"
  | "INVALID_MESSAGE"
  | "INVALID_RETRIEVAL_PLAN"
  | "MODEL_AUTH_FAILED"
  | "MODEL_RATE_LIMITED"
  | "MODEL_REFUSED"
  | "MODEL_TIMEOUT"
  | "MODEL_UNAVAILABLE"
  | "PERSISTENCE_UNAVAILABLE"
  | "UNKNOWN_CONVERSATION";

export const retryableByChatErrorCode = {
  CATALOG_UNAVAILABLE: true,
  INVALID_MESSAGE: false,
  INVALID_RETRIEVAL_PLAN: false,
  MODEL_AUTH_FAILED: false,
  MODEL_RATE_LIMITED: true,
  MODEL_REFUSED: false,
  MODEL_TIMEOUT: true,
  MODEL_UNAVAILABLE: true,
  PERSISTENCE_UNAVAILABLE: true,
  UNKNOWN_CONVERSATION: false,
} satisfies Record<ChatErrorCode, boolean>;

export type ChatError = {
  code: ChatErrorCode;
  message: string;
  retryable: boolean;
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
