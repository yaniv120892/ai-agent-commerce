import { expect, it } from "vitest";

import {
  DEFAULT_OPENAI_MODEL,
  resolveOpenAIModelSelection,
} from "./openai-model-config";

it("falls back to the documented default when no model is configured", () => {
  expect(resolveOpenAIModelSelection({})).toEqual({
    plannerModel: DEFAULT_OPENAI_MODEL,
    replyModel: DEFAULT_OPENAI_MODEL,
  });
});

it("applies OPENAI_MODEL to both the planner and the reply generator", () => {
  expect(
    resolveOpenAIModelSelection({ OPENAI_MODEL: "configured-model" }),
  ).toEqual({
    plannerModel: "configured-model",
    replyModel: "configured-model",
  });
});

it("lets a per-call-site override win over OPENAI_MODEL", () => {
  expect(
    resolveOpenAIModelSelection({
      OPENAI_MODEL: "configured-model",
      OPENAI_PLANNER_MODEL: "planner-canary",
    }),
  ).toEqual({
    plannerModel: "planner-canary",
    replyModel: "configured-model",
  });
});

it("resolves each call site independently of the other", () => {
  expect(
    resolveOpenAIModelSelection({
      OPENAI_PLANNER_MODEL: "planner-canary",
      OPENAI_REPLY_MODEL: "reply-canary",
    }),
  ).toEqual({
    plannerModel: "planner-canary",
    replyModel: "reply-canary",
  });
});
