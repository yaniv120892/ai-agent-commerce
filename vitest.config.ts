import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "server-only": fileURLToPath(
        new URL("./tests/server-only.ts", import.meta.url),
      ),
    },
  },
  test: {
    env: {
      DATABASE_URL: "postgresql://localhost/ai_commerce",
      OPENAI_API_KEY: "test-key",
    },
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
  },
});
