import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      DATABASE_URL: "postgresql://localhost/ai_commerce",
      OPENAI_API_KEY: "test-key",
    },
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
  },
});
