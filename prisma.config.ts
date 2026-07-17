import "dotenv/config";

import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Migrations must bypass a connection pooler; DATABASE_URL points at one in
    // production, so prefer the direct connection when it is configured.
    url: process.env.DIRECT_DATABASE_URL
      ? env("DIRECT_DATABASE_URL")
      : env("DATABASE_URL"),
  },
});
