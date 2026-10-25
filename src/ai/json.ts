// Asks Claude for an answer in a fixed JSON shape (structured output). Works on every current model, unlike forcing a
// tool, which some models refuse.
import type Anthropic from "@anthropic-ai/sdk";
import { getClient } from "./client.js";

export async function askJson<T = Record<string, unknown>>(o: {
  model: string;
  system: string;
  content: Anthropic.MessageParam["content"];
  schema: Record<string, unknown>;
  maxTokens?: number;
  signal?: AbortSignal;
  maxRetries?: number;
  onResponse?: (response: { model: string; usage: { input_tokens: number; output_tokens: number } }) => void;
}): Promise<T> {
  const response = await getClient().messages.create(
    {
      model: o.model,
      max_tokens: o.maxTokens ?? 800,
      system: o.system,
      messages: [{ role: "user", content: o.content }],
      output_config: { format: { type: "json_schema", schema: o.schema } },
    } as Anthropic.MessageCreateParamsNonStreaming,
    { signal: o.signal, ...(o.maxRetries === undefined ? {} : { maxRetries: o.maxRetries }) },
  );
  o.onResponse?.(response);
  if (response.stop_reason === "refusal") throw new Error("Claude declined to answer.");
  // The model thinks before answering, and the thinking counts toward max_tokens: a cut-off answer is never valid JSON.
  if (response.stop_reason === "max_tokens") throw new Error(`The answer was cut off at ${o.maxTokens ?? 800} tokens.`);
  const text = response.content.find((b) => b.type === "text");
  try {
    return JSON.parse(text && "text" in text ? text.text : "") as T;
  } catch {
    throw new Error("The model gave no usable answer.");
  }
}
