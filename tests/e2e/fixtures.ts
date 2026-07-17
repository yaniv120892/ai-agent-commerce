import "dotenv/config";

import { expect, test as base } from "@playwright/test";
import { Pool } from "pg";

type E2eFixtures = {
  cleanDatabase: void;
};

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://ai_commerce:ai_commerce_local@localhost:5432/ai_commerce_test";

export const test = base.extend<E2eFixtures>({
  cleanDatabase: [
    async ({}, useFixture) => {
      const pool = new Pool({ connectionString: databaseUrl });

      try {
        await pool.query(
          "TRUNCATE TABLE message_product_cards, messages, conversations CASCADE",
        );
        await useFixture();
      } finally {
        await pool.end();
      }
    },
    { auto: true },
  ],
});

export { expect };
