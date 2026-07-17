import "server-only";

import type { Redis } from "ioredis";

import type { ReplyCompletion, ReplyCompletionCacheContract } from "./types";

const CACHE_KEY_PREFIX = "reply-completion:v1";

export class RedisReplyCompletionCache implements ReplyCompletionCacheContract {
  public constructor(
    private readonly redis: Redis,
    private readonly ttlSeconds: number,
  ) {}

  public async get(
    conversationId: string,
    assistantMessageId: string,
  ): Promise<ReplyCompletion | null> {
    try {
      const cachedValue = await this.redis.get(
        this.createKey(conversationId, assistantMessageId),
      );

      if (cachedValue === null) {
        return null;
      }

      const parsedValue: ReplyCompletion = JSON.parse(cachedValue);
      return parsedValue;
    } catch (error) {
      console.error(
        `Reply completion cache read failed for conversation "${conversationId}"`,
        error,
      );
      return null;
    }
  }

  public async set(
    conversationId: string,
    assistantMessageId: string,
    completion: ReplyCompletion,
  ): Promise<void> {
    try {
      await this.redis.setex(
        this.createKey(conversationId, assistantMessageId),
        this.ttlSeconds,
        JSON.stringify(completion),
      );
    } catch (error) {
      // Fail open: a cache write failure must not fail the underlying request.
      console.error(
        `Reply completion cache write failed for conversation "${conversationId}"`,
        error,
      );
    }
  }

  public async delete(
    conversationId: string,
    assistantMessageId: string,
  ): Promise<void> {
    try {
      await this.redis.del(this.createKey(conversationId, assistantMessageId));
    } catch (error) {
      console.error(
        `Reply completion cache delete failed for conversation "${conversationId}"`,
        error,
      );
    }
  }

  private createKey(
    conversationId: string,
    assistantMessageId: string,
  ): string {
    return `${CACHE_KEY_PREFIX}:${conversationId}:${assistantMessageId}`;
  }
}
