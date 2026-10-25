// Shared TypeSafe transport. Diagnostic records contain no state, image bytes or credentials.
import { randomUUID } from "node:crypto";
import { loadEnv } from "./client.js";
import type { PointerImage } from "./positioner.js";

export const record = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
export const probability = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
export interface DecisionAttempt {
  provider: "jev" | "claude";
  model: string;
  stage: string;
  elapsedMs: number;
  error?: string;
  usage?: { inputTokens: number; outputTokens: number };
  judgments?: Record<string, { choice?: string; confidence?: number; probability?: number }>;
}
export interface DecisionTrace {
  provider: "jev" | "claude";
  model: string;
  attempts: DecisionAttempt[];
  elapsedMs: number;
  fallbackReason?: string;
}
export const deadline = (signal?: AbortSignal) => {
  const timeout = AbortSignal.timeout(10_000);
  return { signal: signal ? AbortSignal.any([signal, timeout]) : timeout, timedOut: () => timeout.aborted };
};
export function validateJevImage(image: PointerImage): void {
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 256 || image.height < 256
    || image.width > 1568 || image.height > 1568 || image.width * image.height < 78_400 || !image.data
    || Buffer.byteLength(image.data, "base64") > 16 * 1024 * 1024) throw new Error("unsupported_image");
}
export const diagnostic = (error: unknown): string => {
  const message = error instanceof Error ? error.message : "";
  return /^(missing_key|unsupported_image|invalid_response|uncertain_decision|typing_requires_claude|unsupported_action|invalid_target|invalid_threshold|timeout|http_\d{3})$/.test(message) ? message : "request_failed";
};

export async function systemOne(o: {
  state: Record<string, unknown>; questions: Record<string, unknown>; image?: PointerImage;
  signal?: AbortSignal; model?: string; stage?: string; attempts?: DecisionAttempt[];
}): Promise<{ answers: Record<string, unknown>; model: string; usage?: DecisionAttempt["usage"] }> {
  loadEnv();
  o.signal?.throwIfAborted();
  const timing = deadline(o.signal);
  const start = performance.now();
  const attempt: DecisionAttempt = { provider: "jev", model: o.model || process.env.CALHACK_JEV_MODEL || "jev-1.14.0", stage: o.stage ?? "decision", elapsedMs: 0 };
  try {
    const key = process.env.TYPESAFE_API_KEY?.trim();
    if (!key) throw new Error("missing_key");
    if (o.image) validateJevImage(o.image);
    const ref = randomUUID();
    const body = { model: attempt.model, state: { ...o.state, ...(o.image ? { screenshot: ref, screenshot_size: { width: o.image.width, height: o.image.height } } : {}) }, questions: o.questions,
      ...(o.image ? { assets: { [ref]: { type: "image", format: o.image.mediaType === "image/png" ? "png" : "jpg", data_base64: o.image.data } } } : {}) };
    const response = await fetch("https://api.typesafe.ai/v1/systemone", { method: "POST", signal: timing.signal,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(o.image ? { "TypeSafe-Danger-Zone-Images": "true" } : {}) }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`http_${response.status}`);
    const data = record(await response.json());
    timing.signal.throwIfAborted();
    if (!data.answers || typeof data.answers !== "object" || Array.isArray(data.answers)) throw new Error("invalid_response");
    if (typeof data.model === "string" && /^jev-[\w.-]{1,80}$/.test(data.model)) attempt.model = data.model;
    const usage = record(data.usage);
    if (Number.isInteger(usage.input_tokens) && Number(usage.input_tokens) >= 0 && Number.isInteger(usage.output_tokens) && Number(usage.output_tokens) >= 0)
      attempt.usage = { inputTokens: Number(usage.input_tokens), outputTokens: Number(usage.output_tokens) };
    attempt.judgments = Object.fromEntries(Object.entries(record(data.answers)).map(([name, value]) => {
      const answer = record(value), question = record(o.questions[name]);
      return [name, {
        ...(typeof answer.choice === "string" && Object.hasOwn(record(question.criteria), answer.choice) ? { choice: answer.choice } : {}),
        ...(probability(answer.confidence) ? { confidence: answer.confidence } : {}),
        ...(probability(answer.noul) ? { probability: answer.noul } : typeof answer.choice === "string" && probability(record(answer.probabilities)[answer.choice]) ? { probability: record(answer.probabilities)[answer.choice] as number } : {}),
      }];
    }));
    return { answers: record(data.answers), model: attempt.model, usage: attempt.usage };
  } catch (error) {
    o.signal?.throwIfAborted();
    attempt.error = timing.timedOut() ? "timeout" : diagnostic(error);
    throw new Error(attempt.error);
  } finally {
    attempt.elapsedMs = Math.round(performance.now() - start);
    o.attempts?.push(attempt);
  }
}

export const choice = (instructions: string, criteria: Record<string, unknown>) => ({ type: "choice", instructions, criteria });
export const noul = (instructions: string) => ({ type: "noul", instructions });
export function choose(answers: Record<string, unknown>, name: string, criteria: Record<string, unknown>, minimum = 0.85): string {
  const answer = record(answers[name]);
  const probabilities = record(answer.probabilities);
  if (answer.type !== "choice" || typeof answer.choice !== "string" || !Object.hasOwn(criteria, answer.choice)
    || !probability(answer.confidence) || !Object.keys(criteria).every((key) => probability(probabilities[key]))
    || Object.keys(probabilities).length !== Object.keys(criteria).length
    || Math.abs(Object.values(probabilities).reduce<number>((sum, p) => sum + Number(p), 0) - 1) > 0.02) throw new Error("invalid_response");
  if (answer.confidence < minimum || Number(probabilities[answer.choice]) < minimum) throw new Error("uncertain_decision");
  return answer.choice;
}
export function yesProbability(answers: Record<string, unknown>, name: string): number {
  const answer = record(answers[name]);
  if (answer.type !== "noul" || !probability(answer.noul)) throw new Error("invalid_response");
  return answer.noul;
}
export function certainBoolean(answers: Record<string, unknown>, name: string): boolean {
  const value = yesProbability(answers, name);
  if (value > 0.1 && value < 0.9) throw new Error("uncertain_decision");
  return value >= 0.9;
}
