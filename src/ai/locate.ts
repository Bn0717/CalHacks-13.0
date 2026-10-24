// Asks Claude where a button is on a screenshot, so the app can draw an arrow to it.
// The app only points; the person always does the clicking.
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { MODEL, getClient } from "./client.js";

const LocationSchema = z.object({
  found: z.boolean(),
  x: z.number().describe("Horizontal center of the target in screenshot pixels (0 = left edge)"),
  y: z.number().describe("Vertical center of the target in screenshot pixels (0 = top edge)"),
  hint: z.string().describe("One short sentence telling the person what to click, or why it isn't visible (e.g. 'Open System Settings first')."),
});

export type ScreenLocation = z.infer<typeof LocationSchema>;

export async function locateOnScreen(args: {
  screenshot: string;
  mediaType: "image/png" | "image/jpeg";
  width: number;
  height: number;
  target: string;
  stepTitle: string;
}): Promise<ScreenLocation> {
  const response = await getClient().beta.messages.parse({
    model: MODEL(),
    max_tokens: 4000,
    output_config: { effort: "low", format: betaZodOutputFormat(LocationSchema) },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: args.mediaType, data: args.screenshot } },
          {
            type: "text",
            text: `The screenshot is ${args.width}×${args.height} pixels. The person is on the step "${args.stepTitle}" and needs to click: "${args.target}". If it's visible, give its center in pixels. If it isn't, set found to false and say what to open first.`,
          },
        ],
      },
    ],
  });
  const loc = response.parsed_output;
  if (!loc) return { found: false, x: 0, y: 0, hint: "Couldn't find it on screen." };
  return loc;
}
