// Asks Claude where a button is on a screenshot, so the app can draw an arrow to it.
// The app only points; the person always does the clicking.
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { MODEL, getClient } from "./client.js";

const LocationSchema = z.object({
  found: z.boolean(),
  x: z.number().describe("Horizontal center of the target in screenshot pixels (0 = left edge)"),
  y: z.number().describe("Vertical center of the target in screenshot pixels (0 = top edge)"),
  hint: z.string().describe("Max 10 simple words. If found: how to click it, e.g. 'Click the blue Install button'. If not: what to do, e.g. 'Scroll down a little' or 'Opening System Settings'."),
  open_first: z
    .object({
      kind: z.enum(["app", "settings", "url"]),
      target: z.string().describe("app: the app's exact name, e.g. 'System Settings' or 'Finder'. settings: an x-apple.systempreferences: link. url: a full https address."),
    })
    .nullable()
    .describe("Only when found is false: something to open that would show the target. Null if it's already on screen, or if the person only needs to scroll."),
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
            text: `The screenshot is ${args.width}×${args.height} pixels. The person is on the step "${args.stepTitle}" and needs to click: "${args.target}". If it's visible, give its center in pixels. If it isn't, set found to false, say what to do in a few words, and if opening an app, a System Settings page or a web page would show it, put that in open_first.`,
          },
        ],
      },
    ],
  });
  const loc = response.parsed_output;
  if (!loc) return { found: false, x: 0, y: 0, hint: "Couldn't find it on screen.", open_first: null };
  return loc;
}
