import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type LanguageModel,
  type UIMessage,
} from "ai";

import { ensureSchema } from "@/db/client";
import type { Role } from "@/db/permissions";
import { buildTools } from "./tools";
import { getModel, SYSTEM_PROMPT } from "./provider";

/**
 * Runs the analytics copilot for one turn and RETURNS the `streamText` result.
 *
 * The caller decides what to do with it:
 *   - the chat route calls `.toUIMessageStreamResponse()`
 *   - evals/tests `await result.steps` / `.toolCalls` / `.text`
 *
 * The agent loops (orient → query → answer) up to 6 steps via `stopWhen`.
 */
export async function streamCopilot({
  workspaceId,
  role,
  messages,
  model = getModel(),
}: {
  workspaceId: string;
  role: Role;
  messages: UIMessage[];
  /** Override the model — e.g. wrap it with evalite's wrapAISDKModel in evals. */
  model?: LanguageModel;
}) {
  await ensureSchema();

  // A minimal loop: one model, the tools, capped at 6 steps. A thrown tool
  // `execute` error is surfaced by the AI SDK as an `output-error` tool part
  // (the UI renders it) and the model can recover on the next step instead of
  // the stream dying — so we don't swallow errors into a fake result here, we
  // just log them for visibility.
  return streamText({
    model,
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    tools: buildTools({ workspaceId, role }),
    stopWhen: stepCountIs(6),
    onError({ error }) {
      console.error("[copilot] stream error:", error);
    },
  });
}
