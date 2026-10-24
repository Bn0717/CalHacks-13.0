// Droid (Factory Droid SDK) runs the steps CalHack has already checked and approved.
//
// What Droid is allowed to touch:
// - It is told to run one exact command, once. Our safety rules already approved that command.
// - autonomyLevel Off: Droid has to ask before every action, and our permissionHandler answers.
// - The permissionHandler only allows running that exact command, one time. Anything else Droid tries
//   (editing files, another command, a retry, a "fixed" version) is cancelled and shown in the log.
// - Admin (sudo) steps never go to Droid: they run through CalHack so macOS shows its own password box.
//
// Everything Droid does is kept as plain log lines for the panel's "What Droid did" section.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExecResult } from "../core/exec.js";
import { normalizeCommand } from "../core/normalize.js";

export interface DroidExecResult extends ExecResult {
  ranBy: "droid";
  log: string[];
}

/** Where the droid program is, or null when it isn't installed. */
export function droidPath(): string | null {
  const fromEnv = process.env.CALHACK_DROID_PATH?.trim();
  if (fromEnv) return existsSync(fromEnv) ? fromEnv : null;
  const dirs = [...(process.env.PATH ?? "").split(":"), join(homedir(), ".local", "bin"), join(homedir(), ".factory", "bin"), "/opt/homebrew/bin", "/usr/local/bin"];
  return dirs.map((d) => join(d, "droid")).find((p) => existsSync(p)) ?? null;
}

/** Why Droid can't run right now, or null when it's ready. */
export function droidProblem(): string | null {
  if (!process.env.FACTORY_API_KEY?.trim()) return "No FACTORY_API_KEY in .env";
  if (!droidPath()) return "The droid program isn't installed";
  return null;
}

/** True when the command Droid asks to run is exactly the approved one (ignoring spacing and quote style). */
export function sameCommand(asked: string, approved: string): boolean {
  return normalizeCommand(asked) === normalizeCommand(approved);
}

/** One tool request from Droid, reduced to what our gate looks at. */
export interface ToolRequest {
  type: string;
  fullCommand?: string;
  command?: string;
  filePath?: string;
}

/**
 * The gate. Droid may run the approved command, exactly, one time, in a request of its own.
 * Anything else (another command, a file edit, a retry, a "fixed" version) is refused.
 */
export function gate(requests: ToolRequest[], approved: string, alreadyRan: boolean): { allow: boolean; lines: string[] } {
  const allow =
    !alreadyRan &&
    requests.length === 1 &&
    requests[0].type === "exec" &&
    sameCommand(requests[0].fullCommand || requests[0].command || "", approved);
  const lines = requests.map((r) => {
    const what = short(r.fullCommand ?? r.command ?? r.filePath ?? r.type);
    if (allow) return `✅ Allowed: ${what}`;
    return alreadyRan && r.type === "exec" ? `⛔ Refused a second command: ${what}` : `⛔ Refused (not the approved command): ${what}`;
  });
  return { allow, lines };
}

const RESULT_SCHEMA = {
  type: "object",
  properties: {
    exit_code: { type: "number", description: "The command's exit code" },
    output_tail: { type: "string", description: "The last 20 lines of the command's output, unchanged" },
  },
  required: ["exit_code", "output_tail"],
  additionalProperties: false,
};

function promptFor(command: string): string {
  return [
    "You are the executor inside CalHack, a Mac helper. CalHack has already checked this command and the person approved it.",
    "Run exactly this one shell command with your shell tool, once, from the person's home folder:",
    "",
    command,
    "",
    "Rules: do not change the command, do not run any other command, do not read or edit files, and do not retry if it fails.",
    "Then report the command's exit code and the last lines of its output.",
  ].join("\n");
}

function short(text: string, max = 160): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > max ? one.slice(0, max - 1) + "…" : one;
}

/** The real exit code, from the shell tool's own output (e.g. "[Process exited with code 1]"). */
export function exitCodeFrom(output: string): number | null {
  const m = /\[Process exited with code (-?\d+)\]|exit code:?\s*(-?\d+)/i.exec(output);
  return m ? Number(m[1] ?? m[2]) : null;
}

/** Only the shell tool stays on. No web, no file reading, no scripts, no sub-agents. */
const KEEP_TOOLS = new Set(["Execute"]);

/** Runs one approved command through Droid. Throws when Droid can't start, so the caller can fall back. */
export async function runWithDroid(command: string, timeoutMs = 15 * 60_000): Promise<DroidExecResult> {
  const sdk = await import("@factory/droid-sdk/node");
  const { AutonomyLevel, DroidMessageType, OutputFormatType, ToolConfirmationOutcome, ToolConfirmationType, createSession } = sdk;
  if (ToolConfirmationType.Execute !== "exec") throw new Error("This Droid SDK version names its tools differently.");
  const log: string[] = [];
  let allowedOnce = false;
  const refused = new Set<string>();

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  const execPath = droidPath() ?? undefined;

  const session = await createSession({
    cwd: homedir(),
    execPath,
    // Droid runs on Claude by default. CALHACK_DROID_MODEL changes it (see npm run droid:check).
    modelId: process.env.CALHACK_DROID_MODEL?.trim() || "claude-sonnet-5-5",
    autonomyLevel: AutonomyLevel.Off,
    disableBuiltinSkills: true,
    env: { ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === "string")), HOMEBREW_NO_AUTO_UPDATE: "1", NONINTERACTIVE: "1" },
    abortSignal: abort.signal,
    permissionHandler({ toolUses }) {
      // Only the one approved command, only once. Everything else is refused.
      const requests = toolUses.map((t) => t.details as ToolRequest);
      const { allow, lines } = gate(requests, command, allowedOnce);
      log.push(...lines);
      if (allow) allowedOnce = true;
      else for (const r of requests) refused.add(normalizeCommand(r.fullCommand ?? r.command ?? ""));
      return allow ? ToolConfirmationOutcome.ProceedOnce : ToolConfirmationOutcome.Cancel;
    },
  });

  try {
    // Turn off every tool except the shell, so Droid can't read files or reach the web.
    const tools = await session.listTools();
    const off = tools.map((t) => t.id).filter((id) => !KEEP_TOOLS.has(id));
    await session.updateSettings({ disabledToolIds: off });
    log.push(`Droid's tools: only Execute is on (${off.length} others turned off)`);
    log.push(`Droid got the step: ${short(command)}`);

    // Every shell command Droid really starts. Droid's own settings auto-run some "harmless" commands
    // without asking, so this is checked too, not just the permission requests.
    const calls = new Map<string, string>();
    let ranApproved = false;
    let toolOutput = "";
    let toolError = false;
    let violation: string | null = null;
    let structured: unknown;

    for await (const msg of session.stream(promptFor(command), {
      outputFormat: { type: OutputFormatType.JsonSchema, schema: RESULT_SCHEMA },
      abortSignal: abort.signal,
    })) {
      if (msg.type === DroidMessageType.ToolCall) {
        const input = (msg.input ?? {}) as Record<string, unknown>;
        const asked = String(input.command ?? input.fullCommand ?? "");
        calls.set(msg.toolUseId, asked);
        log.push(`Droid wants to use ${msg.name}${asked ? `: ${short(asked)}` : ""}`);
      } else if (msg.type === DroidMessageType.ToolResult) {
        const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
        const asked = calls.get(msg.toolUseId) ?? "";
        log.push(`${msg.isError ? "❌" : "📄"} ${msg.toolName} result: ${short(content, 120)}`);
        if (msg.toolName !== "Execute") continue;
        if (!ranApproved && sameCommand(asked, command)) {
          ranApproved = true;
          toolOutput = content;
          toolError = msg.isError;
        } else if (!refused.has(normalizeCommand(asked))) {
          violation = asked || "an unknown command";
          log.push(`⛔ Droid ran something we didn't approve: ${short(violation)}. Stopping.`);
          await session.interrupt().catch(() => {});
          break;
        }
      } else if (msg.type === DroidMessageType.Result) {
        if (!msg.success) throw new Error(msg.error?.message ?? `Droid stopped: ${msg.subtype}`);
        structured = msg.structuredOutput;
      }
    }

    if (violation) return { code: 1, output: `Droid ran a command we didn't approve (${violation}), so we stopped.`, timedOut: false, ranBy: "droid", log };
    if (!ranApproved) {
      log.push("Droid didn't run the command.");
      return { code: 1, output: "Droid didn't run the command.", timedOut: false, ranBy: "droid", log };
    }
    // The exit code comes from the shell tool's own output when it says one; Droid's report is the backup.
    const report = structured as { exit_code?: unknown; output_tail?: unknown } | undefined;
    const code = exitCodeFrom(toolOutput) ?? (typeof report?.exit_code === "number" ? report.exit_code : toolError ? 1 : 0);
    const output = toolOutput.replace(/\n*\[Process exited with code -?\d+\]\s*$/, "").replace(/^Error: Command failed \(exit code: -?\d+\)\s*/, "");
    log.push(`Exit code ${code}`);
    return { code, output, timedOut: false, ranBy: "droid", log };
  } catch (error) {
    if (abort.signal.aborted) return { code: 124, output: "Droid took too long.", timedOut: true, ranBy: "droid", log };
    throw error;
  } finally {
    clearTimeout(timer);
    await session.close().catch(() => {});
  }
}
