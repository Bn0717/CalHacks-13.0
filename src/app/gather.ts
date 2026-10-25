// Picks the most exact source of the instructions the person is looking at.
// Order: the browser's page → the open document → recently copied text → the screenshot only.
import { browserUrl, frontDocumentPath } from "../mac/front.js";
import { fetchPageText, fileText } from "../mac/text.js";
import type { InstructionSource } from "../core/types.js";
import { signedInPage } from "../core/trusted.js";

export { signedInPage };

export interface GatherInput {
  app: string | null;
  /** Text copied in the last couple of minutes, if any. */
  recentClipboard: string | null;
}

export async function gatherInstructions({ app, recentClipboard }: GatherInput): Promise<InstructionSource> {
  const appName = app ?? undefined;

  // 1. A web page: download it, so we get the whole post exactly.
  if (app) {
    const url = await browserUrl(app);
    if (url) {
      try {
        if (url.startsWith("file://")) {
          const path = decodeURIComponent(new URL(url).pathname);
          return { kind: "file", text: await fileText(path), location: url, app: appName };
        }
        // Signed-in pages (webmail and the like): downloading them gets a sign-in page, not what's on screen.
        if (!signedInPage(url)) {
          const text = await fetchPageText(url);
          if (text.trim().length > 40 && !signInWall(text)) return { kind: "webpage", text, location: url, app: appName };
        }
      } catch {
        // Fall through to the next source.
      }
    }
  }

  // 2. A document open in an app like Preview or TextEdit.
  const docPath = await frontDocumentPath();
  if (docPath) {
    try {
      const text = await fileText(docPath);
      if (text.trim().length > 40) return { kind: "document", text, location: "file://" + docPath, app: appName };
    } catch {
      // Fall through.
    }
  }

  // 3. Text the person copied.
  if (recentClipboard && recentClipboard.trim().length > 20) {
    return { kind: "clipboard", text: recentClipboard, app: appName };
  }

  // 4. Only the screenshot. Commands from here always need a human to check them.
  return { kind: "screenshot", text: "", app: appName };
}

/** A short page that's only a sign-in form: what we downloaded isn't what the person sees. */
export function signInWall(text: string): boolean {
  const t = text.trim();
  return t.length < 600 && /\b(sign in|log in|login)\b/i.test(t) && /\b(to continue|email or phone|password|forgot)\b/i.test(t);
}

export function describeSource(source: InstructionSource): string {
  switch (source.kind) {
    case "webpage":
      return `the page open in ${source.app ?? "your browser"}`;
    case "document":
    case "file":
      return `the document open in ${source.app ?? "your app"}`;
    case "clipboard":
      return "the text you copied";
    case "screenshot":
      return `your screen (${source.app ?? "front app"})`;
  }
}
