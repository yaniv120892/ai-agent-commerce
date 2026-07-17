import "dotenv/config";

import { defineConfig, devices } from "@playwright/test";

const port = 3001;
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://ai_commerce:ai_commerce_local@localhost:5432/ai_commerce_test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run dev -- --port ${port}`,
    env: {
      DATABASE_URL: databaseUrl,
      E2E_MODE: "true",
      NEXT_TELEMETRY_DISABLED: "1",
      OPENAI_API_KEY: "test-key",
    },
    reuseExistingServer: false,
    url: `http://localhost:${port}`,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
