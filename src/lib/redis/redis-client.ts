import "server-only";

import Redis from "ioredis";

import { environment } from "@/lib/env";

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
};

export const redisClient =
  globalForRedis.redis ?? new Redis(environment.redisUrl);

if (process.env.NODE_ENV !== "production") {
  globalForRedis.redis = redisClient;
}
