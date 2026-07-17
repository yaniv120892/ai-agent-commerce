import "dotenv/config";

import { deriveActiveContext } from "../src/domain/chat/active-context";
import { CatalogClient } from "../src/domain/catalog/catalog-client";
import { CatalogResolver } from "../src/domain/catalog/catalog-resolver";
import { PlanValidator } from "../src/domain/catalog/plan-validator";
import type { PersistedMessage } from "../src/domain/conversations/types";
import { resolveOpenAIModelSelection } from "../src/lib/openai-model-config";

async function main(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error("OPENAI_API_KEY is required to run this verification");
  }

  console.log(
    "This hits the real DummyJSON catalog and OpenAI API. Not CI-safe.",
  );

  const { OpenAIModelClient } =
    await import("../src/domain/chat/openai-model-client");
  const modelClient = new OpenAIModelClient({
    apiKey,
    maxOutputTokens: 2000,
    maxRetries: 1,
    models: resolveOpenAIModelSelection(process.env),
    timeoutMs: 20000,
  });
  const catalogClient = new CatalogClient(fetch, "https://dummyjson.com", 5000);
  const catalogResolver = new CatalogResolver(catalogClient);
  const allowedCategorySlugs = await catalogResolver.listAllowedCategorySlugs();
  const planValidator = new PlanValidator(allowedCategorySlugs);

  console.log(
    '\n--- Turn 1: "ma shoes" resolves to mens-shoes (per the ticket) ---',
  );
  console.log(
    "Note: the live model is non-deterministic turn-to-turn (a prior run of",
    "this exact turn returned clarify: men's vs women's). To isolate the",
    "fix under test (activeContext carry-forward on turn 2) from that",
    "unrelated non-determinism, turn 1's resolved state is constructed",
    "directly against the real catalog, matching what the ticket reports",
    "the planner actually returned.",
  );

  const firstPlan = {
    assistantMessage: null,
    categorySlug: "mens-shoes",
    inStock: null,
    intent: "browse_category" as const,
    maxPrice: null,
    minRating: null,
    referencedProductIds: [],
    searchTerms: [],
    sort: "relevance" as const,
  };
  const firstResolved = await catalogResolver.resolve(
    planValidator.validate(firstPlan, []),
    allowedCategorySlugs,
  );

  console.log(
    `Resolved ${firstResolved.productCards.length} real mens-shoes product card(s):`,
  );
  console.log(
    JSON.stringify(
      firstResolved.productCards.map((card) => ({
        category: card.category,
        productId: card.productId,
        title: card.title,
      })),
      null,
      2,
    ),
  );

  const history: PersistedMessage[] = [
    {
      content: "ma shoes",
      createdAt: new Date().toISOString(),
      id: "verify-user-1",
      lastCategorySlug: null,
      lastSearchTerms: [],
      productCards: [],
      role: "user",
      status: "complete",
    },
    {
      content: "Here are some mens-shoes options.",
      createdAt: new Date().toISOString(),
      id: "verify-assistant-1",
      lastCategorySlug: "mens-shoes",
      lastSearchTerms: [],
      productCards: firstResolved.productCards,
      role: "assistant",
      status: "complete",
    },
  ];
  const activeContext = deriveActiveContext(history);
  const priorProductIds = firstResolved.productCards.map(
    (productCard) => productCard.productId,
  );

  console.log(`\nDerived activeContext: ${JSON.stringify(activeContext)}`);

  console.log('\n--- Turn 2: "I want red shoesh" ---');
  const secondPlan = await modelClient.createRetrievalPlan({
    activeContext,
    allowedCategorySlugs,
    history,
    priorProductIds,
    repairContext: null,
    userMessage: "I want red shoesh",
  });

  console.log(JSON.stringify(secondPlan, null, 2));

  const regressed =
    secondPlan.intent === "clarify" || secondPlan.intent === "unsupported";

  if (!regressed) {
    const secondResolved = await catalogResolver.resolve(
      planValidator.validate(secondPlan, priorProductIds),
      allowedCategorySlugs,
    );

    console.log(
      `\nResolved ${secondResolved.productCards.length} real product card(s) for turn 2:`,
    );
    console.log(
      JSON.stringify(
        secondResolved.productCards.map((card) => ({
          category: card.category,
          productId: card.productId,
          title: card.title,
        })),
        null,
        2,
      ),
    );
  }

  console.log(
    `\nResult: ${regressed ? "REGRESSION (re-clarified instead of refining)" : "carried the category forward as a refinement"}`,
  );

  if (regressed) {
    process.exitCode = 1;
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Verification failed");
  process.exitCode = 1;
});
