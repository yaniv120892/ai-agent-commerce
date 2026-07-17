import "server-only";

import type { ReplyCompletion, ReplyCompletionCacheContract } from "./types";

export type { ReplyCompletion } from "./types";

export class InMemoryReplyCompletionCache implements ReplyCompletionCacheContract {
  private readonly completions = new Map<string, ReplyCompletion>();

  public async get(
    conversationId: string,
    assistantMessageId: string,
  ): Promise<ReplyCompletion | null> {
    return (
      this.completions.get(
        this.createKey(conversationId, assistantMessageId),
      ) ?? null
    );
  }

  public async set(
    conversationId: string,
    assistantMessageId: string,
    completion: ReplyCompletion,
  ): Promise<void> {
    this.completions.set(
      this.createKey(conversationId, assistantMessageId),
      completion,
    );
  }

  public async delete(
    conversationId: string,
    assistantMessageId: string,
  ): Promise<void> {
    this.completions.delete(this.createKey(conversationId, assistantMessageId));
  }

  private createKey(
    conversationId: string,
    assistantMessageId: string,
  ): string {
    return `${conversationId}:${assistantMessageId}`;
  }
}
