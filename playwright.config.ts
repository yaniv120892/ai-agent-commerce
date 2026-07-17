import "dotenv/config";

import { defineConfig, devices } from "@playwright/test";

// Worktrees are assigned a free PORT by scripts/setup-worktree-env.ts; honouring
// it keeps parallel worktrees from colliding on one hardcoded dev-server port.
const port = process.env.PORT ?? 3001;
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://ai_commerce:ai_commerce_local@localhost:5432/ai_commerce_test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  // The cleanDatabase fixture truncates one shared database before every test,
  // so spec files must not run concurrently on separate workers.
  workers: 1,
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
      testIgnore: /mobile-layout\.spec\.ts/u,
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 5"] },
      testMatch: /mobile-layout\.spec\.ts/u,
    },
  ],
});
