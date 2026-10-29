// Asks Claude for an answer in a fixed JSON shape (structured output). Works on every current model, unlike forcing a
// tool, which some models refuse.
import type Anthropic from "@anthropic-ai/sdk";
import { getClient } from "./client.js";
import { fitSchema } from "./schema-limit.js";

// Answers allowed to be longer than this many tokens are streamed.
export const STREAM_ABOVE = 16_000;

export async function askJson<T = Record<string, unknown>>(o: {
  model: string;
  system: string;
  content: Anthropic.MessageParam["content"];
  schema: Record<string, unknown>;
  maxTokens?: number;
  signal?: AbortSignal;
  maxRetries?: number;
  effort?: "low" | "medium" | "high"; // how hard the model thinks first (Opus 5.5 can't skip thinking); default: the model's own
  onResponse?: (response: { model: string; usage: { input_tokens: number; output_tokens: number } }) => void;
}): Promise<T> {
  // Big answer shapes go past the API's limit on optional fields: see schema-limit.ts.
  const fitted = fitSchema(o.schema);
  const params = {
    model: o.model,
    max_tokens: o.maxTokens ?? 800,
    system: o.system,
    messages: [{ role: "user", content: o.content }],
    output_config: { format: { type: "json_schema", schema: fitted.schema }, ...(o.effort ? { effort: o.effort } : {}) },
  } as Anthropic.MessageCreateParamsNonStreaming;
  const options = { signal: o.signal, ...(o.maxRetries === undefined ? {} : { maxRetries: o.maxRetries }) };
  // Long answers (a whole lesson) are streamed: the SDK refuses a plain request that could run past its time limit.
  const response =
    params.max_tokens > STREAM_ABOVE
      ? await getClient().messages.stream(params, options).finalMessage()
      : await getClient().messages.create(params, options);
  o.onResponse?.(response);
  if (response.stop_reason === "refusal") throw new Error("Claude declined to answer.");
  // The model thinks before answering, and the thinking counts toward max_tokens: a cut-off answer is never valid JSON.
  if (response.stop_reason === "max_tokens") throw new Error(`The answer was cut off at ${o.maxTokens ?? 800} tokens.`);
  const text = response.content.find((b) => b.type === "text");
  try {
    const answer: unknown = JSON.parse(text && "text" in text ? text.text : "");
    return fitted.restore(answer) as T;
  } catch {
    throw new Error("The model gave no usable answer.");
  }
}
