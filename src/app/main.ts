// CalHack desktop app. Press ⌃⌥⌘D and CalHack looks at your screen, then:
//  - follows the how-to you're reading (forum post, support page, PDF), or
//  - fixes the problem you have ("my printer won't print"): read-only checks → OK → fix → same checks again, or
//  - asks "Hi! What's going on?", and finds the official source (Apple support, the app maker's site) when it has no guide.
// The helper bar (bottom-center) shows each moment, and a voice says what's happening.
// Code decides what's safe. Droid (Factory) runs the approved commands. A separate Claude call writes the receipt.
import { app, BrowserWindow, clipboard, desktopCapturer, globalShortcut, ipcMain, Menu, nativeImage, screen, session as electronSession, shell, systemPreferences, Tray } from "electron";
import { AsyncLocalStorage } from "node:async_hooks";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { findAppBundles, uninstallApp, uninstallRequest } from "../core/uninstall.js";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describeEnvironment, probeEnvironment, type Environment } from "../core/probe.js";
import { applyAiConcerns, planSteps, type Plan } from "../core/plan.js";
import { check, recheckPlannedStep, runPlannedStep, type Executor, type RunHooks } from "../core/runner.js";
import { runNormally, runSandboxed } from "../core/exec.js";
import { runSequence } from "../core/sequence.js";
import { collectEvidence, type Receipt } from "../core/receipt.js";
import { assessCommand } from "../core/risk.js";
import { scanForScamSigns } from "../core/source.js";
import { realRecipeDeps, recipeNormal, runRecipe, type RecipeOutcome } from "../core/recipes.js";
import { summarizeGoal, verifiedStep, verifyGoal, verifyInstalledApp } from "../core/verification.js";
import { installFromOfficial, knownInstaller, realInstallDeps, type InstallResult } from "../core/install.js";
import { checkOfficial } from "../core/official.js";
import { buildFixes, diagnose, getGuide, guideMenu, realCheckRunner, verifyFix, type BuiltFix, type Diagnosis, type FixGuide } from "../core/fixes/index.js";
import type { Evidence, GoalVerification, InstructionSource, PlannedStep, Step, StepResult } from "../core/types.js";
import { reviewRun } from "../ai/review.js";
import { runAgent } from "../agent/agent.js";
import { realMac } from "../agent/mac.js";
import { autopilot } from "../agent/autopilot.js";
import { offlineGuide } from "../agent/offline.js";
import { TOOLS as AGENT_TOOLS, type AgentUI, type ToolContext } from "../agent/tools.js";
import { triage, type Triage } from "../ai/triage.js";
import { friendlyError, hasApiKey, loadEnv } from "../ai/client.js";
import { parseInstructions, type ParseResult } from "../ai/parse.js";
import { droidProblem, runWithDroid } from "../droid/executor.js";
import { findOfficialSource, type OfficialSource } from "../droid/research.js";
import { fetchPageText } from "../mac/text.js";
import { frontAppName } from "../mac/front.js";
import { describeSource, gatherInstructions } from "./gather.js";
import { QUIET, transcribe, voiceProblem, wavLoudness } from "./voice-in.js";
import { synthesize, stopVoiceOut } from "./voice-out.js";
import type { BarState, CheckLine, DetailLine, StepLine } from "./protocol.js";
import { detailLines, helpSummary, planNotes, receiptView, stepLines } from "./view.js";
import { currentBar, ensureBar, focusBar as focusBarNow, hidePointer, pointAt, say as sayNow, setBarRect, showBar as showBarNow } from "./windows.js";

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
  recipesTried: Map<string, RecipeOutcome & { stepId: string }>;
  installedAppPath?: string;
  installationResult?: InstallResult;
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
/** Aborted the moment the person presses Stop: Claude requests in flight are cancelled and screen loops end. */
let stopController = new AbortController();
/** A fresh stop signal for a new piece of work. */
function freshStop(): AbortSignal {
  stopController = new AbortController();
  return stopController.signal;
}
let envCache: { env: Environment; at: number } | null = null;
let lastExternalApp: string | null = null;
/** The last screenshot and screen text, so an answer can be read together with what was on screen. */
let lastLook: { shot: Shot | null; screenText: string } = { shot: null, screenText: "" };
/** After a guide finds nothing wrong, "Yes, look it up" searches the official help for this goal. */
let pendingLookup: string | null = null;

const approvals = new Map<string, (yes: boolean) => void>();
const manualWaits = new Map<string, (answer: "done" | "skip") => void>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- Flows ----------
// Each piece of work the person starts (the hotkey, a request, OK) runs as one flow. Cancel/✕ ends it: its loops
// stop at the next check, and anything it still tries to show or say is dropped, so the bar stays closed.

const flowStore = new AsyncLocalStorage<number>();
let currentFlow = 0;

function startFlow(run: () => Promise<void>): Promise<void> {
  return flowStore.run(++currentFlow, run);
}

/** False once this flow was cancelled. Code outside any flow (the tray, the copy guard) is always live. */
function live(): boolean {
  const id = flowStore.getStore();
  return id === undefined || id === currentFlow;
}

function showBar(state: BarState): void {
  if (live()) showBarNow(state);
}

function say(text: string, mode?: Parameters<typeof sayNow>[1]): void {
  if (live()) sayNow(text, mode);
}

function focusBar(): void {
  if (live()) focusBarNow();
}

/**
 * Stop: ends the work at once. The request to Claude in flight is cancelled, screen loops end, and anything the old
 * flow still tries to show or say is dropped, so a late answer never runs. The bar shows "Stopped" right away, with
 * what was done so far. (A command already running, like an install, isn't killed halfway, but nothing runs after it.)
 */
function stopNow(): void {
  const before = currentBar();
  // What was going on, before the flags below are reset.
  const agentTask = agentRunning ? agentNow : null;
  currentFlow++;
  stopRequested = true;
  stopController.abort();
  hidePointer();
  releaseWaits();
  busy = false;
  running = false;
  agentRunning = false;
  pendingLookup = null;
  agentNow = null;
  if (before.phase === "hidden") return;
  // The step list: from the agent's task, the step-by-step job, or whatever the bar showed.
  const hasSteps = before.phase === "working" || before.phase === "plan" || before.phase === "done";
  const shown: StepLine[] = agentTask ? agentTask.steps : job ? jobSteps(job) : hasSteps ? before.steps : [];
  const steps = shown.map((st): StepLine => (["running", "todo", "waiting"].includes(st.status) ? { ...st, status: "skipped", note: "Stopped" } : st));
  const detail = agentTask ? agentTask.detail : before.phase === "working" || before.phase === "done" ? before.detail : [];
  if (agentTask) {
    resumeAgent = {
      request: agentTask.request,
      goal: agentTask.goal,
      done: agentTask.steps.filter((st) => st.status === "done").map((st) => st.text),
      approvedPlan: agentTask.ctx?.approvedPlan,
    };
  }
  const canContinue = !!resumeAgent || !!job;
  showBarNow({
    phase: "done",
    receipt: {
      verdict: "not-done",
      headline: "Stopped here. I left everything on your screen as it is.",
      lines: canContinue ? ["Press Continue and I'll pick up where I stopped."] : [],
      beforeAfter: [],
      proofs: [],
      problems: [],
      reviewedBy: "rules",
    },
    steps,
    detail: [...detail],
    canRetry: false,
    canSendSummary: false,
    canContinue,
  });
  sayNow("Okay, I stopped.", "now");
}

/** Ends the current flow and closes the bar, whatever it was doing. */
function cancelFlow(): void {
  currentFlow++;
  resumeAgent = null;
  agentNow = null;
  stopRequested = true;
  stopController.abort();
  hidePointer();
  releaseWaits();
  job = null;
  pendingLookup = null;
  busy = false;
  running = false;
  agentRunning = false;
  showBarNow({ phase: "hidden" });
}

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
}

function askWhat(question = "Hi! What's going on?", suggestions = SUGGESTIONS): void {
  showBar({ phase: "ask", question, suggestions, listening: false, transcribing: false });
  say(question, "now");
  focusBar();
}

// ---------- The hotkey ----------

async function onHotkey(): Promise<void> {
  // Something new: a stopped task can no longer be continued.
  if (!agentRunning) resumeAgent = null;
  if (busy || running) {
    ensureBar().showInactive();
    return;
  }
  await startFlow(lookAndHelp);
}

async function lookAndHelp(): Promise<void> {
  busy = true;
  job = null;
  pendingLookup = null;
  try {
    let appName = await frontAppName();
    if (appName && OWN_APP_NAMES.has(appName)) appName = lastExternalApp;
    if (appName) lastExternalApp = appName;

    showBar({ phase: "looking", message: "Let me take a look…" });
    say("Let me take a look.", "now");

    if (!hasApiKey()) {
      showError("I need a Claude API key first. Put ANTHROPIC_API_KEY in the .env file, then restart me.");
      return;
    }
    const shot = screenAllowed() ? await captureScreen() : null;
    const source = await gatherInstructions({ app: appName, recentClipboard: recentClipboard() });
    if (!live()) return;
    lastLook = { shot, screenText: source.text.slice(0, 6000) };

    // Our own scam check comes first: a fake "verify you're human" page gets the warning, whatever the AI thinks.
    if (source.text.trim() && scanForScamSigns(source.text).some((w) => w.level === "blocked")) {
      await instructionsFlow(source, shot);
      return;
    }

    // A how-to page on screen is followed as written (with its plan and OK). Anything else goes to the agent,
    // which reads the screen (an error message, say) and helps, or asks what's going on.
    const pageWithSteps = source.kind !== "screenshot" && source.text.trim().length > 200 && /\b(step|install|click|open|run|terminal|download|settings)\b/i.test(source.text);
    if (pageWithSteps) await instructionsFlow(source, shot);
    else {
      busy = false;
      await agentFlow("", lastLook);
    }
  } catch (error) {
    showError(friendlyError(error));
  } finally {
    if (live()) busy = false;
  }
}

/** Something the person typed or said, read together with what was on screen. */
async function onAnswer(text: string): Promise<void> {
  const clean = text.trim();
  if (!clean) return;
  // The agent asked something: this is the answer.
  if (agentAsk) {
    agentAsk(clean);
    return;
  }
  // The agent is working: pass it along as a follow-up.
  if (agentRunning) {
    agentInbox.push(clean);
    say("Got it.", "now");
    return;
  }
  if (busy || running) return;
  if (/^(no|no thanks|nope|not now|cancel)\b/i.test(clean)) {
    showBar({ phase: "hidden" });
    return;
  }
  // Typed on the "Stopped" screen: carry on with the stopped task, with what they added.
  const resume = resumeAgent ? { ...resumeAgent, note: clean } : undefined;
  await startFlow(async () => {
    try {
      await agentFlow(resume ? resume.request : clean, lastLook, resume);
    } catch (error) {
      showError(friendlyError(error));
    }
  });
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
  } finally { if (live()) running = false; }
}

// ---------- The agent: understand → look → act → check → finish ----------

/** Waiting on the person while the agent runs. */
let agentAsk: ((answer: string) => void) | null = null;
let agentConfirm: { resolve: (yes: boolean) => void; typeToConfirm?: string } | null = null;
let agentExplain: (() => void) | null = null;
let agentGuide: ((answer: "done" | "skip") => void) | null = null;
let agentRunning = false;
/** Follow-ups typed while the agent works. */
const agentInbox: string[] = [];
/** The last exchange, so a follow-up question has context. */
let lastExchange: { request: string; headline: string; details: string[] } | null = null;
/** The agent task in progress, so Stop can show what was done and Continue can pick it up. */
let agentNow: { request: string; goal: string; steps: StepLine[]; detail: DetailLine[]; ctx: ToolContext | null } | null = null;
/** A task the person stopped. "Continue" resumes it; anything new clears it. */
interface AgentResume { request: string; goal: string; done: string[]; approvedPlan?: string[]; note?: string }
let resumeAgent: AgentResume | null = null;

/** Testing only: CALHACK_AUTO_ANSWERS="Yes|No|Never mind" answers the agent's questions and confirmations in order. */
const autoAnswers = (process.env.CALHACK_AUTO_ANSWERS ?? "").split("|").map((x) => x.trim()).filter(Boolean);
function autoAnswer(apply: (a: string) => void): void {
  const a = autoAnswers.shift();
  if (a !== undefined) setTimeout(() => apply(a), 1500);
}

/** Answers everything waiting on the person with "no" / "skip", so a stopped run can unwind. */
function releaseWaits(): void {
  settleAgentWaits();
  for (const resolve of approvals.values()) resolve(false);
  for (const resolve of manualWaits.values()) resolve("skip");
  approvals.clear();
  manualWaits.clear();
}

function settleAgentWaits(): void {
  agentAsk?.("Stop");
  agentConfirm?.resolve(false);
  agentExplain?.();
  agentGuide?.("skip");
  agentAsk = null;
  agentConfirm = null;
  agentExplain = null;
  agentGuide = null;
}

function capitalize(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

async function agentFlow(request: string, look: { shot: Shot | null; screenText: string } = { shot: null, screenText: "" }, resume?: AgentResume): Promise<void> {
  job = null;
  resumeAgent = null;
  agentRunning = true;
  running = true;
  stopRequested = false;
  const signal = freshStop();
  agentInbox.length = 0;
  // Continuing: the steps done before Stop stay on the list.
  const steps: StepLine[] = (resume?.done ?? []).map((text, i) => ({ id: String(i + 1), text, status: "done" }));
  const detail: DetailLine[] = [];
  const goal = resume?.goal ?? (request ? capitalize(request.length > 70 ? request.slice(0, 67) + "…" : request) : "Helping you");
  agentNow = { request, goal, steps, detail, ctx: null };
  let line = "Let me look…";
  const work = () =>
    showBar({ phase: "working", goal, current: Math.max(1, steps.length), total: Math.max(1, steps.length), openEnded: true, line, steps: [...steps], detail: [...detail] });
  const finishStep = () => {
    for (const st of steps) if (st.status === "running") st.status = "done";
  };

  const ui: AgentUI = {
    status: (l) => {
      line = l;
      work();
    },
    say: (t) => say(t, "queue"),
    detail: (text, mono) => detail.push({ text, mono }),
    ask: (question, choices, note) =>
      new Promise((resolve) => {
        agentAsk = (a) => {
          agentAsk = null;
          resolve(a);
          work();
        };
        showBar({ phase: "ask", question, note, suggestions: choices, listening: false, transcribing: false });
        say(question, "now");
        focusBar();
        autoAnswer((a) => agentAsk?.(a === "1" ? (choices[0] ?? a) : a));
      }),
    confirm: (c) =>
      new Promise((resolve) => {
        agentConfirm = {
          typeToConfirm: c.typeToConfirm,
          resolve: (yes) => {
            agentConfirm = null;
            resolve(yes);
            work();
          },
        };
        showBar({ phase: "confirm", title: c.title, message: c.message, details: c.details, yes: c.yes, no: c.no, typeToConfirm: c.typeToConfirm, tone: c.tone });
        say(c.title, "now");
        if (c.typeToConfirm) focusBar();
        autoAnswer((a) => agentConfirm?.resolve(/^y/i.test(a)));
      }),
    explain: (e) =>
      new Promise((resolve) => {
        agentExplain = () => {
          agentExplain = null;
          resolve();
          work();
        };
        showBar({ phase: "explain", title: e.title, paragraphs: e.paragraphs, steps: e.steps });
        say(e.title, "now");
        focusBar();
        autoAnswer(() => agentExplain?.());
      }),
    guide: (g) =>
      new Promise((resolve) => {
        agentGuide = (a) => {
          agentGuide = null;
          hidePointer();
          resolve(a);
          work();
        };
        if (g.point && live()) pointAt(g.point.x, g.point.y, g.point.label);
        const link = safeSettingsUrl(g.settingsUrl);
        if (link) void shell.openExternal(link);
        const why = [g.point ? "I've circled it on your screen." : "macOS only lets you do this part yourself.", g.clickTarget ? `Look for “${g.clickTarget}”.` : ""].filter(Boolean);
        showBar({ phase: "needs-you", goal, stepId: "agent", kind: "manual", question: g.instruction, why });
        say(g.instruction, "now");
      }),
  };

  work();
  const toolLabel = (name: string, input: Record<string, unknown>) => AGENT_TOOLS.find((t) => t.name === name)?.label(input) ?? "Working…";
  try {
    const env = await getEnvironment();
    const context = resume
      ? [
          `They asked: "${resume.request || "help with what's on their screen"}". You were working on it when they pressed Stop, and now they pressed Continue.`,
          resume.done.length ? `Already done before Stop: ${resume.done.join("; ")}.` : "Nothing was finished before Stop.",
          resume.approvedPlan?.length ? `They already said yes to this plan, so don't ask again: ${resume.approvedPlan.join("; ")}.` : "",
          resume.note ? `They added just now: "${resume.note}". Take that into account.` : "",
          "Look again first: things may have changed, and they may have done some parts themselves. Then carry on from where you stopped. Don't redo what's already done.",
        ].filter(Boolean).join("\n")
      : lastExchange && request ? `Earlier in this conversation they asked "${lastExchange.request}" and you replied: ${lastExchange.headline} ${lastExchange.details.join(" ")}\n\nNow they say: ${request}` : request;
    // While developing, CalHack runs inside the editor or terminal that started it, so closing that would close CalHack.
    const devHosts = app.isPackaged ? [] : ["Visual Studio Code", "Code", "Terminal", "iTerm", "iTerm2", "Cursor", "Warp"];
    const mac = realMac({ execute, trash: (p) => shell.trashItem(p), protectedApps: devHosts, screen: screenAllowed() ? { capture: captureScreen } : undefined });
    const result = await runAgent(
      { request: context, screenText: look.screenText, screenshot: look.shot ? { data: look.shot.data, mediaType: look.shot.mediaType } : undefined, environment: describeEnvironment(env) },
      ui,
      mac,
      {
        inbox: agentInbox,
        signal,
        approvedPlan: resume?.approvedPlan,
        onContext: (c) => {
          if (agentNow) agentNow.ctx = c;
        },
        stopped: () => stopRequested || !live(),
        onTool: (name, input) => {
          finishStep();
          if (["ask_person", "explain_irreversible"].includes(name)) return;
          steps.push({ id: String(steps.length + 1), text: toolLabel(name, input).replace(/…$/, ""), status: "running" });
          line = toolLabel(name, input);
          work();
        },
      },
    );
    finishStep();
    lastExchange = { request: request || "(pressed the help key)", headline: result.headline, details: result.details };
    if (live()) agentNow = null;
    const verdict = result.verdict === "done" ? "done" : result.verdict === "answered" ? "answered" : result.verdict === "cant_do" ? "cant-do" : "not-done";
    const proofs = result.proofs.map((p) => ({ claim: capitalize(p.shows || p.evidence.output.split("\n")[0].slice(0, 90) || "Check passed"), checks: [p.evidence.command] }));
    showBar({
      phase: "done",
      receipt: { verdict, headline: result.headline, lines: result.details, beforeAfter: result.beforeAfter, proofs, problems: [], reviewedBy: "agent" },
      steps,
      detail: [...detail, ...result.toolCalls.map((t) => ({ text: `${t.name} (${t.ms} ms): ${t.result.slice(0, 200)}`, mono: true }))],
      canRetry: false,
      canSendSummary: verdict === "not-done",
    });
    say(result.headline, "now");
    summaryText = [`CalHack summary: ${request || "Help"}`, `Result: ${result.headline}`, ...result.details, "What I did:", ...result.toolCalls.map((t) => `- ${t.name}: ${t.result.split("\n")[0].slice(0, 160)}`)].join("\n");
  } catch (error) {
    if (!live()) return;
    settleAgentWaits();
    agentRunning = false;
    running = false;
    // No internet (or Claude unreachable): the built-in fix guides still work, because they run on the Mac.
    const guide = offlineGuide(request);
    if (guide && isConnectionError(error)) {
      say("I can't reach the internet, but I can still check this on your Mac.", "now");
      await fixFlow(guide, "Let me check a few things on your Mac.");
      return;
    }
    showError(isConnectionError(error) && !request ? "I can't reach the internet right now. Tell me what's wrong: I can still check your printer, sound and Wi-Fi without it." : friendlyError(error));
  } finally {
    if (live()) {
      settleAgentWaits();
      agentRunning = false;
      running = false;
    }
  }
}

function isConnectionError(error: unknown): boolean {
  const e = error as { name?: string; message?: string; constructor?: { name?: string } };
  return /APIConnection|fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network/i.test(`${e?.constructor?.name ?? ""} ${e?.name ?? ""} ${e?.message ?? ""}`);
}



/** What "Send this to my son / IT" copies after an agent run. */
let summaryText: string | null = null;

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
  if (!live()) return;
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
  if (!live()) return;
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

  const before = await diagnose(guide, realCheckRunner, (id, r) => {
    const i = guide.checks.findIndex((c) => c.id === id);
    if (i >= 0) checks[i] = { label: r.label, status: r.status, detail: r.detail };
    if (i + 1 < checks.length && checks[i + 1].status === "pending") checks[i + 1] = { ...checks[i + 1], status: "running" };
    update();
  });
  if (!live()) return;
  const fixes = buildFixes(before);

  if (!before.problem || fixes.length === 0) {
    pendingLookup = guide.goal;
    const question = before.problem
      ? `${before.problem} I don't have a safe fix for that myself. Want me to look up the official help?`
      : "Everything I checked looks fine. Want me to look up the official help for this?";
    showBar({ phase: "ask", question, suggestions: ["Yes, look it up", "No thanks"], listening: false, transcribing: false });
    say(question, "now");
    focusBar();
    return;
  }

  const steps: Step[] = fixes.map((f, i): Step => {
    const id = String(i + 1);
    if (f.kind === "command") return { id, title: f.label, explanation: f.label, kind: "command", command: f.admin && !/^sudo\b/.test(f.command) ? "sudo " + f.command : f.command };
    if (f.kind === "recipe" && f.manual) return { id, title: f.label, explanation: f.manual.explain, kind: "manual", clickTarget: f.manual.clickTarget, settingsUrl: f.manual.settingsUrl };
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

  let src: OfficialSource | null = null;
  const extra: DetailLine[] = [];
  try {
    src = await findOfficialSource(t.goal, t.query, { installApp: t.installApp });
    if (!live()) return;
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
  if (!live()) return;
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
    const status: StepLine["status"] = r ? (["done", "already-done", "done-unverified"].includes(r.status) ? verifiedStep(r) ? "done" : "unverified" : r.status === "declined" ? "skipped" : "failed") : s.id === runningId ? "running" : "todo";
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

/** What the bar shows, and what it says, when a step starts. */
function stageStep(j: Job, p: PlannedStep): void {
  const s = p.step;
  showWorking(j, p);
  if (p.level === "blocked" || s.kind === "info") return;
  say(`Okay, ${lower(s.title)}.`, "queue");
}

function runHooks(j: Job): RunHooks {
  return {
    approve: (planned, detail) =>
      new Promise((resolve) => {
        // The person already said OK to the plan. Only flagged steps ask again.
        if (planned.flags.length === 0 && !planned.needsReview) return resolve(true);
        approvals.set(planned.step.id, resolve);
        showBar({ phase: "needs-you", goal: j.goal, stepId: planned.step.id, kind: "approve", question: `${planned.step.title}: go ahead?`, why: planned.flags, command: detail });
        say("Quick question before I go on.", "now");
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
        });
        say(target ? `This one's for you: click “${target}”.` : `This one's for you: ${lower(planned.step.title)}.`, "queue");
        const link = safeSettingsUrl(planned.step.settingsUrl);
        if (link) void shell.openExternal(link);
      }),
    tryOnScreen: async (planned) => {
      const evidence: Evidence[] = [];
      if (!screenAllowed()) return { handled: false, evidence, note: "I can't see your screen, so it's yours." };
      const s = planned.step;
      const instruction = [s.title, s.explanation, s.clickTarget ? `Click “${s.clickTarget}”.` : ""].filter(Boolean).join(" ");
      const mac = realMac({ execute, trash: (p) => shell.trashItem(p), screen: { capture: captureScreen } });
      const link = safeSettingsUrl(s.settingsUrl);
      if (link) {
        await mac.run(`open '${link}'`);
        await new Promise((r) => setTimeout(r, 1500));
      }
      const ui = {
        status: (line: string) => showWorking(j, planned, line),
        say: (text: string) => say(text, "queue"),
        detail: () => {},
        // A private moment in the middle: the person does just that part, then it carries on.
        guide: (g: { instruction: string; point?: { x: number; y: number; label: string } }) =>
          new Promise<"done" | "skip">((resolve0) => {
            // Show that the answer was heard right away; the next look at the screen takes a few seconds.
            const resolve = (a: "done" | "skip") => {
              hidePointer();
              showWorking(j, planned, a === "done" ? "Thanks, carrying on…" : "Okay, skipping that…");
              resolve0(a);
            };
            manualWaits.set(s.id, resolve);
            if (g.point && live()) pointAt(g.point.x, g.point.y, g.point.label);
            showBar({ phase: "needs-you", goal: j.goal, stepId: s.id, kind: "manual", question: g.instruction, why: [g.point ? "This part needs you. I've circled it on your screen." : "This part needs you."] });
            say(g.instruction, "now");
          }),
      } as unknown as AgentUI;
      const r = await autopilot({ mac, ui, evidence, diagnoses: new Map(), beforeAfter: [], signal: stopController.signal }, { instruction, clickTarget: s.clickTarget });
      if (r.outcome === "done") return { handled: "done", evidence };
      if (r.outcome === "skipped" || r.outcome === "stopped") return { handled: "skip", evidence };
      return { handled: false, evidence, note: r.needsAccessibility ? `${r.trail.at(-1)}.` : r.trail.length ? `I tried and couldn't finish: ${r.trail.at(-1)}.` : undefined };
    },
    progress: (planned, message) => showWorking(j, planned, message),
  };
}

async function runAll(): Promise<void> {
  if (!job || running) return;
  const j = job;
  if (j.mode === "install") return runInstall(j);
  running = true;
  stopRequested = false;
  freshStop();
  j.receipt = null;
  for (const [key, outcome] of j.recipesTried) if (!outcome.ok) j.recipesTried.delete(key);
  // runSequence retains completed actions and refreshes their read-only checks first.
  say(j.mode === "fix" ? "Okay, I'm fixing it now." : "Okay, I'm on it.", "now");
  const hooks = runHooks(j);
  try {
    await runSequence(j.plan.steps, j.results, {
      recheck: (p, previous) => recheckPlannedStep(p, previous, { recipesTried: j.recipesTried }),
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
      stopped: () => stopRequested || !live(),
    });
    if (!stopRequested && live()) await finish(j);
    else {
      showBar({ phase: "done", receipt: { verdict: "not-done", headline: "Stopped. Nothing else was changed.", beforeAfter: [], proofs: [], problems: [], reviewedBy: "rules" }, steps: jobSteps(j), detail: jobDetail(j), canRetry: true, canSendSummary: true });
      say("Okay, I stopped.", "now");
    }
  } catch (error) {
    showError(friendlyError(error));
  } finally {
    if (live()) {
      running = false;
      approvals.clear();
      manualWaits.clear();
    }
  }
}

/** Checks again, then the separate Claude review writes the receipt. */
async function finish(j: Job): Promise<void> {
  showBar({ phase: "looking", message: "Checking it worked…" });
  say("Let me check it worked.", "queue");
  let verification: GoalVerification = summarizeGoal([], "No usable final goal check was supplied.");
  let goalMessage = j.parse?.finish?.message;

  if (j.mode === "fix" && j.guide && j.before) {
    const wait = Math.max(0, ...(j.fixes ?? []).map((f) => f.waitAfterMs));
    if (wait) await sleep(Math.min(wait, 15_000));
    const v = await verifyFix(j.guide, realCheckRunner, j.before);
    j.beforeAfter = v.rows;
    verification = v.goal;
    goalMessage = v.fixed ? `the problem is gone: ${v.rows.map((r) => `${r.label}: ${r.after}`).join(", ")}` : undefined;
    if (!v.fixed && v.stillWrong) j.extraDetail.push({ text: `Still wrong: ${v.stillWrong}` });
  } else verification = await verifyGoal(j.parse?.finish?.command);

  if (!live()) return;
  const evidence = collectEvidence(j.plan.steps, j.results, verification);
  j.receipt = await reviewRun({ goal: j.goal, goalMessage, steps: j.plan.steps, results: j.results, evidence, verification });
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
  } else if (r.verdict === "couldnt-verify") {
    say("The steps ran, but I couldn't confirm it worked.", "now");
  } else {
    say("I couldn't finish this one. I can copy a note about what I tried, for someone who can help.", "now");
  }
}

/** Installing from the official site: download → signature check → install → open, each as a step. */
async function runInstall(j: Job): Promise<void> {
  if (!j.install) return;
  running = true;
  stopRequested = false;
  const signal = freshStop();
  const { url, publisher, appName } = j.install;
  const set = (id: string, r: Omit<StepResult, "id">) => j.results.set(id, { id, ...r });
  const line = (id: string, text: string) => showWorking(j, j.plan.steps.find((p) => p.step.id === id), text);
  try {
    j.receipt = null;
    if (!j.installedAppPath || j.installationResult && !j.installationResult.ok) {
      if (!j.installationResult?.actionCompleted) j.results.clear();
      say(j.installationResult?.actionCompleted ? `Checking ${appName} again.` : `Okay, I'm downloading ${appName} from ${publisher}'s official website.`, "now");
      line(j.installationResult?.actionCompleted ? "3" : "1", j.installationResult?.actionCompleted ? `Checking ${appName}…` : `Downloading ${appName}…`);
      const result = await installFromOfficial({ url, publisher, appName }, (stage, message) => {
        // Stop pressed during the download: never go on to install.
        if (signal.aborted) throw new Error("Stopped.");
        if (stage === "check") set("1", { status: "done-unverified", actionCompleted: true, message: "Download finished." });
        if (stage === "install") {
          set("2", { status: "done-unverified", actionCompleted: true, message: `Signed by ${publisher}.` });
          say("Installing now. Your Mac will ask for your password.", "queue");
        }
        line(stage === "download" ? "1" : stage === "check" ? "2" : "3", message);
      }, realInstallDeps, j.installationResult);
      j.installationResult = result;
      j.installedAppPath = result.appPath;
      if (!result.ok) {
        const failedAt = j.results.has("2") ? "3" : j.results.has("1") ? "2" : "1";
        set(failedAt, { status: /cancelled/i.test(result.message) ? "declined" : "failed", actionCompleted: result.actionCompleted, message: result.message, evidence: result.evidence });
      } else {
        const installed: StepResult = { id: "3", status: "done", actionCompleted: true, message: result.message, evidence: result.evidence };
        if (!verifiedStep(installed)) installed.status = "done-unverified";
        set("3", installed);
      }
    } else {
      const p = j.plan.steps.find((p) => p.step.id === "3");
      if (p && j.results.has("3")) j.results.set("3", await recheckPlannedStep(p, j.results.get("3")!));
    }
    if (j.installedAppPath && j.installationResult?.ok && j.results.get("3")?.status === "done" && !stopRequested) {
      if (!j.results.get("4")?.actionCompleted) {
        line("4", `Opening ${appName}…`);
        const appFile = basename(j.installedAppPath, ".app") || appName;
        const opened = await runRecipe({ id: "open-app", label: `Open ${appName}`, app: appFile }, { ...realRecipeDeps, normal: recipeNormal(execute) });
        const opening: StepResult = { id: "4", status: opened.ok ? "done" : "failed", actionCompleted: opened.ok, message: opened.message, evidence: opened.evidence };
        if (opened.ok && !verifiedStep(opening)) opening.status = "done-unverified";
        set("4", opening);
      } else {
        const p = j.plan.steps.find((p) => p.step.id === "4");
        if (p) j.results.set("4", await recheckPlannedStep(p, j.results.get("4")!));
      }
    }
    showBar({ phase: "looking", message: "Checking it worked…" });
    const steps = j.plan.steps;
    const verification = j.installedAppPath ? await verifyInstalledApp(j.installedAppPath) : summarizeGoal([], "Installation did not reach final verification.");
    if (verification.status === "passed") j.beforeAfter = [{ label: appName, before: "Not installed", after: "Installed and open" }];
    const evidence = collectEvidence(steps, j.results, verification);
    j.receipt = await reviewRun({ goal: j.goal, goalMessage: `${appName} is installed and opens`, steps, results: j.results, evidence, verification });
    showDone(j);
  } catch (error) {
    showError(friendlyError(error));
  } finally {
    if (live()) running = false;
  }
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
ipcMain.on("bar-ok", () => void startFlow(runAll));
ipcMain.on("bar-retry", () => {
  // Continue after Stop: the agent looks again and carries on.
  if (resumeAgent && !agentRunning) {
    const r = resumeAgent;
    resumeAgent = null;
    void startFlow(async () => {
      const shot = screenAllowed() ? await captureScreen() : null;
      await agentFlow(r.request, { shot, screenText: "" }, r);
    });
    return;
  }
  if (job && !running) void startFlow(runAll);
  else if (!job) void onHotkey();
});
ipcMain.on("bar-confirm", (_e, data: { yes?: boolean; typed?: string }) => {
  const c = agentConfirm;
  if (!c) return;
  // A typed confirmation must match, whatever the page says.
  const ok = !!data?.yes && (!c.typeToConfirm || String(data.typed ?? "").trim().toLowerCase() === c.typeToConfirm.toLowerCase());
  c.resolve(ok);
});
ipcMain.on("bar-explain-ok", () => agentExplain?.());
ipcMain.on("bar-stop", () => stopNow());
// Cancel and ✕ work on every screen, including while checks are running.
ipcMain.on("bar-cancel", () => cancelFlow());
ipcMain.on("bar-answer", (_e, data: { text?: string }) => void onAnswer(String(data?.text ?? "").slice(0, 500)));
ipcMain.on("bar-approve", (_e, data: { stepId: string; yes: boolean }) => {
  approvals.get(data.stepId)?.(!!data.yes);
  approvals.delete(data.stepId);
});
ipcMain.on("bar-manual", (_e, data: { stepId: string; answer: "done" | "skip" }) => {
  if (data.stepId === "agent") {
    agentGuide?.(data.answer === "skip" ? "skip" : "done");
    return;
  }
  manualWaits.get(data.stepId)?.(data.answer === "skip" ? "skip" : "done");
  manualWaits.delete(data.stepId);
});
ipcMain.on("bar-send-summary", () => {
  if (!job && summaryText) {
    void clipboard.writeText(summaryText);
    say("Copied. Paste it in a message to someone who can help.", "now");
    return;
  }
  if (!job) return;
  void clipboard.writeText(helpSummary(job.goal, job.problem, job.plan.steps, job.results, job.receipt));
  say("Copied. Paste it in a message to someone who can help.", "now");
});
ipcMain.on("bar-rect", (_e, rect: { x: number; y: number; width: number; height: number }) => {
  if (rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) setBarRect(rect);
});
/**
 * Mic state for whichever screen is showing. On the "ask" screen it's part of the screen; on every other screen
 * the bar's bottom row shows it, and what was heard appears there as a note.
 */
function micState(patch: { listening?: boolean; transcribing?: boolean; heard?: string }): void {
  const cur = currentBar();
  if (cur.phase === "ask") askState(patch);
  else if (cur.phase !== "hidden") showBar({ ...cur, heard: patch.heard } as unknown as BarState);
}

ipcMain.on("bar-mic-start", async () => {
  const problem = voiceProblem();
  if (problem) {
    micState({ listening: false, heard: "Voice isn't set up yet, so please type it." });
    return;
  }
  if (!(await ensureMic())) {
    micState({ listening: false, heard: "I can't hear you yet. Please allow the microphone in System Settings → Privacy & Security → Microphone. You can type instead." });
    return;
  }
  if (currentBar().phase === "ask") askState({ listening: true, transcribing: false, heard: undefined });
});
ipcMain.on("bar-mic-cancel", () => {
  if (currentBar().phase === "ask") askState({ listening: false, transcribing: false });
});
ipcMain.on("bar-mic-audio", async (_e, data: { wav: ArrayBuffer }) => {
  micState({ listening: false, transcribing: true });
  try {
    const wav = Buffer.from(data.wav);
    if (wavLoudness(wav) < QUIET) {
      micState({ transcribing: false, heard: "I didn't hear anything. Hold the button and talk a little louder, or type it." });
      return;
    }
    const { text } = await transcribe(wav);
    micState({ transcribing: false, heard: text || "Sorry, I didn't catch that. Try holding the button a little longer." });
    if (text) await onAnswer(text);
  } catch (error) {
    micState({ transcribing: false, heard: (error as Error).message });
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
    // Testing only: CALHACK_MIC_SELFTEST=1 records 2 seconds in the bar window, transcribes it, and logs what happened.
    if (process.env.CALHACK_MIC_SELFTEST === "1") {
      const w = ensureBar();
      w.webContents.once("did-finish-load", async () => {
        try {
          const n = await w.webContents.executeJavaScript(
            "CalhackMic.start().then(() => new Promise((r) => setTimeout(r, 2000))).then(() => CalhackMic.stop()).then((b) => { window.__wav = b; return b.byteLength; })",
          );
          console.log(`[mic] recorded ${n} bytes`);
          const wav = await w.webContents.executeJavaScript("Array.from(new Uint8Array(window.__wav))");
          const r = await transcribe(Buffer.from(wav as number[]));
          console.log(`[mic] heard: "${r.text}" (${r.ms} ms, ${r.model})`);
        } catch (e) {
          console.log(`[mic] failed: ${(e as Error).message}`);
        }
      });
    }
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
