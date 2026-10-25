// CalHack's own browser window, driven with Playwright: the installed Chrome (or Edge) with a profile of its own, so
// sign-ins made there are kept for next time. Nothing is downloaded: Playwright drives the browser already on the Mac.
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BrowserContext, Page } from "playwright-core";
import { SNAPSHOT_JS, type PageItem, type PageSnapshot } from "./snapshot.js";
import type { WebDeps, WebStep } from "./webtask.js";

const PROFILE = join(homedir(), ".cache", "calhack", "browser");

export function browserPath(): string | null {
  const candidates = [
    process.env.CALHACK_BROWSER_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  ];
  return candidates.find((p) => p && existsSync(p)) ?? null;
}

let context: BrowserContext | null = null;
let page: Page | null = null;

async function ensurePage(): Promise<Page> {
  if (page && !page.isClosed()) return page;
  if (!context) {
    const exe = browserPath();
    if (!exe) throw new Error("I need Google Chrome or Microsoft Edge for web pages.");
    const { chromium } = await import("playwright-core");
    mkdirSync(PROFILE, { recursive: true });
    context = await chromium.launchPersistentContext(PROFILE, {
      executablePath: exe,
      headless: process.env.CALHACK_BROWSER_HEADLESS === "1",
      viewport: null,
      args: ["--no-first-run", "--no-default-browser-check"],
    });
    context.on("close", () => {
      context = null;
      page = null;
    });
  }
  page = context.pages()[0] ?? (await context.newPage());
  return page;
}

export async function closeBrowser(): Promise<void> {
  const c = context;
  context = null;
  page = null;
  await c?.close().catch(() => {});
}

const at = (p: Page, ref: string) => p.locator(`[data-calhack-ref="${ref}"]`).first();

/** Waits for the page to finish changing after a click: a new page loading, or the same page settling down. */
async function settle(p: Page): Promise<void> {
  // Any of these fails harmlessly if the window was closed: the next look reopens it.
  await p.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => {});
  await p.waitForLoadState("networkidle", { timeout: 4_000 }).catch(() => {});
  await p.waitForTimeout(150).catch(() => {});
}

export function playwrightDeps(): WebDeps {
  return {
    async open(url) {
      const p = await ensurePage();
      await p.bringToFront().catch(() => {});
      if (p.url() !== url) await p.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await settle(p);
    },
    async snapshot() {
      const p = await ensurePage();
      return (await p.evaluate(SNAPSHOT_JS)) as PageSnapshot;
    },
    async act(step: WebStep, item: PageItem) {
      const p = await ensurePage();
      const el = at(p, step.ref);
      try {
        await el.scrollIntoViewIfNeeded({ timeout: 3_000 }).catch(() => {});
        if (step.action === "fill") {
          await el.fill(step.value ?? "", { timeout: 5_000 });
          // Some pages check a field when you leave it.
          await el.dispatchEvent("blur").catch(() => {});
          const back = item.kind === "editable" ? await el.innerText() : await el.inputValue();
          return { ok: true, readBack: back };
        }
        if (step.action === "select") {
          const want = step.value ?? "";
          await el.selectOption({ label: want }, { timeout: 5_000 }).catch(() => el.selectOption(want, { timeout: 5_000 }));
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const back = await el.evaluate((e: any) => (e.selectedIndex >= 0 ? String(e.options[e.selectedIndex].text) : ""));
          return { ok: true, readBack: String(back) };
        }
        if (step.action === "check" || step.action === "uncheck") {
          if (step.action === "check") await el.check({ timeout: 5_000 });
          else await el.uncheck({ timeout: 5_000 });
          return { ok: true, readBack: (await el.isChecked()) ? "checked" : "unchecked" };
        }
        if (step.action === "press_enter") {
          await el.press("Enter", { timeout: 5_000 });
          return { ok: true };
        }
        // A click that sends a form: remember it, so the snapshot shows the browser's own "this field is wrong" messages.
        if (item.submit)
          await el
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .evaluate((e: any) => {
              if (e.form) e.form.dataset.calhackSent = "1";
            })
            .catch(() => {});
        await el.click({ timeout: 5_000 });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: (e as Error).message.split("\n")[0].slice(0, 200) };
      }
    },
    async settle() {
      await settle(await ensurePage());
    },
  };
}
