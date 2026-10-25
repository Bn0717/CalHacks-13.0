// Picks the most exact source of the instructions the person is looking at.
// Order: the browser's page → the open document → recently copied text → the screenshot only.
import { browserUrl, frontDocumentPath } from "../mac/front.js";
import { fetchPageText, fileText } from "../mac/text.js";
import { windowText } from "../mac/ui.js";
import type { InstructionSource } from "../core/types.js";

export interface GatherInput {
  app: string | null;
  /** Text copied in the last couple of minutes, if any. */
  recentClipboard: string | null;
}

/** Sites that only show the page to the signed-in person: reading the window is the only way. */
export const SIGNED_IN = /^https:\/\/(mail\.google\.com|outlook\.(live|office|office365)\.com|mail\.yahoo\.com|www\.icloud\.com\/mail|mail\.aol\.com|calendar\.google\.com|docs\.google\.com)/i;
/** What a page looks like when downloading it again only got the sign-in screen. */
const LOGIN_PAGE = /\b(sign in|log in|login)\b.{0,200}\b(password|email|account|continue)\b/i;

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
        // A page they're signed in to (email, a patient portal) can't be downloaded again: read it from the window.
        if (!SIGNED_IN.test(url)) {
          const text = await fetchPageText(url);
          if (text.trim().length > 40 && !LOGIN_PAGE.test(text.slice(0, 600))) return { kind: "webpage", text, location: url, app: appName };
        }
      } catch {
        // Fall through to reading the window.
      }
      const seen = await windowText(app).catch(() => null);
      if (seen && seen.text.trim().length > 40) return { kind: "webpage", text: seen.text, location: url, app: appName };
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
