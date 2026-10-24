// CalHack desktop app. Press ⌃⌥⌘D and CalHack looks at your screen, then:
//  - follows the how-to you're reading (forum post, support page, PDF), or
//  - fixes the problem you have ("my printer won't print"): read-only checks → OK → fix → same checks again, or
//  - asks "Hi! What's going on?", and finds the official source (Apple support, the app maker's site) when it has no guide.
// The helper bar (bottom-center) shows each moment, the buddy hops to where the work is, and a voice says what's happening.
// Code decides what's safe. Droid (Factory) runs the approved commands. A separate Claude call writes the receipt.
import { app, BrowserWindow, clipboard, desktopCapturer, globalShortcut, ipcMain, Menu, nativeImage, screen, session as electronSession, shell, systemPreferences, Tray } from "electron";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { findAppBundles, uninstallApp, uninstallRequest } from "../core/uninstall.js";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describeEnvironment, probeEnvironment, type Environment } from "../core/probe.js";
import { applyAiConcerns, planSteps, type Plan } from "../core/plan.js";
import { check, runPlannedStep, type Executor, type RunHooks } from "../core/runner.js";
import { runNormally, runSandboxed } from "../core/exec.js";
import { runSequence } from "../core/sequence.js";
import { collectEvidence, type Receipt } from "../core/receipt.js";
import { assessCommand } from "../core/risk.js";
import { scanForScamSigns } from "../core/source.js";
import { runRecipe } from "../core/recipes.js";
import { installFromOfficial, knownInstaller } from "../core/install.js";
import { checkOfficial } from "../core/official.js";
import { buildFixes, diagnose, getGuide, guideMenu, realCheckRunner, verifyFix, type BuiltFix, type Diagnosis, type FixGuide } from "../core/fixes/index.js";
import type { Evidence, InstructionSource, PlannedStep, Step, StepResult } from "../core/types.js";
import { reviewRun } from "../ai/review.js";
import { triage, type Triage } from "../ai/triage.js";
import { friendlyError, hasApiKey, loadEnv } from "../ai/client.js";
import { parseInstructions, type ParseResult } from "../ai/parse.js";
import { locateOnScreen, type ScreenLocation } from "../ai/locate.js";
import { droidProblem, runWithDroid } from "../droid/executor.js";
import { findOfficialSource, type OfficialSource } from "../droid/research.js";
import { fetchPageText } from "../mac/text.js";
import { frontAppName } from "../mac/front.js";
import { describeSource, gatherInstructions } from "./gather.js";
import { transcribe, voiceProblem } from "./voice-in.js";
import { synthesize, stopVoiceOut } from "./voice-out.js";
import type { BarState, CheckLine, DetailLine, StepLine } from "./protocol.js";
import { detailLines, helpSummary, planNotes, receiptView, stepLines } from "./view.js";
import { barLine, buddyHome, buddyPoint, buddyPose, buddyScanScreen, buddyTo, currentBar, dockSpot, ensureBar, focusBar, say, screenTopCenter, setBarRect, showBar, toBuddy } from "./windows.js";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "..");
process.env.CALHACK_ROOT ??= ROOT;
loadEnv(ROOT);

// The shortcut can be changed with CALHACK_HOTKEY in .env (Electron format, e.g. "Control+Alt+Command+D").
const HOTKEY = process.env.CALHACK_HOTKEY?.trim() || "Control+Alt+Command+D";
const KEY_SYMBOLS: Record<string, string> = { control: "⌃", ctrl: "⌃", alt: "⌥", option: "⌥", shift: "⇧", command: "⌘", cmd: "⌘", commandorcontrol: "⌘", cmdorctrl: "⌘" };
const KEY_LABEL = HOTKEY.split("+").map((k) => KEY_SYMBOLS[k.toLowerCase()] ?? k.toUpperCase()).join("");
const UI = (name: string) => join(here, "ui", name);
const UI_URL = pathToFileURL(join(here, "ui")).href + "/";
const PRELOAD = join(here, "preload.cjs");
const OWN_APP_NAMES = new Set(["Electron", "CalHack"]);
const SUGGESTIONS = ["My printer won't print", "I can't hear anything", "The internet isn't working", "Install Zoom"];

let tray: Tray | null = null;
let warning: BrowserWindow | null = null;

/** One job: following a how-to, fixing a problem, or installing an app from its official site. */
interface Job {
  mode: "instructions" | "fix" | "install";
  goal: string;
  source: InstructionSource;
  plan: Plan;
  parse?: ParseResult;
  /** For fixes: the guide and what the first checks found. */
  guide?: FixGuide;
  before?: Diagnosis;
  fixes?: BuiltFix[];
  problem?: string;
  /** For installs. */
  install?: { url: string; publisher: string; appName: string; page: OfficialSource | null };
  useUpdated: Set<string>;
  useRecipe: Set<string>;
  results: Map<string, StepResult>;
  recipesTried: Map<string, { stepId: string; ok: boolean }>;
  receipt: Receipt | null;
  beforeAfter: { label: string; before: string; after: string }[];
  /** Extra lines for "show what's happening", e.g. what Droid did while searching. */
  extraDetail: DetailLine[];
  sourceLabel: string;
}

let job: Job | null = null;
let busy = false;
let running = false;
let stopRequested = false;
let envCache: { env: Environment; at: number } | null = null;
let lastExternalApp: string | null = null;
/** The last screenshot and screen text, so an answer can be read together with what was on screen. */
let lastLook: { shot: Shot | null; screenText: string } = { shot: null, screenText: "" };
/** After a guide finds nothing wrong, "Yes, look it up" searches the official help for this goal. */
let pendingLookup: string | null = null;

const approvals = new Map<string, (yes: boolean) => void>();
const manualWaits = new Map<string, (answer: "done" | "skip") => void>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- Screen ----------

interface Shot {
  data: string;
  mediaType: "image/jpeg";
  width: number;
  height: number;
  /** Multiply screenshot pixels by this to get screen points. */
  toScreen: number;
}

async function captureScreen(): Promise<Shot | null> {
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.bounds;
  try {
    const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width, height } });
    const src = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
    if (!src || src.thumbnail.isEmpty()) return null;
    // Claude works best with images up to about 1500 pixels on the long side.
    const scale = Math.min(1, 1456 / Math.max(width, height));
    const img = scale < 1 ? src.thumbnail.resize({ width: Math.round(width * scale), quality: "good" }) : src.thumbnail;
    const size = img.getSize();
    return { data: img.toJPEG(75).toString("base64"), mediaType: "image/jpeg", width: size.width, height: size.height, toScreen: width / size.width };
  } catch {
    return null;
  }
}

function screenAllowed(): boolean {
  return systemPreferences.getMediaAccessStatus("screen") === "granted";
}

async function getEnvironment(): Promise<Environment> {
  if (envCache && Date.now() - envCache.at < 5 * 60_000) return envCache.env;
  const env = await probeEnvironment();
  envCache = { env, at: Date.now() };
  return env;
}

/** Only System Settings links are opened, whatever the AI suggests. */
function safeSettingsUrl(url?: string): string | null {
  return url && /^x-apple\.systempreferences:[A-Za-z0-9._\-?=&]+$/.test(url) ? url : null;
}

// ---------- Bar views ----------

function droidReady(): boolean {
  return !droidProblem();
}

function lower(text: string): string {
  return text ? text[0].toLowerCase() + text.slice(1) : text;
}

function jobSteps(j: Job, runningId?: string): StepLine[] {
  return stepLines(j.plan.steps, j.results, runningId);
}

function jobDetail(j: Job): DetailLine[] {
  return [...j.extraDetail, ...detailLines(j.plan.steps, j.results, droidReady())];
}

function showPlan(j: Job): void {
  const notes = planNotes({
    steps: j.plan.steps,
    useUpdated: j.useUpdated,
    useRecipe: j.useRecipe,
    pageWarnings: [...j.plan.pageWarnings.filter((w) => w.level !== "blocked").map((w) => w.reason), ...(j.parse?.pageConcerns.filter((c) => c.steps.length === 0).map((c) => c.text) ?? [])],
    droidReady: droidReady(),
  });
  const scam = j.plan.pageWarnings.some((w) => w.level === "blocked");
  const left = j.plan.steps.filter((p) => p.step.kind !== "info" && !j.results.has(p.step.id));
  if (left.length === 0 && !scam) {
    showBar({
      phase: "done",
      receipt: { verdict: "done", headline: "Good news: this is already done on your Mac.", beforeAfter: [], proofs: [], problems: [], reviewedBy: "rules" },
      steps: jobSteps(j),
      detail: jobDetail(j),
      canRetry: false,
      canSendSummary: false,
    });
    say("Good news. This is already done on your Mac.", "now");
    buddyHome("celebrate");
    return;
  }
  showBar({
    phase: "plan",
    goal: scam ? "This page looks like a scam" : j.goal,
    problem: scam ? (j.plan.pageWarnings.find((w) => w.level === "blocked")?.reason ?? "Real websites never ask you to paste commands.") : j.problem,
    steps: scam ? [] : jobSteps(j),
    notes: scam ? [{ tone: "blocked", text: "This page looks like a scam. I won't run anything from it, and please don't paste anything from it." }, ...notes] : notes,
    okLabel: scam ? "" : j.mode === "fix" ? "OK, fix it" : j.mode === "install" ? "Yes, install" : "OK, do it",
    cancelLabel: scam ? "Close" : "Not now",
    source: j.sourceLabel,
  });
  buddyHome(scam ? "stop" : "wave");
  if (!scam) autoOk();
}

/** Testing only: CALHACK_AUTO_OK=1 presses OK by itself a few seconds after the plan shows. */
function autoOk(): void {
  if (process.env.CALHACK_AUTO_OK === "1") setTimeout(() => void runAll(), 4000);
}

function showWorking(j: Job, current?: PlannedStep, line?: string): void {
  const work = j.plan.steps.filter((p) => p.step.kind !== "info" || j.mode === "install");
  const n = current ? work.indexOf(current) + 1 : work.filter((p) => j.results.has(p.step.id)).length;
  showBar({
    phase: "working",
    goal: j.goal,
    current: Math.max(1, n),
    total: work.length,
    line: line ?? (current ? current.step.title : "Working…"),
    steps: j.mode === "install" ? installLines(j, current?.step.id) : jobSteps(j, current?.step.id),
    detail: jobDetail(j),
  });
}

function showError(message: string): void {
  showBar({ phase: "error", message });
  say(message, "now");
  buddyHome("sad");
}

function askWhat(question = "Hi! What's going on?", suggestions = SUGGESTIONS): void {
  showBar({ phase: "ask", question, suggestions, listening: false, transcribing: false });
  say(question, "now");
  buddyHome("think");
  focusBar();
}

// ---------- The hotkey ----------

async function onHotkey(): Promise<void> {
  if (busy || running) {
    ensureBar().showInactive();
    return;
  }
  busy = true;
  job = null;
  pendingLookup = null;
  try {
    let appName = await frontAppName();
    if (appName && OWN_APP_NAMES.has(appName)) appName = lastExternalApp;
    if (appName) lastExternalApp = appName;

    showBar({ phase: "looking", message: "Let me take a look…" });
    say("Let me take a look.", "now");
    buddyHome("scan");
    buddyScanScreen();

    if (!hasApiKey()) {
      showError("I need a Claude API key first. Put ANTHROPIC_API_KEY in the .env file, then restart me.");
      return;
    }
    const shot = screenAllowed() ? await captureScreen() : null;
    const source = await gatherInstructions({ app: appName, recentClipboard: recentClipboard() });
    lastLook = { shot, screenText: source.text.slice(0, 6000) };

    // Our own scam check comes first: a fake "verify you're human" page gets the warning, whatever the AI thinks.
    if (source.text.trim() && scanForScamSigns(source.text).some((w) => w.level === "blocked")) {
      await instructionsFlow(source, shot);
      return;
    }

    const env = await getEnvironment();
    const t = await triage({
      screenText: lastLook.screenText,
      screenshot: shot ? { data: shot.data, mediaType: shot.mediaType } : undefined,
      guides: guideMenu(),
      environment: describeEnvironment(env),
    }).catch((): Triage => (source.text.trim() ? { kind: "instructions" } : { kind: "clarify", question: "Hi! What's going on?", suggestions: SUGGESTIONS, say: "Hi! What's going on?" }));

    // A page full of steps is followed as written, not swapped for a web search (the person said nothing else).
    const pageWithSteps = source.kind !== "screenshot" && source.text.trim().length > 200 && /\b(step|install|click|open|run|terminal|download|settings)\b/i.test(source.text);
    if ((t.kind === "instructions" && (source.text.trim() || shot)) || (t.kind === "search" && pageWithSteps)) await instructionsFlow(source, shot);
    else await route(t);
  } catch (error) {
    showError(friendlyError(error));
  } finally {
    busy = false;
  }
}

/** Something the person typed or said, read together with what was on screen. */
async function onAnswer(text: string): Promise<void> {
  if (busy || running) return;
  const clean = text.trim();
  if (!clean) return;
  if (/^(no|no thanks|nope|not now|cancel)\b/i.test(clean)) {
    showBar({ phase: "hidden" });
    return;
  }
  busy = true;
  try {
    // "Yes, look it up" after a guide found nothing it could fix.
    if (/^yes,? look it up/i.test(clean) && pendingLookup) {
      const goal = pendingLookup;
      pendingLookup = null;
      await searchFlow({ kind: "search", goal, query: goal + " on a Mac", say: "I'll look up the official help." });
      return;
    }
    const removal = uninstallRequest(clean);
    if (removal) {
      await uninstallFlow(removal);
      return;
    }
    showBar({ phase: "looking", message: `“${clean}”. Let me think…` });
    buddyPose("think");
    const env = await getEnvironment();
    const t = await triage({ text: clean, screenText: lastLook.screenText, guides: guideMenu(), environment: describeEnvironment(env) });
    if (t.kind === "instructions") await route({ kind: "search", goal: clean, query: clean, say: "Let me find the official steps for that." });
    else await route(t);
  } catch (error) {
    showError(friendlyError(error));
  } finally {
    busy = false;
  }
}

async function route(t: Triage): Promise<void> {
  if (t.kind === "guide") {
    const guide = getGuide(t.guideId);
    if (guide) return fixFlow(guide, t.say);
    return searchFlow({ kind: "search", goal: t.goal, query: t.goal, say: t.say });
  }
  if (t.kind === "search") {
    const removal = uninstallRequest(t.goal);
    if (removal) return uninstallFlow(removal);
    return searchFlow(t);
  }
  if (t.kind === "clarify") return askWhat(t.question, t.suggestions.length ? t.suggestions : SUGGESTIONS);
  askWhat();
}

/** Direct requests authorize reversible removal; no researcher, page, or manual steps. */
async function uninstallFlow(name: string): Promise<void> {
  job = null;
  running = true;
  buddyHome("carry");
  say(`I'll remove ${name} from Applications.`, "now");
  try {
    const result = await uninstallApp(name, {
      find: findAppBundles,
      exists: existsSync,
      trash: (path) => shell.trashItem(path),
      quit: async (path) => {
        const literal = '"' + path.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
        // Checking `running` avoids launching the app just to close it.
        const script = `with timeout of 15 seconds\nif application ${literal} is running then\ntell application ${literal} to quit\nrepeat 20 times\nif not (application ${literal} is running) then exit repeat\ndelay 0.25\nend repeat\nif application ${literal} is running then error "The app did not close, so it was not moved."\nend if\nend timeout`;
        await promisify(execFile)("/usr/bin/osascript", ["-e", script], { timeout: 20_000 });
      },
    }, (message) => showBar({ phase: "looking", message }));
    showBar({ phase: "done", receipt: {
      verdict: result.ok ? "done" : "not-done", headline: result.message,
      beforeAfter: [], proofs: result.ok && result.paths.length ? [{ claim: `${name} is no longer at its Applications location`, checks: result.paths.map((p) => `Confirmed absent: ${p}`) }] : [],
      problems: result.ok ? [] : [result.message], reviewedBy: "rules",
    }, steps: [], detail: [], canRetry: false, canSendSummary: false });
    say(result.message, "now");
    buddyHome(result.ok ? "celebrate" : "sad");
  } finally { running = false; }
}

// ---------- Mode 1: follow the how-to on screen ----------

function newJob(mode: Job["mode"], goal: string, source: InstructionSource, plan: Plan, sourceLabel: string): Job {
  return {
    mode,
    goal,
    source,
    plan,
    useUpdated: new Set(plan.steps.filter((p) => p.assessment.outdated?.suggestion).map((p) => p.step.id)),
    useRecipe: new Set(plan.steps.filter((p) => p.recipe).map((p) => p.step.id)),
    results: new Map(),
    recipesTried: new Map(),
    receipt: null,
    beforeAfter: [],
    extraDetail: [],
    sourceLabel,
  };
}

async function instructionsFlow(source: InstructionSource, shot: Shot | null, sourceLabel?: string, extra: DetailLine[] = [], requestedGoal?: string): Promise<void> {
  showBar({ phase: "looking", message: `Reading ${describeSource(source)}…` });
  if (source.kind === "screenshot" && !shot) {
    askWhat("I couldn't read anything on your screen. What are you trying to do?");
    return;
  }
  const env = await getEnvironment();
  const parse = await parseInstructions({
    source,
    requestedGoal,
    environment: describeEnvironment(env),
    screenshot: shot ? { data: shot.data, mediaType: shot.mediaType } : undefined,
    allowCache: true,
  });
  if (parse.steps.length === 0) {
    askWhat("I don't see any steps to follow here. What are you trying to do?");
    return;
  }
  if (requestedGoal && /\b(uninstall|remove|delete)\b/i.test(requestedGoal) && parse.steps.some((s) => s.kind === "download")) {
    showError("This page mixes removal with reinstalling. I couldn't isolate the removal steps, so I stopped without downloading anything.");
    return;
  }
  const plan = planSteps(parse.steps, source);
  applyAiConcerns(plan, parse.pageConcerns, parse.appliesToThisComputer);
  const j = newJob("instructions", requestedGoal ?? parse.goal, source, plan, sourceLabel ?? `From ${describeSource(source)}`);
  j.parse = parse;
  j.extraDetail = extra;

  // Steps already done are skipped up front.
  showBar({ phase: "looking", message: "Checking what's already done on your Mac…" });
  await Promise.all(
    plan.steps.map(async (p) => {
      if (p.assessment.wrongPlatform || p.step.kind === "info") return;
      const c = await check(p, "before").catch(() => null);
      if (c?.passed) j.results.set(p.step.id, { id: p.step.id, status: "already-done", message: "Already done on this Mac, so we skipped it.", evidence: [c.evidence] });
    }),
  );
  job = j;
  showPlan(j);
  const blocked = plan.steps.filter((p) => p.level === "blocked" && (p.step.kind === "command" || p.step.kind === "download")).length;
  const scam = plan.pageWarnings.some((w) => w.level === "blocked");
  if (scam) say("Careful. This page looks like a scam. I won't run anything from it.", "now");
  else say(`Looks like you want to ${lower(j.goal)}.${blocked ? " I'll skip a step that isn't safe." : ""} Ready when you are.`, "now");
}

// ---------- Mode 2: fix a problem ----------

async function fixFlow(guide: FixGuide, intro: string): Promise<void> {
  const checks: CheckLine[] = guide.checks.map((c, i) => ({ label: c.label, status: i === 0 ? "running" : "pending" }));
  const update = () => showBar({ phase: "checking", title: `Checking: ${guide.title.toLowerCase()}`, checks: [...checks] });
  update();
  say(intro || "Let me check a few things.", "now");
  buddyHome("scan");

  const before = await diagnose(guide, realCheckRunner, (id, r) => {
    const i = guide.checks.findIndex((c) => c.id === id);
    if (i >= 0) checks[i] = { label: r.label, status: r.status, detail: r.detail };
    if (i + 1 < checks.length && checks[i + 1].status === "pending") checks[i + 1] = { ...checks[i + 1], status: "running" };
    update();
  });
  const fixes = buildFixes(before);

  if (!before.problem || fixes.length === 0) {
    pendingLookup = guide.goal;
    const question = before.problem
      ? `${before.problem} I don't have a safe fix for that myself. Want me to look up the official help?`
      : "Everything I checked looks fine. Want me to look up the official help for this?";
    showBar({ phase: "ask", question, suggestions: ["Yes, look it up", "No thanks"], listening: false, transcribing: false });
    say(question, "now");
    buddyHome("think");
    focusBar();
    return;
  }

  const steps: Step[] = fixes.map((f, i): Step => {
    const id = String(i + 1);
    if (f.kind === "command") return { id, title: f.label, explanation: f.label, kind: "command", command: f.admin && !/^sudo\b/.test(f.command) ? "sudo " + f.command : f.command };
    if (f.kind === "recipe") return { id, title: f.label, explanation: "Add your printer again, without needing a driver.", kind: "manual", clickTarget: "Add Printer, Scanner or Fax…" };
    return { id, title: f.label, explanation: f.manual.explain, kind: "manual", clickTarget: f.manual.clickTarget, settingsUrl: f.manual.settingsUrl };
  });
  // The guide is our own code, so it is the "instructions" these commands come from.
  const source: InstructionSource = { kind: "file", text: steps.map((s) => s.command ?? s.title).join("\n"), location: `calhack://fix/${guide.id}`, app: "CalHack" };
  const plan = planSteps(steps, source);
  const j = newJob("fix", guide.goal, source, plan, "From CalHack's built-in fix guide");
  j.guide = guide;
  j.before = before;
  j.fixes = fixes;
  j.problem = before.problem;
  j.extraDetail = before.evidence.map((e) => ({ text: `Check: ${e.command} → exit ${e.code}`, mono: true }));
  job = j;
  showPlan(j);
  say(`Found it. ${before.problem} I can fix that. Want me to go ahead?`, "queue");
}

// ---------- Mode 3: find the official source (support article or app download) ----------

async function searchFlow(t: Extract<Triage, { kind: "search" }>): Promise<void> {
  showBar({ phase: "looking", message: t.installApp ? `Finding ${t.installApp}'s official website…` : "Looking for the official help page…" });
  say("I'm pulling up the website for you.", "now");
  const top = screenTopCenter();
  buddyTo(top.x, top.y, "scan");

  let src: OfficialSource | null = null;
  const extra: DetailLine[] = [];
  try {
    src = await findOfficialSource(t.goal, t.query, { installApp: t.installApp });
    extra.push({ text: "🤖 Droid searched the web (web tools only, it can't run anything):" }, ...src.log.map((l) => ({ text: l, mono: true })));
  } catch (error) {
    const log = (error as { log?: string[] }).log ?? [];
    extra.push({ text: `Droid search: ${(error as Error).message}` }, ...log.map((l) => ({ text: l, mono: true })));
  }

  // Installing an app.
  if (t.installApp) {
    const known = knownInstaller(t.installApp);
    const page = src && checkOfficial({ ...src, downloadUrl: undefined }).ok ? src : null;
    let url = page?.downloadUrl && checkOfficial(page).ok ? page.downloadUrl : null;
    const publisher = page?.publisher ?? known?.publisher ?? t.installApp;
    if (!url && known && checkOfficial({ url: known.url, downloadUrl: known.url, publisher: known.publisher, kind: "download" }).ok) url = known.url;

    if (!url) {
      showError(page ? `I opened ${publisher}'s official download page, but I couldn't find an installer link I trust. You can click Download there.` : `I couldn't find ${t.installApp}'s official website, so I stopped. I never download from other sites.`);
      return;
    }
    installOffer(known?.appName ?? t.installApp, publisher, url, page, extra);
    return;
  }

  // A support article: it becomes the instructions.
  if (!src) {
    showError("I couldn't find an official help page for that. Try saying it another way?");
    return;
  }
  const verdict = checkOfficial({ ...src, downloadUrl: undefined });
  if (!verdict.ok) {
    showError(`I found a page, but ${lower(verdict.reason)} So I stopped.`);
    return;
  }
  say(`Reading ${src.publisher}'s official help page.`, "queue");
  const text = await fetchPageText(src.url);
  const source: InstructionSource = { kind: "webpage", text, location: src.url, app: "CalHack" };
  await instructionsFlow(source, null, `From ${verdict.host} (${src.publisher}'s official site)`, extra, t.goal);
}

const INSTALL_STEPS = (appName: string, publisher: string, host: string) => [
  { id: "1", text: `Download ${appName} from ${host}, ${publisher}'s own website` },
  { id: "2", text: `Check the file really comes from ${publisher}` },
  { id: "3", text: `Install ${appName} (your Mac will ask for your password)` },
  { id: "4", text: `Open ${appName}` },
];

function installLines(j: Job, runningId?: string): StepLine[] {
  const i = j.install!;
  return INSTALL_STEPS(i.appName, i.publisher, new URL(i.url).hostname).map((s) => {
    const r = j.results.get(s.id);
    const status: StepLine["status"] = r ? (r.status === "done" ? "done" : r.status === "declined" ? "skipped" : "failed") : s.id === runningId ? "running" : "todo";
    return { id: s.id, text: s.text, status, note: r && r.status !== "done" ? r.message : undefined };
  });
}

function installOffer(appName: string, publisher: string, url: string, page: OfficialSource | null, extra: DetailLine[]): void {
  const host = new URL(url).hostname;
  const steps: Step[] = INSTALL_STEPS(appName, publisher, host).map((s) => ({ id: s.id, title: s.text, explanation: "", kind: "info" }));
  const source: InstructionSource = { kind: "webpage", text: url, location: page?.url ?? url, app: "CalHack" };
  const plan = planSteps(steps, source);
  const j = newJob("install", `Install ${appName}`, source, plan, `From ${page ? new URL(page.url).hostname : host} (${publisher}'s official site)`);
  j.install = { url, publisher, appName, page };
  j.extraDetail = [...extra, { text: `Installer: ${url}`, mono: true }];
  job = j;
  showBar({
    phase: "plan",
    goal: j.goal,
    steps: installLines(j),
    notes: [{ tone: "info", text: `I only install files signed by ${publisher}. Anything else, I stop.` }],
    okLabel: "Yes, install",
    cancelLabel: "Not now",
    source: j.sourceLabel,
  });
  buddyHome("wave");
  say(`Do you want to install ${appName} on your Mac?`, "queue");
  autoOk();
}

// ---------- Running ----------

/**
 * Droid runs the approved commands that change something. If Droid isn't set up or can't start,
 * CalHack runs the command itself, and the log says so.
 */
/** App installs that may ask for the Mac password partway through. Droid's shell can't show the password box. */
function needsPasswordBox(command: string): boolean {
  return /\bbrew\s+(install|reinstall|upgrade)\b[^;&|]*--cask\b|\binstaller\s+-pkg\b/.test(command);
}

const execute: Executor = async (command, timeoutMs) => {
  if (needsPasswordBox(command)) {
    const r = await runNormally(command, timeoutMs);
    return { ...r, ranBy: "calhack", log: ["CalHack ran this one itself, because installing an app can ask for your Mac password and only CalHack can show that box."] };
  }
  const problem = droidProblem();
  if (!problem) {
    try {
      return await runWithDroid(command, timeoutMs);
    } catch (error) {
      const r = await runNormally(command, timeoutMs);
      return { ...r, ranBy: "calhack", log: [`Droid couldn't start (${(error as Error).message}), so CalHack ran it.`] };
    }
  }
  return { ...(await runNormally(command, timeoutMs)), ranBy: "calhack", log: [`Droid is off (${problem}), so CalHack ran it.`] };
};

/** Where the buddy goes, and what it says, when a step starts. */
function stageStep(j: Job, p: PlannedStep): void {
  const s = p.step;
  showWorking(j, p);
  if (p.level === "blocked") {
    buddyHome("stop");
    return;
  }
  if (s.kind === "info") return;
  say(`Okay, ${lower(s.title)}.`, "queue");
  if (s.kind === "command" || (s.kind === "manual" && p.recipe && j.useRecipe.has(s.id))) {
    const l = barLine();
    buddyTo(l.x, l.y, "type");
  } else if (s.kind === "download") {
    const top = screenTopCenter();
    buddyTo(top.x, top.y, "carry");
  }
}

function runHooks(j: Job): RunHooks {
  return {
    approve: (planned, detail) =>
      new Promise((resolve) => {
        // The person already said OK to the plan. Only flagged steps ask again.
        if (planned.flags.length === 0 && !planned.needsReview) return resolve(true);
        approvals.set(planned.step.id, resolve);
        showBar({ phase: "needs-you", goal: j.goal, stepId: planned.step.id, kind: "approve", question: `${planned.step.title}: go ahead?`, why: planned.flags, command: detail, showMe: false });
        say("Quick question before I go on.", "now");
        buddyHome("think");
      }),
    waitForUser: (planned, note) =>
      new Promise((resolve) => {
        manualWaits.set(planned.step.id, resolve);
        const target = planned.step.clickTarget;
        showBar({
          phase: "needs-you",
          goal: j.goal,
          stepId: planned.step.id,
          kind: "manual",
          question: target ? `Your turn: click “${target}”.` : planned.step.title,
          why: [note, planned.step.explanation].filter((x): x is string => !!x && x !== planned.step.title),
          showMe: !!target,
        });
        say(target ? "This one's for you. I'll show you where to click." : `This one's for you: ${lower(planned.step.title)}.`, "queue");
        const link = safeSettingsUrl(planned.step.settingsUrl);
        if (link) void shell.openExternal(link);
        if (target) setTimeout(() => void showMe(planned.step.id), link ? 1500 : 200);
      }),
    progress: (planned, message) => showWorking(j, planned, message),
  };
}

async function runAll(): Promise<void> {
  if (!job || running) return;
  const j = job;
  if (j.mode === "install") return runInstall(j);
  running = true;
  stopRequested = false;
  j.receipt = null;
  j.recipesTried.clear();
  // "Try again" reruns what failed; everything that worked is kept.
  for (const [id, r] of j.results) if (["failed", "declined", "skipped"].includes(r.status)) j.results.delete(id);
  say(j.mode === "fix" ? "Okay, I'm fixing it now." : "Okay, I'm on it.", "now");
  const hooks = runHooks(j);
  try {
    await runSequence(j.plan.steps, j.results, {
      runOne: (p) => {
        stageStep(j, p);
        return runPlannedStep(p, hooks, {
          useUpdatedCommand: j.useUpdated.has(p.step.id),
          useRecipe: j.useRecipe.has(p.step.id),
          recipesTried: j.recipesTried,
          execute,
        });
      },
      onResult: (r) => {
        if (process.env.CALHACK_DEBUG) console.log(`[step] ${JSON.stringify(r)}`);
        showWorking(j);
      },
      stopped: () => stopRequested,
    });
    if (!stopRequested) await finish(j);
    else {
      showBar({ phase: "done", receipt: { verdict: "not-done", headline: "Stopped. Nothing else was changed.", beforeAfter: [], proofs: [], problems: [], reviewedBy: "rules" }, steps: jobSteps(j), detail: jobDetail(j), canRetry: true, canSendSummary: true });
      say("Okay, I stopped.", "now");
      buddyHome("idle");
    }
  } catch (error) {
    showError(friendlyError(error));
  } finally {
    running = false;
    approvals.clear();
    manualWaits.clear();
  }
}

/** Checks again, then the separate Claude review writes the receipt. */
async function finish(j: Job): Promise<void> {
  showBar({ phase: "looking", message: "Checking it worked…" });
  say("Let me check it worked.", "queue");
  buddyHome("scan");
  let final: Evidence[] = [];
  let goalMessage = j.parse?.finish?.message;

  if (j.mode === "fix" && j.guide && j.before) {
    const wait = Math.max(0, ...(j.fixes ?? []).map((f) => f.waitAfterMs));
    if (wait) await sleep(Math.min(wait, 15_000));
    const v = await verifyFix(j.guide, realCheckRunner, j.before);
    j.beforeAfter = v.rows;
    // Each check counts as passed only if it no longer finds a problem.
    final = v.after.results.filter((r) => r.command).map((r) => ({ kind: "final" as const, command: r.command!, code: r.status === "problem" ? 1 : 0, output: r.detail }));
    goalMessage = v.fixed ? `the problem is gone: ${v.rows.map((r) => `${r.label}: ${r.after}`).join(", ")}` : undefined;
    if (!v.fixed && v.stillWrong) j.extraDetail.push({ text: `Still wrong: ${v.stillWrong}` });
  } else if (j.parse?.finish) {
    const a = assessCommand(j.parse.finish.command);
    if (a.level === "safe" && a.readOnly) {
      const r = await runSandboxed(j.parse.finish.command).catch(() => null);
      if (r) final = [{ kind: "final", command: j.parse.finish.command, code: r.code, output: r.output.trim().split("\n").slice(-6).join("\n") }];
    }
  }

  const evidence = collectEvidence(j.plan.steps, j.results, final);
  j.receipt = await reviewRun({ goal: j.goal, goalMessage, steps: j.plan.steps, results: j.results, evidence });
  showDone(j);
}

function showDone(j: Job): void {
  const r = j.receipt!;
  showBar({
    phase: "done",
    receipt: receiptView(r, j.beforeAfter),
    steps: j.mode === "install" ? installLines(j) : jobSteps(j),
    detail: jobDetail(j),
    canRetry: r.verdict !== "done",
    canSendSummary: r.verdict !== "done",
  });
  if (r.verdict === "done") {
    say(`Looks like it's finished. ${r.headline.replace(/^(Done|Fixed)\.?\s*/i, "")}`, "now");
    buddyHome("celebrate");
  } else if (r.verdict === "couldnt-verify") {
    say("The steps ran, but I couldn't confirm it worked.", "now");
    buddyHome("think");
  } else {
    say("I couldn't finish this one. I can copy a note about what I tried, for someone who can help.", "now");
    buddyHome("sad");
  }
}

/** Installing from the official site: download → signature check → install → open, each as a step. */
async function runInstall(j: Job): Promise<void> {
  if (!j.install) return;
  running = true;
  stopRequested = false;
  const { url, publisher, appName } = j.install;
  const set = (id: string, r: Omit<StepResult, "id">) => j.results.set(id, { id, ...r });
  const line = (id: string, text: string) => showWorking(j, j.plan.steps.find((p) => p.step.id === id), text);
  try {
    j.results.clear();
    j.receipt = null;
    say(`Okay, I'm downloading ${appName} from ${publisher}'s official website.`, "now");
    const top = screenTopCenter();
    buddyTo(top.x, top.y, "carry");
    line("1", `Downloading ${appName}…`);
    const result = await installFromOfficial({ url, publisher, appName }, (stage, message) => {
      if (stage === "check") set("1", { status: "done", message: "Downloaded." });
      if (stage === "install") {
        set("2", { status: "done", message: `Signed by ${publisher}.` });
        say("Installing now. Your Mac will ask for your password.", "queue");
        const d = dockSpot();
        buddyTo(d.x, d.y - 10, "carry");
      }
      line(stage === "download" ? "1" : stage === "check" ? "2" : "3", message);
    });
    if (!result.ok) {
      const failedAt = j.results.has("2") ? "3" : j.results.has("1") ? "2" : "1";
      set(failedAt, { status: /cancelled/i.test(result.message) ? "declined" : "failed", message: result.message, evidence: result.evidence });
    } else {
      set("3", { status: "done", message: result.message, evidence: result.evidence });
      line("4", `Opening ${appName}…`);
      const appFile = basename(result.appPath ?? "", ".app") || appName;
      const opened = await runRecipe({ id: "open-app", label: `Open ${appName}`, app: appFile });
      set("4", { status: opened.ok ? "done" : "failed", message: opened.message, evidence: opened.evidence });
      if (opened.ok) j.beforeAfter = [{ label: appName, before: "Not installed", after: "Installed and open" }];
    }
    showBar({ phase: "looking", message: "Checking it worked…" });
    const steps = j.plan.steps;
    const evidence = collectEvidence(steps, j.results, null);
    j.receipt = await reviewRun({ goal: j.goal, goalMessage: `${appName} is installed and opens`, steps, results: j.results, evidence });
    showDone(j);
  } catch (error) {
    showError(friendlyError(error));
  } finally {
    running = false;
  }
}

// ---------- "Show me": the buddy points at what to click ----------

/**
 * Opens what the AI says would show the target. Only safe things: installed apps,
 * System Settings pages, and https pages from the same site as the instructions.
 */
async function openSafely(open: NonNullable<ScreenLocation["open_first"]>, j: Job): Promise<string | null> {
  if (open.kind === "settings") {
    const link = safeSettingsUrl(open.target);
    if (!link) return null;
    await shell.openExternal(link);
    return "System Settings";
  }
  if (open.kind === "app") {
    if (!/^[\w .&+'-]{1,60}$/.test(open.target)) return null;
    const dirs = ["/Applications", "/System/Applications", "/System/Applications/Utilities", join(homedir(), "Applications")];
    const path = dirs.map((d) => join(d, open.target + ".app")).find((p) => existsSync(p));
    if (!path) return null;
    if (await shell.openPath(path)) return null;
    return open.target;
  }
  try {
    const url = new URL(open.target);
    const pageHost = j.source.location ? new URL(j.source.location).hostname : null;
    const fromPage = j.source.text.includes(open.target);
    if (url.protocol !== "https:" || !(fromPage || (pageHost && url.hostname === pageHost))) return null;
    await shell.openExternal(url.toString());
    return url.hostname;
  } catch {
    return null;
  }
}

async function showMe(id: string): Promise<void> {
  const j = job;
  if (!j) return;
  const p = j.plan.steps.find((x) => x.step.id === id);
  if (!p?.step.clickTarget) return;
  const target = p.step.clickTarget;
  // Look, and if it isn't there, open what would show it and look again (twice at most).
  for (let attempt = 0; attempt < 3; attempt++) {
    buddyPose("scan");
    const shot = await captureScreen();
    if (!shot) {
      say("I can't see your screen yet. Please turn on Screen Recording for me.", "now");
      return;
    }
    try {
      const loc = await locateOnScreen({ screenshot: shot.data, mediaType: shot.mediaType, width: shot.width, height: shot.height, target, stepTitle: p.step.title });
      if (loc.found) {
        // The buddy layer covers the main display exactly, so screenshot pixels × toScreen = layer position.
        buddyPoint(Math.round(loc.x * shot.toScreen), Math.round(loc.y * shot.toScreen), target);
        say(`It's right here: ${target}.`, "now");
        return;
      }
      const opened = loc.open_first && attempt < 2 ? await openSafely(loc.open_first, j) : null;
      if (!opened) {
        say(loc.hint, "now");
        return;
      }
      await sleep(1800);
    } catch (error) {
      say(friendlyError(error), "now");
      return;
    }
  }
  say(`I couldn't find it. Look for “${target}”.`, "now");
}

// ---------- Voice in ----------

async function ensureMic(): Promise<boolean> {
  const s = systemPreferences.getMediaAccessStatus("microphone");
  if (s === "granted") return true;
  if (s === "not-determined") return systemPreferences.askForMediaAccess("microphone");
  return false;
}

function askState(patch: Partial<Extract<BarState, { phase: "ask" }>>): void {
  const cur = currentBar();
  const base = cur.phase === "ask" ? cur : { phase: "ask" as const, question: "Hi! What's going on?", suggestions: SUGGESTIONS, listening: false, transcribing: false };
  showBar({ ...base, ...patch });
}

// ---------- Copy guard ----------

const SAFE_NOTE = `# CalHack stopped a dangerous command from being pasted. Press ${KEY_LABEL} for details.`;
let lastClip = "";
let lastClipAt = 0;
let blockedClip: string | null = null;
let guardOn = true;

function recentClipboard(): string | null {
  return lastClip && lastClip !== SAFE_NOTE && Date.now() - lastClipAt < 3 * 60_000 ? lastClip : null;
}

const SHELL_HINT = /(\||\$\(|`|\b(curl|wget|sudo|bash|zsh|sh|base64|osascript|powershell|iex|chmod|xattr|spctl|csrutil|rm|security|eval|python3?|perl|mshta)\b)/;

function showWarning(data: { reasons: string[]; command: string }): void {
  if (!warning || warning.isDestroyed()) {
    const area = screen.getPrimaryDisplay().workArea;
    const width = 480;
    warning = new BrowserWindow({
      show: false,
      frame: false,
      resizable: false,
      transparent: true,
      backgroundColor: "#00000000",
      skipTaskbar: true,
      width,
      height: 340,
      x: Math.round(area.x + (area.width - width) / 2),
      y: area.y + 40,
      webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    warning.setContentProtection(true);
    warning.setAlwaysOnTop(true, "screen-saver");
    warning.webContents.on("will-navigate", (e) => e.preventDefault());
    warning.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    warning.loadFile(UI("warning.html"));
    warning.on("closed", () => (warning = null));
  }
  const w = warning;
  const go = () => {
    w.webContents.send("warning", data);
    w.show();
  };
  if (w.webContents.isLoading()) w.webContents.once("did-finish-load", go);
  else go();
  say("Stop! Don't paste that. It looks like a scam.", "now");
}

function watchClipboard(): void {
  let checking = false;
  void clipboard.readText().then((t) => (lastClip = t));
  setInterval(async () => {
    if (checking) return;
    checking = true;
    try {
      const text = await clipboard.readText();
      if (text === lastClip) return;
      lastClip = text;
      lastClipAt = Date.now();
      if (!guardOn || text === SAFE_NOTE || !text.trim() || text.length > 5000 || !SHELL_HINT.test(text)) return;
      const a = assessCommand(text);
      if (a.level !== "blocked") return;
      blockedClip = text;
      await clipboard.writeText(SAFE_NOTE);
      lastClip = SAFE_NOTE;
      showWarning({ reasons: a.findings.filter((f) => f.level === "blocked").map((f) => f.reason), command: text });
    } finally {
      checking = false;
    }
  }, 500);
}

// ---------- Messages from the windows ----------

ipcMain.handle("voice-synthesize", (event, text: string) => {
  if (event.sender !== ensureBar().webContents || event.senderFrame !== event.sender.mainFrame) throw new Error("Untrusted speech request");
  return synthesize(ROOT, text);
});
ipcMain.on("bar-ok", () => void runAll());
ipcMain.on("bar-retry", () => {
  if (job && !running) void runAll();
  else if (!job) void onHotkey();
});
ipcMain.on("bar-stop", () => {
  stopRequested = true;
  for (const [id, resolve] of approvals) {
    resolve(false);
    approvals.delete(id);
  }
});
ipcMain.on("bar-cancel", () => {
  if (running) return;
  job = null;
  showBar({ phase: "hidden" });
});
ipcMain.on("bar-answer", (_e, data: { text?: string }) => void onAnswer(String(data?.text ?? "").slice(0, 500)));
ipcMain.on("bar-approve", (_e, data: { stepId: string; yes: boolean }) => {
  approvals.get(data.stepId)?.(!!data.yes);
  approvals.delete(data.stepId);
});
ipcMain.on("bar-manual", (_e, data: { stepId: string; answer: "done" | "skip" }) => {
  manualWaits.get(data.stepId)?.(data.answer === "skip" ? "skip" : "done");
  manualWaits.delete(data.stepId);
  buddyHome("idle");
});
ipcMain.on("bar-show-me", (_e, data: { stepId: string }) => void showMe(data.stepId));
ipcMain.on("bar-send-summary", () => {
  if (!job) return;
  void clipboard.writeText(helpSummary(job.goal, job.problem, job.plan.steps, job.results, job.receipt));
  say("Copied. Paste it in a message to someone who can help.", "now");
});
ipcMain.on("bar-rect", (_e, rect: { x: number; y: number; width: number; height: number }) => {
  if (rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) setBarRect(rect);
});
ipcMain.on("bar-speaking", (_e, data: { speaking: boolean }) => toBuddy({ type: "talking", on: !!data?.speaking }));
ipcMain.on("bar-mic-start", async () => {
  const problem = voiceProblem();
  if (problem) {
    askState({ listening: false, heard: "Voice isn't set up yet, so please type it." });
    return;
  }
  if (!(await ensureMic())) {
    askState({ listening: false, heard: "I can't hear you yet: please allow the microphone in System Settings → Privacy & Security → Microphone. You can type instead." });
    return;
  }
  askState({ listening: true, transcribing: false, heard: undefined });
  buddyPose("talk");
});
ipcMain.on("bar-mic-cancel", () => askState({ listening: false, transcribing: false }));
ipcMain.on("bar-mic-audio", async (_e, data: { wav: ArrayBuffer }) => {
  askState({ listening: false, transcribing: true });
  try {
    const { text } = await transcribe(Buffer.from(data.wav));
    askState({ transcribing: false, heard: text || "Sorry, I didn't catch that." });
    if (text) await onAnswer(text);
  } catch (error) {
    askState({ transcribing: false, heard: (error as Error).message });
  }
});
ipcMain.on("warning-close", () => warning?.hide());
ipcMain.on("warning-restore", () => {
  if (blockedClip) {
    void clipboard.writeText(blockedClip);
    lastClip = blockedClip;
  }
  blockedClip = null;
  warning?.hide();
});

// ---------- Start ----------

function buildTrayMenu(): void {
  tray?.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Help me  (${KEY_LABEL})`, click: () => void onHotkey() },
      { label: "Ask CalHack something…", click: () => askWhat() },
      { type: "separator" },
      { label: "Warn me about dangerous copies", type: "checkbox", checked: guardOn, click: (item) => (guardOn = item.checked) },
      { type: "separator" },
      { label: "Quit CalHack", role: "quit" },
    ]),
  );
}

/** Our own pages may use the microphone (never the camera). Nothing else gets permissions. */
function setPermissions(): void {
  const ses = electronSession.defaultSession;
  const ours = (url?: string) => !!url && url.startsWith(UI_URL);
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    if (permission === "media" && ours(details.requestingUrl)) {
      const types = "mediaTypes" in details ? (details.mediaTypes ?? []) : [];
      return callback(types.length > 0 && types.every((t) => t === "audio"));
    }
    callback(false);
  });
  ses.setPermissionCheckHandler((wc, permission, _origin, details) => {
    if (permission === "media") return ours(details.requestingUrl ?? wc?.getURL()) && details.mediaType !== "video";
    return false;
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setName("CalHack");
  app.whenReady().then(() => {
    app.dock?.hide();
    setPermissions();
    tray = new Tray(nativeImage.createEmpty());
    tray.setTitle("🛡️ CalHack");
    tray.setToolTip(`CalHack: press ${KEY_LABEL} when you're stuck`);
    buildTrayMenu();
    if (globalShortcut.register(HOTKEY, () => void onHotkey())) {
      console.log(`CalHack shortcut: ${KEY_LABEL}`);
    } else {
      console.error(`Couldn't register ${KEY_LABEL}. Another app is using it. Set CALHACK_HOTKEY in .env to pick another.`);
    }
    watchClipboard();
    ensureBar();
    if (!hasApiKey()) console.error("No ANTHROPIC_API_KEY in .env yet.");
    if (!screenAllowed()) console.log("Screen Recording is off: CalHack can read web pages, documents and copied text, and you can type what's wrong.");
    console.log(`Ready. Press ${KEY_LABEL}.`);
    // Testing only: CALHACK_AUTORUN=hotkey, or CALHACK_AUTORUN="ask:my printer won't print".
    const auto = process.env.CALHACK_AUTORUN;
    if (auto) {
      setTimeout(() => {
        if (auto === "hotkey") void onHotkey();
        else if (auto.startsWith("ask:")) {
          askWhat();
          setTimeout(() => void onAnswer(auto.slice(4)), 2500);
        }
      }, 2500);
    }
  });
  app.on("will-quit", () => { globalShortcut.unregisterAll(); stopVoiceOut(); });
  app.on("window-all-closed", () => {
    // Stay in the menu bar.
  });
}
