export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { environment } = await import("@/lib/env");

  console.log("Resolved OpenAI model configuration", {
    e2eMode: environment.e2eMode,
    plannerModel: environment.openAiModels.plannerModel,
    replyModel: environment.openAiModels.replyModel,
  });
}
