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
}): Promise<T> {
  const response = await getClient().messages.create(
    {
      model: o.model,
      max_tokens: o.maxTokens ?? 800,
      system: o.system,
      messages: [{ role: "user", content: o.content }],
      output_config: { format: { type: "json_schema", schema: o.schema } },
    } as Anthropic.MessageCreateParamsNonStreaming,
    { signal: o.signal },
  );
  if (response.stop_reason === "refusal") throw new Error("Claude declined to answer.");
  const text = response.content.find((b) => b.type === "text");
  try {
    return JSON.parse(text && "text" in text ? text.text : "") as T;
  } catch {
    throw new Error("The model gave no usable answer.");
  }
}
