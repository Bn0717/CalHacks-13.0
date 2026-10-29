// Opens the lesson screen preview (src/app/ui/lesson-preview.html) in headless Chromium, shows every state in light and dark
// mode at 1x and 2x text size, saves a screenshot of each into docs/learn/ui/, and checks each one:
//   contrast  every visible bit of text is at least 4.5:1 against what's behind it
//   names     every button, link and field has a name a screen reader can say
//   overflow  nothing sticks out sideways or gets cut off (the 2x text size is the hard one)
//   overlap   the lesson card never covers the code
//   keyboard  Tab reaches every control in reading order, and each shows a focus ring
//   words     no jargon ("selector", "parse", "runner"...) and no script errors
// Exits with 1 when anything fails, and writes docs/learn/ui/REPORT.md.
//
//   npm run learn:screens            all states, screenshots and the report
//   node scripts/lesson-screens.mjs --quick     checks only, no files written
//   node scripts/lesson-screens.mjs --serve     just serve the preview, to open it in a browser
//
// The preview reads tests/learn/fixtures/about-me.lesson.json, so it's served from the repo root by a tiny local server
// (file:// can't read it).
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const OUT_DIR = join(REPO, "docs", "learn", "ui");
export const PREVIEW_PATH = "/src/app/ui/lesson-preview.html";
export const THEMES = ["light", "dark"];
export const SIZES = [1, 2];
export const VIEWPORT = { width: 1440, height: 900 };

const BROWSER_PATHS = [
  process.env.CALHACK_BROWSER_PATH,
  "/opt/pw-browsers/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
];

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

// ---------------- A tiny static server for the repo ----------------

export function startServer(root = REPO) {
  const server = createServer((req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
      const file = normalize(join(root, path));
      if (!file.startsWith(root + sep) || !existsSync(file)) { res.writeHead(404).end("Not found"); return; }
      res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
      res.end(readFileSync(file));
    } catch {
      res.writeHead(500).end("Server error");
    }
  });
  return new Promise((ok, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      ok({ url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

// ---------------- The browser ----------------

export async function launchBrowser() {
  const { chromium } = await import("playwright-core");
  const executablePath = BROWSER_PATHS.find((p) => p && existsSync(p));
  return chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
}

/** A page with the preview loaded and ready. errors collects console errors and page errors. */
export async function openPreview(browser, baseUrl, { theme = "light" } = {}) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, colorScheme: theme, reducedMotion: "reduce" });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${baseUrl}${PREVIEW_PATH}?shot&still`, { waitUntil: "load" });
  await page.evaluate(() => window.lessonPreview.ready);
  return { page, context, errors };
}

/** Puts the preview on a state, theme and text size, and waits for it to draw. */
export async function showState(page, state, theme, size) {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
  await page.evaluate(({ state, theme, size }) => {
    window.lessonPreview.setTheme(theme);
    window.lessonPreview.setText(size);
    window.lessonPreview.setDock("right");
    if (!window.lessonPreview.show(state)) throw new Error("No such state: " + state);
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  }, { state, theme, size });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

// ---------------- The checks, run inside the page ----------------

function auditInPage() {
  const card = document.getElementById("lesson-card");
  const code = document.getElementById("code-area");
  const out = { contrast: [], names: [], overflow: [], overlap: null, jargon: [], minContrast: Infinity, texts: 0, controls: 0 };
  const short = (el) => (el.textContent || el.getAttribute("aria-label") || el.tagName).trim().replace(/\s+/g, " ").slice(0, 48);
  const visible = (el) => {
    if (el.closest(".sr-only")) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none";
  };

  // Colours
  const parse = (c) => {
    const m = /rgba?\(([^)]+)\)/.exec(c);
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (top, bottom) => ({
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1,
  });
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const backdrop = (el) => {
    const chain = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) chain.unshift(n);
    let bg = { r: 255, g: 255, b: 255, a: 1 };
    for (const n of chain) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) bg = over(c, bg);
    }
    return bg;
  };
  const opacity = (el) => { let o = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) o *= Number(getComputedStyle(n).opacity); return o; };

  for (const el of card.querySelectorAll("*")) {
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== "");
    if (!hasText || !visible(el) || el.closest("button:disabled")) continue;
    const fg = parse(getComputedStyle(el).color);
    if (!fg) continue;
    const bg = backdrop(el);
    const r = ratio(over({ ...fg, a: fg.a * opacity(el) }, bg), bg);
    out.texts++;
    out.minContrast = Math.min(out.minContrast, r);
    if (r < 4.5) out.contrast.push({ text: short(el), ratio: Math.round(r * 100) / 100 });
  }

  // Names
  const nameOf = (el) => {
    const label = el.getAttribute("aria-label");
    if (label && label.trim()) return label.trim();
    const by = el.getAttribute("aria-labelledby");
    if (by) { const t = by.split(/\s+/).map((id) => (document.getElementById(id) || {}).textContent || "").join(" ").trim(); if (t) return t; }
    if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l && l.textContent.trim()) return l.textContent.trim(); }
    const copy = el.cloneNode(true);
    copy.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
    if (copy.textContent.trim()) return copy.textContent.trim();
    return (el.getAttribute("title") || "").trim();
  };
  const controls = card.querySelectorAll('button, a[href], input, textarea, select, [tabindex]:not([tabindex="-1"]), [role="progressbar"], [role="group"], [role="region"]');
  for (const el of [card, ...controls]) {
    if (el !== card && !visible(el)) continue;
    out.controls++;
    if (!nameOf(el)) out.names.push(el.tagName.toLowerCase() + (el.className ? "." + String(el.className).split(" ")[0] : ""));
  }

  // Overflow: nothing wider than its box, nothing poking out of the card, no sideways page scroll.
  const cardRect = card.getBoundingClientRect();
  if (document.documentElement.scrollWidth > window.innerWidth + 1) out.overflow.push("the page scrolls sideways");
  if (cardRect.right > window.innerWidth + 1 || cardRect.left < -1) out.overflow.push("the card is off the screen");
  for (const el of card.querySelectorAll("*")) {
    if (!visible(el) || el.closest(".lbuddy")) continue;
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (s.overflowX !== "visible" && el.scrollWidth > el.clientWidth + 1) out.overflow.push("cut off: " + short(el));
    else if (r.right > cardRect.right + 1 || r.left < cardRect.left - 1) out.overflow.push("sticks out: " + short(el));
  }

  // Overlap with the code
  const c = code.getBoundingClientRect();
  const w = Math.min(c.right, cardRect.right) - Math.max(c.left, cardRect.left);
  const h = Math.min(c.bottom, cardRect.bottom) - Math.max(c.top, cardRect.top);
  if (w > 0 && h > 0) out.overlap = { width: Math.round(w), height: Math.round(h) };

  // Words
  const model = window.StrideLessonModel;
  out.jargon = model.findJargon(card.innerText);
  return out;
}

/** Tabs through the card: every control is reached, in reading order, with a visible focus ring. */
async function keyboardAudit(page) {
  const expected = await page.evaluate(() => [...document.querySelectorAll("#lesson-card button:not(:disabled), #lesson-card textarea")].filter((el) => el.getBoundingClientRect().width > 0).length);
  const seen = [];
  const problems = [];
  // Start just before the lesson window: Tab from the code area.
  await page.evaluate(() => { const c = document.getElementById("code-area"); c.tabIndex = -1; c.focus(); });
  for (let i = 0; i < expected + 3; i++) {
    await page.keyboard.press("Tab");
    const f = await page.evaluate(() => {
      const el = document.activeElement;
      const card = document.getElementById("lesson-card");
      if (!el || el === document.body || !card.contains(el)) return null;
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      // Where it is in reading order: header, then the scrolling body (measured as if not scrolled), then the buttons.
      const body = document.getElementById("l-body");
      const part = el.closest(".lhead") ? 0 : body.contains(el) ? 1 : 2;
      const shift = part === 1 ? body.scrollTop : 0;
      if (!el.dataset.auditId) el.dataset.auditId = String(Math.random()).slice(2, 10); // tells two same-looking controls apart
      return { key: el.dataset.key || el.id || el.tagName, id: el.dataset.auditId, ring: s.outlineStyle !== "none" && parseFloat(s.outlineWidth) >= 2, part, top: Math.round(r.top + shift), bottom: Math.round(r.bottom + shift) };
    });
    if (!f) break; // left the card: done
    if (seen.some((s) => s.id === f.id)) break;
    seen.push(f);
    if (!f.ring) problems.push("no focus ring on " + f.key);
  }
  for (let i = 1; i < seen.length; i++) {
    const a = seen[i - 1], b = seen[i];
    // The next control is in a later part, or lower in the same part (or on the same row).
    if (b.part < a.part || (b.part === a.part && b.bottom < a.top - 2)) problems.push(`Tab jumps up from ${a.key} to ${b.key}`);
  }
  if (seen.length < expected) problems.push(`Tab reached ${seen.length} of ${expected} controls`);
  await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  return problems;
}

// ---------------- The run ----------------

// A screenshot, squeezed to a 256-colour PNG so 144 of them stay small in the repo.
async function saveShot(page, path) {
  const png = await page.screenshot();
  try {
    const sharp = (await import("sharp")).default;
    await sharp(png).png({ palette: true, quality: 95, effort: 8, compressionLevel: 9 }).toFile(path);
  } catch {
    writeFileSync(path, png);
  }
}

export async function runLessonScreens({ quick = false, shots = !quick, write = !quick, states: only, themes = THEMES, sizes = SIZES, keyboard = true, log = console.log } = {}) {
  const server = await startServer();
  const browser = await launchBrowser();
  const results = [];
  try {
    const { page, context, errors } = await openPreview(browser, server.url);
    const states = only ?? (await page.evaluate(() => window.lessonPreview.states));
    if (shots) {
      mkdirSync(OUT_DIR, { recursive: true });
      for (const f of readdirSync(OUT_DIR)) if (f.endsWith(".png")) rmSync(join(OUT_DIR, f));
    }
    for (const theme of themes) {
      for (const size of sizes) {
        for (const state of states) {
          errors.length = 0;
          await showState(page, state, theme, size);
          const audit = await page.evaluate(auditInPage);
          const file = `${theme}-${size}x-${state}.png`;
          if (shots) await saveShot(page, join(OUT_DIR, file)); // before Tab moves focus and scrolls
          const keys = keyboard ? await keyboardAudit(page) : [];
          const failures = [
            ...audit.contrast.map((c) => `contrast ${c.ratio}:1 on "${c.text}"`),
            ...audit.names.map((n) => `no name: ${n}`),
            ...audit.overflow,
            ...(audit.overlap ? [`covers the code by ${audit.overlap.width}x${audit.overlap.height}px`] : []),
            ...audit.jargon.map((j) => `jargon: "${j}"`),
            ...keys,
            ...errors.map((e) => `script error: ${e}`),
          ];
          results.push({ state, theme, size, file: shots ? file : null, failures, minContrast: audit.minContrast, texts: audit.texts, controls: audit.controls });
        }
      }
    }
    await context.close();
  } finally {
    await browser.close();
    await server.close();
  }
  const failed = results.filter((r) => r.failures.length > 0);
  const summary = { results, failed, states: [...new Set(results.map((r) => r.state))], shots: results.filter((r) => r.file).length };
  if (write) writeFileSync(join(OUT_DIR, "REPORT.md"), report(summary));
  log(shortReport(summary));
  return summary;
}

function shortReport({ results, failed, states, shots }) {
  const min = (theme) => Math.min(...results.filter((r) => r.theme === theme).map((r) => r.minContrast));
  const lines = [
    `Lesson screen: ${states.length} states x ${THEMES.length} themes x ${SIZES.length} text sizes = ${results.length} views, ${shots} screenshots.`,
    `Lowest text contrast: light ${min("light").toFixed(2)}:1, dark ${min("dark").toFixed(2)}:1 (needs 4.5:1).`,
    failed.length === 0 ? "All checks passed." : `${failed.length} views have problems:`,
  ];
  for (const r of failed) lines.push(`  ${r.theme} ${r.size}x ${r.state}: ${r.failures.join("; ")}`);
  return lines.join("\n");
}

function report(summary) {
  const { results, failed, states } = summary;
  const min = (theme) => Math.min(...results.filter((r) => r.theme === theme).map((r) => r.minContrast)).toFixed(2);
  const cell = (state, theme, size) => {
    const r = results.find((x) => x.state === state && x.theme === theme && x.size === size);
    if (!r) return "–";
    const mark = r.failures.length ? "❌" : "✅";
    return r.file ? `${mark} [png](${r.file})` : mark;
  };
  const out = [
    "# Lesson screen: screenshots and checks",
    "",
    "Made by `npm run learn:screens` (scripts/lesson-screens.mjs) from `src/app/ui/lesson-preview.html` in headless Chromium,",
    `at ${VIEWPORT.width}x${VIEWPORT.height}, with Reduce Motion on so every picture is the settled state. Don't edit by hand.`,
    "",
    "Each view is checked for:",
    "",
    "- **Contrast**: every visible bit of text is at least 4.5:1 against what's really behind it.",
    "- **Names**: every button, field, group and the progress bar has a name a screen reader can say.",
    "- **Overflow**: nothing is cut off or sticks out sideways, and the page never scrolls sideways (2x text too).",
    "- **Overlap**: the lesson card never covers the code area.",
    "- **Keyboard**: Tab reaches every control in reading order, each with a visible focus ring.",
    "- **Words**: no jargon (" + "DOM, selector, parse, runner, anchor, check…" + ") and no script errors.",
    "",
    `**${states.length} states x 2 themes x 2 text sizes = ${results.length} views. ${failed.length === 0 ? "All checks pass." : failed.length + " views have problems."}**`,
    "",
    `Lowest text contrast: light **${min("light")}:1**, dark **${min("dark")}:1**.`,
    "",
    "| State | Light 1x | Light 2x | Dark 1x | Dark 2x |",
    "|---|---|---|---|---|",
    ...states.map((s) => `| ${s} | ${cell(s, "light", 1)} | ${cell(s, "light", 2)} | ${cell(s, "dark", 1)} | ${cell(s, "dark", 2)} |`),
    "",
  ];
  if (failed.length) {
    out.push("## Problems", "");
    for (const r of failed) out.push(`- ${r.theme} ${r.size}x **${r.state}**: ${r.failures.join("; ")}`);
    out.push("");
  }
  return out.join("\n");
}

// ---------------- Command line ----------------

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = new Set(process.argv.slice(2));
  if (args.has("--serve")) {
    const server = await startServer();
    console.log(`Lesson preview: ${server.url}${PREVIEW_PATH}`);
    console.log("Press Ctrl+C to stop.");
  } else {
    const quick = args.has("--quick");
    const summary = await runLessonScreens({ quick }).catch((e) => {
      console.error("Couldn't run the lesson screen checks: " + (e instanceof Error ? e.message : String(e)));
      process.exit(2);
    });
    process.exit(summary.failed.length === 0 ? 0 : 1);
  }
}
