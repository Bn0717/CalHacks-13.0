// Browser-only grounding evaluation. No macOS commands or desktop mouse events.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium, type Page } from "playwright-core";
import { loadEnv } from "../ai/client.js";
import { hasPointerKey, locateWithProvider, pointerModel, screenPoint, type Point, type PointerAttempt, type PointerImage, type PointerProvider } from "../ai/positioner.js";
import { createDemoServer } from "./serve-demo.js";

type Rect = { x: number; y: number; width: number; height: number };
interface Case { name: string; path: string; target: string; selector?: string; destination?: string }
const cases: Case[] = [
  { name: "wget navigation", path: "/", target: "The link labelled How to install wget on a Mac in the demo pages list", selector: 'a[href="install-wget.html"]', destination: "/install-wget.html" },
  { name: "Rectangle navigation", path: "/", target: "The link labelled Install Rectangle (2018 blog post) in the demo pages list", selector: 'a[href="old-rectangle-guide.html"]', destination: "/old-rectangle-guide.html" },
  { name: "printer navigation", path: "/", target: "The Add a printer link in the demo pages list, not the PDF link", selector: 'a[href="add-printer.html"]', destination: "/add-printer.html" },
  { name: "guide highlight", path: "/install-wget.html", target: "The page heading How do I install wget on my Mac?", selector: "h1" },
  { name: "absent target", path: "/", target: "The Export all settings as CSV button" },
];
const providers: PointerProvider[] = ["jev", "haiku"];
const inside = (point: Point | undefined, rect: Rect | null): boolean => !!point && !!rect && point.x >= rect.x && point.y >= rect.y && point.x < rect.x + rect.width && point.y < rect.y + rect.height;

function browserPath(explicit?: string): string {
  const candidates = [explicit, process.env.CALHACK_BROWSER_PATH,
    process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, "Google/Chrome/Application/chrome.exe"),
    process.env["PROGRAMFILES(X86)"] && join(process.env["PROGRAMFILES(X86)"], "Microsoft/Edge/Application/msedge.exe"),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe"),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  const path = candidates.find((p) => p && existsSync(p));
  if (!path) throw new Error("Chrome/Edge was not found. Pass --browser <executable> or set CALHACK_BROWSER_PATH.");
  return path;
}

/** Exercise the real pointer renderer in an isolated, click-through iframe. */
async function checkHighlight(page: Page, point: Point, rect: Rect | null, base: string): Promise<boolean> {
  await page.evaluate((url) => {
    const frame = document.createElement("iframe");
    frame.id = "pointer-check";
    frame.src = url;
    frame.style.cssText = "position:fixed;inset:0;width:100%;height:100%;border:0;pointer-events:none;z-index:999999";
    document.body.append(frame);
  }, new URL("/__pointer__/pointer.html", base).href);
  try {
    const element = await page.locator("#pointer-check").elementHandle();
    const frame = await element?.contentFrame();
    if (!frame) throw new Error("Pointer iframe was not created.");
    await frame.waitForFunction(() => typeof (window as unknown as { __pointer?: unknown }).__pointer === "function");
    await frame.evaluate((p) => {
      const w = window as unknown as { __pointer: (p: unknown) => void };
      document.getElementById("spot")!.style.transition = "none";
      w.__pointer({ show: true, ...p, label: "Comparison target" });
    }, point);
    const actual = await frame.locator("#spot").evaluate((spot) => {
      const bounds = spot.getBoundingClientRect();
      return { x: bounds.x, y: bounds.y, hidden: spot.classList.contains("is-hidden") };
    });
    return !actual.hidden && Math.abs(actual.x - point.x) < 1 && Math.abs(actual.y - point.y) < 1 && inside(actual, rect);
  } finally {
    await page.locator("#pointer-check").evaluate((frame) => frame.remove());
  }
}

async function main(): Promise<void> {
  loadEnv();
  const { values } = parseArgs({ options: {
    mock: { type: "boolean", default: false }, live: { type: "boolean", default: false },
    runs: { type: "string", default: "1" }, output: { type: "string" },
    browser: { type: "string" }, url: { type: "string" },
  } });
  if (values.mock && values.live) throw new Error("Choose either --mock or --live.");
  const runs = Number(values.runs);
  if (!Number.isInteger(runs) || runs < 1 || runs > 100) throw new Error("--runs must be an integer from 1 to 100.");
  const mode = values.mock ? "mock" : "live";
  const output = resolve(values.output ?? join("downloads", `pointer-comparison-${mode}-${Date.now()}.jsonl`));
  const base = new URL(values.url ?? "http://127.0.0.1:4321").origin;
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname)) throw new Error("--url must point to the local demo server.");
  const enabled = providers.filter((p) => values.mock || hasPointerKey(p));
  const records: Record<string, unknown>[] = [];
  for (const provider of providers.filter((p) => !enabled.includes(p))) {
    console.log(`Skipped ${provider}: missing ${provider === "jev" ? "TYPESAFE_API_KEY" : "ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN"}.`);
    records.push({ mode, provider, model: pointerModel(provider), status: "skipped", reason: "missing_key" });
  }
  console.log(values.mock ? "MOCK: DOM-derived oracle results test browser/renderer plumbing only. These are not model quality or latency measurements." : "LIVE: matching screenshot + target for each provider, no fallback. Timings exclude planning and browser work.");
  const server = !values.url && enabled.length ? createDemoServer() : undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  try {
    if (server) await new Promise<void>((done, fail) => {
      server.once("error", () => fail(new Error("Cannot start demo server on port 4321. If it is already running, pass --url http://127.0.0.1:4321.")));
      server.listen(4321, "127.0.0.1", done);
    });
    if (!enabled.length) return;
    browser = await chromium.launch({ executablePath: browserPath(values.browser), headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
    // Keep this browser bootstrap independent of tsx's generated function-name helpers.
    await context.addInitScript({ content: "window.calhack = { on: function(channel, callback) { window.__pointer = callback; } };" });
    await context.route("**/__pointer__/*", async (route) => {
      const name = new URL(route.request().url()).pathname.split("/").pop()!;
      if (!["pointer.html", "pointer.css", "pointer.js"].includes(name)) return route.abort();
      await route.fulfill({ body: await readFile(join(process.cwd(), "src/app/ui", name)), contentType: name.endsWith("html") ? "text/html" : name.endsWith("css") ? "text/css" : "application/javascript" });
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => console.error(`Browser fixture: ${error.message}`));
    page.setDefaultTimeout(5000);
    for (let run = 0; run < runs; run++) for (const test of cases) {
      controller.signal.throwIfAborted();
      await page.goto(new URL(test.path, base).href, { waitUntil: "networkidle" });
      const rect = test.selector ? await page.locator(test.selector).boundingBox() : null;
      if (test.selector && !rect) throw new Error(`Missing fixture target: ${test.name}`);
      const bytes = await page.screenshot({ type: "png", animations: "disabled" });
      const image: PointerImage = { data: bytes.toString("base64"), mediaType: "image/png", width: 1280, height: 900 };
      const screenshotHash = createHash("sha256").update(bytes).digest("hex");
      // Both results are obtained before any click or overlay changes the screenshot.
      const results = await Promise.all(enabled.map(async (provider): Promise<PointerAttempt> => values.mock
        ? { provider, model: `mock-${provider}`, status: rect ? "found" : "not_found", elapsedMs: 0, point: rect ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : undefined }
        : locateWithProvider(provider, test.target, image, controller.signal)));
      for (const result of results) {
        let clickPassed: boolean | undefined;
        let highlightPassed: boolean | undefined;
        const point = result.point && screenPoint(result.point, { ...image, toScreen: 1 });
        const hit = inside(result.point, rect);
        if (point && rect) {
          // Restore identical fixture state before exercising each provider's coordinates.
          await page.goto(new URL(test.path, base).href, { waitUntil: "networkidle" });
          highlightPassed = await checkHighlight(page, point, rect, base);
          if (test.destination) {
            await page.mouse.click(point.x, point.y);
            try { await page.waitForURL(new URL(test.destination, base).href, { timeout: 2500 }); clickPassed = true; }
            catch { clickPassed = false; }
          }
        }
        records.push({ mode, run, case: test.name, target: test.target, screenshotHash, ...result, expectedPresent: !!rect,
          pointInsideTarget: rect ? hit : undefined,
          absentRejected: !rect ? result.status === "not_found" || result.status === "rejected" : undefined,
          clickPassed, highlightPassed });
      }
    }
    console.table(enabled.map((provider) => {
      const rows = records.filter((r) => r.provider === provider && r.status !== "skipped");
      const present = rows.filter((r) => r.expectedPresent === true);
      const absent = rows.filter((r) => r.expectedPresent === false);
      const times = rows.map((r) => Number(r.elapsedMs)).sort((a, b) => a - b);
      const usage = rows.map((r) => r.usage as PointerAttempt["usage"]).filter((u) => u !== undefined);
      return { provider, model: [...new Set(rows.map((r) => r.model))].join(", "), mode, "target hits": `${present.filter((r) => r.pointInsideTarget).length}/${present.length}`,
        "absent rejected": `${absent.filter((r) => r.absentRejected).length}/${absent.length}`,
        errors: rows.filter((r) => r.status === "error").length,
        "clicks passed": `${rows.filter((r) => r.clickPassed).length}/${present.filter((r) => cases.find((c) => c.name === r.case)?.destination).length}`,
        "highlights passed": `${rows.filter((r) => r.highlightPassed).length}/${present.length}`,
        "median ms": values.mock ? "synthetic" : times[Math.floor(times.length / 2)],
        "p95 ms": values.mock ? "synthetic" : times[Math.max(0, Math.ceil(times.length * 0.95) - 1)],
        "input tokens": usage.length ? usage.reduce((n, u) => n + u!.inputTokens, 0) : "unreported",
        "output tokens": usage.length ? usage.reduce((n, u) => n + u!.outputTokens, 0) : "unreported" };
    }));
    if (values.mock && records.some((r) => r.pointInsideTarget === false || r.absentRejected === false || r.clickPassed === false || r.highlightPassed === false)) process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", stop);
    await browser?.close();
    if (server?.listening) await new Promise<void>((done) => server.close(() => done()));
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
    console.log(`Results: ${output}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Pointer comparison failed.");
  process.exitCode = 1;
});
