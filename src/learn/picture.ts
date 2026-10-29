// Reads a student's reference picture (a screenshot, photo or paper sketch) and lists the parts of the page it shows,
// so Stride can say "a top menu, a big photo with a title, 3 cards, a footer — right?" and the student can correct it.
import { transformJSONSchema } from "@anthropic-ai/sdk/lib/transform-json-schema";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { askJson } from "../ai/json.js";
import type { PictureNoteSchema } from "./lesson.js";

// ---------- The answer shape ----------

export const PictureSectionSchema = z.object({
  name: z
    .string()
    .min(1)
    .describe("A short plain name in lower case, starting with 'a'/'an' or a count, e.g. 'a top menu', '3 cards', 'a footer'."),
  description: z.string().min(1).describe("One plain sentence on what is in this part and how it looks."),
});

export const PictureReadingSchema = z.object({
  sections: z.array(PictureSectionSchema).describe("The parts of the page from top to bottom."),
  style: z.object({
    colors: z.array(z.string().min(1)).describe("The main colors as hex codes, e.g. '#1a73e8', most used first."),
    fonts: z.array(z.string().min(1)).optional().describe("Font styles if you can tell, e.g. 'rounded sans-serif'."),
    mood: z.string().min(1).describe("The overall feel in a few words, e.g. 'calm and clean'."),
  }),
  summary: z.string().min(1).describe("One or two plain sentences describing the whole page."),
});

export type PictureSection = z.infer<typeof PictureSectionSchema>;
export type PictureReading = z.infer<typeof PictureReadingSchema>;

// The idea builder stores this reading as the lesson's `picture`, so it must fit the lesson format.
type PictureNote = z.infer<typeof PictureNoteSchema>;
type Assert<T extends true> = T;
export type PictureReadingFitsLesson = Assert<PictureReading extends PictureNote ? true : false>;

export class PictureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PictureError";
  }
}

// ---------- Dependencies (tests pass fakes) ----------

export type AskJson = (o: Parameters<typeof askJson>[0]) => Promise<unknown>;

export type PictureDeps = {
  ask?: AskJson; // the model call, default askJson
  model?: string;
  signal?: AbortSignal;
};

const learnModel = () => process.env.CALHACK_LEARN_MODEL || "claude-opus-5-5";

// ---------- Shrinking the image ----------

export const MAX_SIDE = 1568; // larger images cost more and Claude scales them down anyway
const MAX_BYTES = 3_500_000; // keep well under the API's 5 MB per-image limit (base64 adds a third)

type MediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";
const MEDIA: Record<string, MediaType> = { png: "image/png", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

export type PreparedImage = { data: Buffer; mediaType: MediaType; width: number; height: number; resized: boolean };

// Makes a picture ready to send: big ones are shrunk (longest side ≤ 1568 px), odd formats become PNG, small ones are left alone.
export async function prepareImage(image: Buffer | string): Promise<PreparedImage> {
  const bytes = typeof image === "string" ? await readFile(image) : image;
  const { default: sharp } = await import("sharp");
  let meta;
  try {
    meta = await sharp(bytes).metadata();
  } catch {
    throw new PictureError("That file isn't a picture Stride can read. Try a PNG or JPEG.");
  }
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const mediaType = meta.format ? MEDIA[meta.format] : undefined;
  const tooBig = Math.max(width, height) > MAX_SIDE;

  if (!tooBig && mediaType && bytes.length <= MAX_BYTES) return { data: bytes, mediaType, width, height, resized: false };

  // Shrink (if needed) and re-encode: photos as JPEG, everything else as PNG to keep sharp edges.
  let pipeline = sharp(bytes).rotate();
  if (tooBig) pipeline = pipeline.resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true });
  const asJpeg = meta.format === "jpeg" || (bytes.length > MAX_BYTES && !meta.hasAlpha);
  const { data, info } = await (asJpeg ? pipeline.jpeg({ quality: 85 }) : pipeline.png()).toBuffer({ resolveWithObject: true });
  return { data, mediaType: asJpeg ? "image/jpeg" : "image/png", width: info.width, height: info.height, resized: tooBig };
}

// ---------- Reading and correcting ----------

const SYSTEM = [
  "You help a beginner build a web page that looks like their reference picture (a screenshot, photo or hand-drawn sketch).",
  "List the parts of the page from top to bottom in plain words a non-technical person understands. Group repeated items",
  "(say '3 cards', not each card). Don't invent parts you can't see. Never use code words like div, nav or flexbox.",
].join(" ");

// Reads a picture and returns its sections, style and a short summary.
export async function readPicture(image: Buffer | string, deps: PictureDeps = {}): Promise<PictureReading> {
  const prepared = await prepareImage(image);
  const answer = await (deps.ask ?? askJson)({
    model: deps.model ?? learnModel(),
    system: SYSTEM,
    content: [
      { type: "image", source: { type: "base64", media_type: prepared.mediaType, data: prepared.data.toString("base64") } },
      { type: "text", text: "What parts does this page have, and what's its style?" },
    ],
    schema: pictureJsonSchema(),
    maxTokens: 4000,
    signal: deps.signal,
  });
  return parseReading(answer);
}

// Updates the reading after the student says what Stride got wrong, e.g. "there are 4 cards, not 3".
export async function applyCorrection(result: PictureReading, studentText: string, deps: PictureDeps = {}): Promise<PictureReading> {
  const said = studentText.trim();
  if (!said) return result;
  const answer = await (deps.ask ?? askJson)({
    model: deps.model ?? learnModel(),
    system: `${SYSTEM} Now the student is correcting what you read. Change only what they ask for and keep everything else.`,
    content: [
      {
        type: "text",
        text: [
          `What you read from their picture:\n<reading>\n${JSON.stringify(result, null, 2)}\n</reading>`,
          `What the student said:\n<said>\n${said.slice(0, 2000)}\n</said>`,
          "Give the full updated reading.",
        ].join("\n\n"),
      },
    ],
    schema: pictureJsonSchema(),
    maxTokens: 4000,
    signal: deps.signal,
  });
  return parseReading(answer);
}

// The one plain sentence Stride says, e.g. "a top menu, a big photo with a title, 3 cards, a footer".
export function describeForStudent(result: PictureReading): string {
  const names = result.sections.map((s) => tidyName(s.name)).filter((n) => n !== "");
  if (names.length === 0) return "I couldn't make out clear parts in your picture";
  return names.join(", ");
}

// ---------- Helpers ----------

// Checks the model's answer. Throws a PictureError in plain words when it doesn't fit.
export function parseReading(answer: unknown): PictureReading {
  const result = PictureReadingSchema.safeParse(answer);
  if (result.success) return result.data;
  throw new PictureError("Stride couldn't read the picture properly. Try again or describe it in words.");
}

// The JSON schema of a reading, in the strict form `askJson` structured output accepts.
export function pictureJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(PictureReadingSchema) as Record<string, unknown>;
  delete schema.$schema;
  return transformJSONSchema(schema) as Record<string, unknown>;
}

// "Top menu." -> "top menu" (keeps words like "FAQ" as they are).
function tidyName(name: string): string {
  const n = name.trim().replace(/[.,;]+$/, "");
  if (n.length > 1 && n[0] === n[0]!.toUpperCase() && n[1] === n[1]!.toLowerCase()) return n[0]!.toLowerCase() + n.slice(1);
  return n;
}
