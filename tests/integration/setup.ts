import "dotenv/config";
import { afterAll } from "vitest";

if (!process.env.TEST_DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL is required for integration tests");
}

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

const { prisma } = await import("../../src/lib/db/prisma");

afterAll(async () => {
  await prisma.$disconnect();
});
