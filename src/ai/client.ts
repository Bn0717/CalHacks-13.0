// One shared Claude client. The API key comes from the .env file or the environment, never from code.
import Anthropic from "@anthropic-ai/sdk";
import { existsSync } from "node:fs";
import { join } from "node:path";

let loaded = false;

/** Loads .env from the project folder once (if it exists). */
export function loadEnv(projectRoot = process.cwd()): void {
  if (loaded) return;
  loaded = true;
  const path = join(projectRoot, ".env");
  if (existsSync(path)) process.loadEnvFile(path);
}

export const MODEL = () => process.env.CALHACK_MODEL || "claude-opus-5-5";

let client: Anthropic | null = null;

export function getClient(): Anthropic {
  loadEnv();
  if (!client) client = new Anthropic();
  return client;
}

export function hasApiKey(): boolean {
  loadEnv();
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

/** Turns API errors into one plain-English line. */
export function friendlyError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) return "The Claude API key is missing or wrong. Check the .env file.";
  if (error instanceof Anthropic.RateLimitError) return "Claude is busy right now. Try again in a moment.";
  if (error instanceof Anthropic.APIConnectionError) return "Couldn't reach Claude. Check the internet connection.";
  if (error instanceof Anthropic.APIError) return `Claude returned an error (${error.status}).`;
  return (error as Error)?.message ?? String(error);
}
