// Level 2 of the checker: open the student's page in a hidden browser (~0.5 s) to read computed styles and console errors.
// The checker only talks to the Renderer interface, so tests pass a fake and never start a browser.
import { existsSync } from "node:fs";
import type { ProjectFile } from "../lesson.js";

// Questions asked about the rendered page, one answer per probe.
export type Probe =
  | { kind: "count"; selector: string }
  | { kind: "text"; selector: string }
  | { kind: "attr"; selector: string; name: string }
  | { kind: "style"; selector: string; property: string; expected?: string };

// count -> number of matches; text/attr -> one entry per match (attr: null when missing);
// style -> per match, the computed value and the value with the student's CSS turned off (to tell if it was "set"),
// plus the expected value as the browser would compute it (so "tomato" and "rgb(255, 99, 71)" compare equal).
// null for the whole answer means the browser couldn't read the selector.
export type StyleAnswer = { values: { value: string; base: string }[]; want?: string };
export type ProbeAnswer = number | (string | null)[] | StyleAnswer | null;

export type RenderRequest = { page: string; files: ProjectFile[]; probes: Probe[] };
export type RenderResult = { answers: ProbeAnswer[]; consoleErrors: string[] };

export interface Renderer {
  render(request: RenderRequest): Promise<RenderResult>;
  close(): Promise<void>;
}

// Project files are served from this made-up address; nothing else is loaded, so a page can't reach the internet.
const ORIGIN = "http://stride.local";

const TYPES: Record<string, string> = {
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  js: "text/javascript",
  mjs: "text/javascript",
  json: "application/json",
  svg: "image/svg+xml",
  txt: "text/plain",
};

// Browsers to try, in order. CALHACK_BROWSER_PATH wins; with none found, Playwright looks for its own.
const BROWSER_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/opt/pw-browsers/chromium",
];

type Browser = Awaited<ReturnType<(typeof import("playwright-core"))["chromium"]["launch"]>>;

// The real renderer: one hidden Chromium, started on first use and reused for every check until close().
export function playwrightRenderer(options: { executablePath?: string; timeoutMs?: number } = {}): Renderer {
  let browser: Promise<Browser> | null = null;
  const timeout = options.timeoutMs ?? 5000;

  const launch = async (): Promise<Browser> => {
    const { chromium } = await import("playwright-core");
    const executablePath = [options.executablePath, process.env.CALHACK_BROWSER_PATH, ...BROWSER_PATHS].find((p) => p && existsSync(p));
    const b = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    b.on("disconnected", () => (browser = null));
    return b;
  };

  return {
    async render({ page: pagePath, files, probes }) {
      if (!browser) browser = launch().catch((e: unknown) => ((browser = null), Promise.reject(e)));
      const context = await (await browser).newContext({ serviceWorkers: "block" });
      try {
        const page = await context.newPage();
        const consoleErrors: string[] = [];
        page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
        page.on("pageerror", (e) => consoleErrors.push(e.message));
        await context.route("**/*", async (route) => {
          const url = new URL(route.request().url());
          const path = decodeURIComponent(url.pathname).replace(/^\/+/, "");
          const file = url.origin === ORIGIN ? files.find((f) => f.path.replace(/^\.?\/+/, "") === path) : undefined;
          if (!file) return route.fulfill({ status: 404, body: "" });
          const ext = path.toLowerCase().split(".").pop() ?? "";
          return route.fulfill({ status: 200, contentType: TYPES[ext] ?? "application/octet-stream", body: file.content });
        });
        await page.goto(`${ORIGIN}/${pagePath.replace(/^\.?\/+/, "")}`, { waitUntil: "load", timeout });
        const answers = (await page.evaluate(PROBE_SCRIPT, probes)) as ProbeAnswer[];
        return { answers, consoleErrors };
      } finally {
        await context.close().catch(() => {});
      }
    },
    async close() {
      const b = browser;
      browser = null;
      if (b) await (await b.catch(() => null))?.close();
    },
  };
}

// Runs inside the page. Kept as plain browser code, without anything from this file.
function PROBE_SCRIPT(probes: Probe[]): ProbeAnswer[] {
  const all = (selector: string): Element[] | null => {
    try {
      return Array.from(document.querySelectorAll(selector));
    } catch {
      return null;
    }
  };
  // The computed value with the student's styles switched off, to tell "set by the student" from "browser default".
  const baseStyles = (els: Element[], property: string): string[] => {
    const sheets = Array.from(document.styleSheets);
    const inline = els.map((el) => el.getAttribute("style"));
    sheets.forEach((s) => (s.disabled = true));
    els.forEach((el) => el.removeAttribute("style"));
    const out = els.map((el) => getComputedStyle(el).getPropertyValue(property).trim());
    sheets.forEach((s) => (s.disabled = false));
    els.forEach((el, i) => inline[i] !== null && el.setAttribute("style", inline[i]!));
    return out;
  };
  return probes.map((p) => {
    const els = all(p.selector);
    if (!els) return null;
    if (p.kind === "count") return els.length;
    if (p.kind === "text") return els.map((el) => el.textContent ?? "");
    if (p.kind === "attr") return els.map((el) => el.getAttribute(p.name));
    const values = els.map((el) => getComputedStyle(el).getPropertyValue(p.property).trim());
    const base = baseStyles(els, p.property);
    const answer: StyleAnswer = { values: values.map((value, i) => ({ value, base: base[i]! })) };
    // Put the expected value on a twin of the first match and read it back, computed the same way. It's removed
    // before the page ever paints, so nobody sees it.
    const first = els[0];
    if (p.expected !== undefined && first?.parentElement) {
      const twin = document.createElement(first.tagName);
      twin.style.setProperty(p.property, p.expected);
      first.parentElement.appendChild(twin);
      answer.want = getComputedStyle(twin).getPropertyValue(p.property).trim();
      twin.remove();
    }
    return answer;
  });
}
