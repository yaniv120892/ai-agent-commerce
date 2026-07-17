import "dotenv/config";

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { CatalogClient } from "../src/domain/catalog/catalog-client";
import { CatalogResolver } from "../src/domain/catalog/catalog-resolver";
import type { RetrievalIntent } from "../src/domain/catalog/types";

type OnlineScenario = {
  currentInput: string;
  expectedIntent: RetrievalIntent;
  name: string;
};

const scenariosPath = resolve(process.cwd(), "tests/evals/scenarios.json");
const allowedCategorySlugs = ["laptops", "smartphones", "tablets"];

async function loadScenarios(): Promise<OnlineScenario[]> {
  const contents = await readFile(scenariosPath, "utf8");
  const scenarios: unknown = JSON.parse(contents);

  if (!Array.isArray(scenarios)) {
    throw new Error("Evaluation scenarios must be an array");
  }

  return scenarios as OnlineScenario[];
}

async function main(): Promise<void> {
  if (process.env.RUN_ONLINE_EVAL !== "true") {
    console.log(
      "Online evaluation skipped: set RUN_ONLINE_EVAL=true to run it.",
    );
    return;
  }

  console.log(
    "Online evaluation is not CI-safe: it has external cost and availability dependencies.",
  );

  const apiKey = process.env.OPENAI_API_KEY;

  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error("OPENAI_API_KEY is required when RUN_ONLINE_EVAL=true");
  }

  const scenarios = (await loadScenarios())
    .filter((scenario) =>
      ["budget_category", "ambiguous", "off_catalog"].includes(scenario.name),
    )
    .slice(0, 3);
  const catalogClient = new CatalogClient(fetch, "https://dummyjson.com", 5000);
  const catalogResolver = new CatalogResolver(
    catalogClient,
    allowedCategorySlugs,
  );
  const { OpenAIModelClient } =
    await import("../src/domain/chat/openai-model-client");
  const modelClient = new OpenAIModelClient(apiKey);
  const failures: string[] = [];

  for (const scenario of scenarios) {
    try {
      const plan = await modelClient.createRetrievalPlan({
        activeContext: null,
        allowedCategorySlugs,
        history: [],
        priorProductIds: [],
        userMessage: scenario.currentInput,
      });
      const resolved = await catalogResolver.resolve(plan, []);
      const cardIds = resolved.productCards.map((card) => card.productId);
      const groundedCards = cardIds.every((productId) => productId > 0);

      console.log(
        JSON.stringify({
          groundedCards,
          intent: plan.intent,
          name: scenario.name,
          productCount: cardIds.length,
          validPlan: true,
        }),
      );

      if (!groundedCards) {
        failures.push(`${scenario.name}: returned an ungrounded card id`);
      }
    } catch (error) {
      failures.push(
        `${scenario.name}: ${error instanceof Error ? error.message : "integration failure"}`,
      );
    }
  }

  if (failures.length > 0) {
    throw new Error(failures.join("\n"));
  }
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Online evaluation failed",
  );
  process.exitCode = 1;
});
