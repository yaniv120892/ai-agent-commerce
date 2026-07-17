import "server-only";

import type { ProductCardSnapshot } from "../conversations/types";
import type { CompletedRetrievalSummary } from "./types";

export type ReplyCompletion = {
  content: string;
  productCards: ProductCardSnapshot[];
  retrievalSummary: CompletedRetrievalSummary;
  retrievalAnchorMessage: string | null;
};

export class ReplyCompletionCache {
  private readonly completions = new Map<string, ReplyCompletion>();

  public get(
    conversationId: string,
    assistantMessageId: string,
  ): ReplyCompletion | null {
    return (
      this.completions.get(
        this.createKey(conversationId, assistantMessageId),
      ) ?? null
    );
  }

  public set(
    conversationId: string,
    assistantMessageId: string,
    completion: ReplyCompletion,
  ): void {
    this.completions.set(
      this.createKey(conversationId, assistantMessageId),
      completion,
    );
  }

  public delete(conversationId: string, assistantMessageId: string): void {
    this.completions.delete(this.createKey(conversationId, assistantMessageId));
  }

  private createKey(
    conversationId: string,
    assistantMessageId: string,
  ): string {
    return `${conversationId}:${assistantMessageId}`;
  }
}
