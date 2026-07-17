import "server-only";

import Redis from "ioredis";

import { environment } from "@/lib/env";

const globalForRedis = globalThis as unknown as {
  redis: Redis | null | undefined;
};

function createRedisClient(): Redis | null {
  if (!environment.redisUrl) {
    return null;
  }

  // The offline queue is what lets lazyConnect establish the connection on the
  // first command; disabling it makes every command on a cold instance fail
  // with "Stream isn't writeable". connectTimeout and maxRetriesPerRequest keep
  // an unreachable Redis from stalling the request behind that queue.
  const client = new Redis(environment.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
  });

  // ioredis emits "error" on the client itself. Without a listener, Node treats
  // it as an uncaught exception and terminates the process.
  client.on("error", (error) => {
    console.error("Redis connection failed; catalog cache is degraded", error);
  });

  return client;
}

export const redisClient =
  globalForRedis.redis === undefined
    ? createRedisClient()
    : globalForRedis.redis;

if (process.env.NODE_ENV !== "production") {
  globalForRedis.redis = redisClient;
}
