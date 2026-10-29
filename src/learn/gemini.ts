// A small client for Google's Gemini API, used only to "watch" a public YouTube tutorial and write down what happens in it.
// Gemini reads YouTube links directly, so the video is never downloaded. The key comes from GEMINI_API_KEY, never from code.
import { z } from "zod";
import { loadEnv } from "../ai/client.js";

export const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta";

// A current stable Gemini model that understands video. CALHACK_GEMINI_MODEL overrides it.
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash";

// ---------- What Gemini writes down about a video ----------

export const VideoNotesSchema = z.object({
  title: z.string().min(1).describe("The video's title, as shown on YouTube."),
  summary: z.string().describe("Two or three sentences on what the tutorial builds."),
  chapters: z
    .array(
      z.object({
        title: z.string().min(1),
        start: z.number().min(0).describe("Start time in seconds."),
        end: z.number().min(0).describe("End time in seconds."),
      }),
    )
    .min(1),
  segments: z
    .array(
      z.object({
        start: z.number().min(0).describe("Start time in seconds."),
        end: z.number().min(0).describe("End time in seconds."),
        chapter: z.string().describe("The title of the chapter this part belongs to."),
        action: z.string().min(1).describe("What the presenter does in this part, in plain English."),
        file: z.string().describe("The file being edited, e.g. 'index.html'. Empty if none."),
        code: z.string().describe("The exact code visible on screen at the end of this part, copied character for character. Empty if none."),
      }),
    )
    .min(1),
});

export type VideoNotes = z.infer<typeof VideoNotesSchema>;

// The answer shape sent to Gemini as a JSON schema (structured output).
export function videoNotesJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(VideoNotesSchema) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

const PROMPT = `You are watching a coding tutorial for beginners. Write down everything needed to rebuild it step by step.
- chapters: the video's main parts, with start and end times in seconds.
- segments: small parts in order (about 20 seconds to 2 minutes each). For each: start and end in seconds, the chapter title,
  what the presenter does, the file being edited, and the exact code visible on screen at the end of that part.
Copy code exactly as shown, including indentation. If no code is visible in a part, leave code empty. Never invent code.`;

// ---------- Gemini's reply (only the parts we use) ----------

const GeminiReplySchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z.object({ parts: z.array(z.object({ text: z.string().optional() }).loose()).optional() }).loose().optional(),
        finishReason: z.string().optional(),
      }),
    )
    .optional(),
  promptFeedback: z.object({ blockReason: z.string().optional() }).loose().optional(),
});

export class GeminiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeminiError";
  }
}

export const MISSING_KEY_MESSAGE = "Video lessons need GEMINI_API_KEY. Add it to the .env file, then try again.";

export type GeminiDeps = {
  fetch?: typeof fetch; // tests pass a fake
  env?: Record<string, string | undefined>; // defaults to process.env (after loading .env)
  signal?: AbortSignal;
};

// True when a Gemini key is set, so the app can say early that video lessons need one.
export function hasGeminiKey(env?: Record<string, string | undefined>): boolean {
  return !!envOf(env).GEMINI_API_KEY;
}

// Asks Gemini to watch a public YouTube video and return its chapters, segments and on-screen code.
export async function readVideo(youtubeUrl: string, deps: GeminiDeps = {}): Promise<VideoNotes> {
  const env = envOf(deps.env);
  const key = env.GEMINI_API_KEY;
  if (!key) throw new GeminiError(MISSING_KEY_MESSAGE);
  const model = env.CALHACK_GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const doFetch = deps.fetch ?? fetch;

  const body = {
    contents: [{ parts: [{ file_data: { file_uri: youtubeUrl } }, { text: PROMPT }] }],
    generationConfig: { responseMimeType: "application/json", responseJsonSchema: videoNotesJsonSchema() },
  };

  let response: Response;
  try {
    response = await doFetch(`${GEMINI_API}/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
      signal: deps.signal,
    });
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error;
    throw new GeminiError("Couldn't reach Gemini. Check the internet connection.");
  }
  if (!response.ok) throw new GeminiError(httpProblem(response.status, await safeText(response)));

  const reply = GeminiReplySchema.safeParse(await response.json().catch(() => null));
  if (!reply.success) throw new GeminiError("Gemini gave an answer Stride couldn't read.");
  if (reply.data.promptFeedback?.blockReason) throw new GeminiError(`Gemini wouldn't read this video (${reply.data.promptFeedback.blockReason}).`);
  const candidate = reply.data.candidates?.[0];
  const text = (candidate?.content?.parts ?? []).map((p) => p.text ?? "").join("");
  if (!text) throw new GeminiError("Gemini gave no notes for this video. Is it public?");
  if (candidate?.finishReason === "MAX_TOKENS") throw new GeminiError("This video is too long to read in one go. Try a shorter one.");

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new GeminiError("Gemini's notes weren't valid JSON.");
  }
  const notes = VideoNotesSchema.safeParse(data);
  if (!notes.success) throw new GeminiError(`Gemini's notes were missing parts: ${notes.error.issues[0]?.message ?? "unknown"}.`);
  return notes.data;
}

function envOf(env?: Record<string, string | undefined>): Record<string, string | undefined> {
  if (env) return env;
  loadEnv();
  return process.env;
}

function httpProblem(status: number, detail: string): string {
  if (status === 400 && /api key/i.test(detail)) return "The Gemini API key is wrong. Check GEMINI_API_KEY in the .env file.";
  if (status === 401 || status === 403) return "The Gemini API key is wrong or can't read videos. Check GEMINI_API_KEY in the .env file.";
  if (status === 404) return "That Gemini model wasn't found. Check CALHACK_GEMINI_MODEL.";
  if (status === 429) return "Gemini is busy or the daily video limit is used up. Try again later.";
  if (status === 400) return "Gemini couldn't open this video. Make sure it's a public YouTube video.";
  return `Gemini returned an error (${status}).`;
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
