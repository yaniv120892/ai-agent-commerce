import RedisMock from "ioredis-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RedisReplyCompletionCache } from "./redis-reply-completion-cache";
import type { ReplyCompletion } from "./types";

const ttlSeconds = 300;

const sampleCompletion: ReplyCompletion = {
  content: "Phone Ultra is a match.",
  productCards: [],
  retrievalAnchorMessage: "Show me a phone.",
  retrievalSummary: { categorySlug: null, searchTerms: ["phone"] },
};

describe("RedisReplyCompletionCache", () => {
  let redis: RedisMock;

  beforeEach(async () => {
    redis = new RedisMock();
    await redis.flushall();
  });

  it("returns null on a miss", async () => {
    const cache = new RedisReplyCompletionCache(redis, ttlSeconds);

    await expect(cache.get("conversation-1", "message-1")).resolves.toBeNull();
  });

  it("stores and retrieves a completion under the conversation/message key", async () => {
    const cache = new RedisReplyCompletionCache(redis, ttlSeconds);

    await cache.set("conversation-1", "message-1", sampleCompletion);

    await expect(cache.get("conversation-1", "message-1")).resolves.toEqual(
      sampleCompletion,
    );
    expect(
      await redis.get("reply-completion:v1:conversation-1:message-1"),
    ).toEqual(JSON.stringify(sampleCompletion));
  });

  it("stores the completion under the configured TTL", async () => {
    const cache = new RedisReplyCompletionCache(redis, ttlSeconds);

    await cache.set("conversation-1", "message-1", sampleCompletion);

    expect(
      await redis.ttl("reply-completion:v1:conversation-1:message-1"),
    ).toBe(ttlSeconds);
  });

  it("is readable from a second cache instance sharing the same Redis client", async () => {
    const firstInstance = new RedisReplyCompletionCache(redis, ttlSeconds);
    const secondInstance = new RedisReplyCompletionCache(redis, ttlSeconds);

    await firstInstance.set("conversation-1", "message-1", sampleCompletion);

    await expect(
      secondInstance.get("conversation-1", "message-1"),
    ).resolves.toEqual(sampleCompletion);
  });

  it("deletes a stored completion", async () => {
    const cache = new RedisReplyCompletionCache(redis, ttlSeconds);
    await cache.set("conversation-1", "message-1", sampleCompletion);

    await cache.delete("conversation-1", "message-1");

    await expect(cache.get("conversation-1", "message-1")).resolves.toBeNull();
  });

  it("falls open to a miss when a Redis read fails", async () => {
    vi.spyOn(redis, "get").mockRejectedValueOnce(new Error("connection lost"));
    const cache = new RedisReplyCompletionCache(redis, ttlSeconds);

    await expect(cache.get("conversation-1", "message-1")).resolves.toBeNull();
  });

  it("falls open without throwing when a Redis write fails", async () => {
    vi.spyOn(redis, "setex").mockRejectedValueOnce(
      new Error("connection lost"),
    );
    const cache = new RedisReplyCompletionCache(redis, ttlSeconds);

    await expect(
      cache.set("conversation-1", "message-1", sampleCompletion),
    ).resolves.toBeUndefined();
  });

  it("falls open without throwing when a Redis delete fails", async () => {
    vi.spyOn(redis, "del").mockRejectedValueOnce(new Error("connection lost"));
    const cache = new RedisReplyCompletionCache(redis, ttlSeconds);

    await expect(
      cache.delete("conversation-1", "message-1"),
    ).resolves.toBeUndefined();
  });
});
