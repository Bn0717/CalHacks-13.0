// "My printer won't print": is a printer set up, is it paused, is it taking jobs, does it have its driver, are jobs stuck.
// Uses the Mac's printing system (CUPS) through lpstat (read-only) and cupsenable / cupsaccept / cancel (fixes).
import type { CheckDef, Facts, FixDef, FixGuide } from "./types.js";

/** Printer queue names we accept from command output (what lpadmin -p allows, minus anything odd). */
export const QUEUE_NAME = /^[A-Za-z0-9_.-]+$/;

/** Throws unless it's a plain queue name, so nothing from command output can sneak into a command. */
export function safeQueue(name: string): string {
  if (!QUEUE_NAME.test(name) || name.startsWith("-") || name.length > 127) throw new Error(`Not a printer name we trust: ${name}`);
  return name;
}

/** "Office_Printer" → "Office Printer" */
export function printerName(queue: string): string {
  return queue.replace(/_/g, " ").trim();
}

const list = (facts: Facts, key: string): string[] => (Array.isArray(facts[key]) ? (facts[key] as string[]) : []);
const num = (facts: Facts, key: string): number => (typeof facts[key] === "number" ? (facts[key] as number) : 0);
const has = (facts: Facts, key: string): boolean => facts[key] !== undefined;

const NO_PRINTERS = /No destinations added/i;

/** `lpstat -p` → every printer, and which are paused (disabled). Odd names are left out. */
export function parsePrinters(output: string): { printers: string[]; paused: string[] } {
  const printers: string[] = [];
  const paused: string[] = [];
  for (const line of output.split("\n")) {
    const m = /^printer (\S+) (.*)$/.exec(line.trim());
    if (!m || !QUEUE_NAME.test(m[1])) continue;
    if (!printers.includes(m[1])) printers.push(m[1]);
    if (/^disabled\b/.test(m[2]) && !paused.includes(m[1])) paused.push(m[1]);
  }
  return { printers, paused };
}

/** `lpstat -a` → printers that aren't taking new jobs. */
export function parseRejecting(output: string): string[] {
  const out: string[] = [];
  for (const line of output.split("\n")) {
    const m = /^(\S+) not accepting requests\b/.exec(line.trim());
    if (m && QUEUE_NAME.test(m[1]) && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** `lpstat -o` → how many jobs are waiting, and on which printers. Job ids look like "Office_Printer-12". */
export function parseJobs(output: string): { jobs: number; jobPrinters: string[] } {
  let jobs = 0;
  const jobPrinters: string[] = [];
  for (const line of output.split("\n")) {
    const m = /^(\S+)-(\d+)\s+\S+/.exec(line.trim());
    if (!m) continue;
    jobs++;
    if (QUEUE_NAME.test(m[1]) && !jobPrinters.includes(m[1])) jobPrinters.push(m[1]);
  }
  return { jobs, jobPrinters };
}

/** `lpstat -d` → the main printer, or "" when the Mac just uses the last one picked. */
export function parseDefault(output: string): string {
  const m = /system default destination:\s*(\S+)/.exec(output);
  return m && QUEUE_NAME.test(m[1]) ? m[1] : "";
}

/** Printers whose driver file (Name.ppd) is missing from `ls /etc/cups/ppd`. */
export function missingDrivers(output: string, printers: string[]): string[] {
  const files = new Set(output.split("\n").map((l) => l.trim()).filter(Boolean));
  return printers.filter((p) => !files.has(`${p}.ppd`));
}

const LPSTAT_P = "LC_ALL=C lpstat -p";

function printersFrom(r: { code: number; output: string }): { printers: string[]; paused: string[] } | null {
  if (NO_PRINTERS.test(r.output)) return { printers: [], paused: [] };
  if (r.code !== 0) return null;
  return parsePrinters(r.output);
}

const names = (queues: string[]) => queues.map((q) => `“${printerName(q)}”`).join(" and ");

const checks: CheckDef[] = [
  {
    id: "printer-added",
    label: "A printer is set up",
    command: LPSTAT_P,
    interpret(r) {
      const found = printersFrom(r);
      if (!found) return { status: "unknown", detail: "Couldn't ask the Mac about printers." };
      if (found.printers.length === 0) return { status: "problem", detail: "No printer is set up on this Mac", facts: found };
      return { status: "ok", detail: `Set up: ${found.printers.map(printerName).join(", ")}`, facts: found };
    },
  },
  {
    id: "printer-paused",
    label: "Printer isn't paused",
    command: LPSTAT_P,
    interpret(r) {
      const found = printersFrom(r);
      if (!found || found.printers.length === 0) return { status: "unknown", detail: "No printer to check" };
      if (found.paused.length) return { status: "problem", detail: `${names(found.paused)} ${found.paused.length > 1 ? "are" : "is"} paused` };
      return { status: "ok", detail: "Not paused" };
    },
  },
  {
    id: "printer-accepting",
    label: "Printer is taking new jobs",
    command: "LC_ALL=C lpstat -a",
    interpret(r, facts) {
      if (list(facts, "printers").length === 0) return { status: "unknown", detail: "No printer to check" };
      if (r.code !== 0) return { status: "unknown", detail: "Couldn't check this." };
      const rejecting = parseRejecting(r.output);
      if (rejecting.length) return { status: "problem", detail: `${names(rejecting)} won't take new jobs`, facts: { rejecting } };
      return { status: "ok", detail: "Taking new jobs", facts: { rejecting } };
    },
  },
  {
    // "Driver unavailable": the printer's driver file is gone.
    id: "printer-driver",
    label: "Printer has its driver",
    command: "ls /etc/cups/ppd",
    interpret(r, facts) {
      const printers = list(facts, "printers");
      if (printers.length === 0) return { status: "unknown", detail: "No printer to check" };
      if (r.code !== 0) return { status: "unknown", detail: "Couldn't check this." };
      const noDriver = missingDrivers(r.output, printers);
      if (noDriver.length) return { status: "problem", detail: `${names(noDriver)} ${noDriver.length > 1 ? "are" : "is"} missing a driver`, facts: { noDriver } };
      return { status: "ok", detail: "Driver is there", facts: { noDriver } };
    },
  },
  {
    id: "printer-jobs",
    label: "No print jobs are stuck",
    command: "LC_ALL=C lpstat -o",
    interpret(r) {
      if (r.code !== 0 && !NO_PRINTERS.test(r.output)) return { status: "unknown", detail: "Couldn't check this." };
      const found = parseJobs(r.output);
      if (found.jobs > 0) return { status: "problem", detail: `${found.jobs} print job${found.jobs > 1 ? "s are" : " is"} stuck`, facts: found };
      return { status: "ok", detail: "Nothing stuck", facts: found };
    },
  },
  {
    id: "printer-default",
    label: "Main printer",
    command: "LC_ALL=C lpstat -d",
    interpret(r) {
      const defaultPrinter = parseDefault(r.output);
      return { status: "ok", detail: defaultPrinter ? `Main printer: ${printerName(defaultPrinter)}` : "Uses the last printer you picked", facts: { defaultPrinter } };
    },
  },
];

const each = (queues: string[], cmd: string) => queues.map((q) => `${cmd} ${safeQueue(q)}`).join(" && ");

const fixes: FixDef[] = [
  {
    // Cleared first: resuming a printer with jobs that can't print just pauses it again.
    id: "clear-jobs",
    label: (f) => `Clear the ${num(f, "jobs")} stuck print job${num(f, "jobs") > 1 ? "s" : ""} (you can print again after)`,
    applies: (f) => num(f, "jobs") > 0 && list(f, "jobPrinters").length > 0,
    command: (f) => each(list(f, "jobPrinters"), "cancel -a"),
  },
  {
    id: "accept-jobs",
    label: (f) => `Let ${names(list(f, "rejecting"))} take print jobs again`,
    applies: (f) => list(f, "rejecting").length > 0,
    command: (f) => each(list(f, "rejecting"), "cupsaccept"),
  },
  {
    id: "resume",
    label: (f) => `Turn ${names(list(f, "paused"))} back on (un-pause it)`,
    applies: (f) => list(f, "paused").length > 0,
    command: (f) => each(list(f, "paused"), "cupsenable"),
  },
  {
    // Re-sets the printer's built-in driver (IPP Everywhere / AirPrint) on the same printer.
    id: "driver",
    label: (f) => `Set up the built-in driver for ${names(list(f, "noDriver"))}`,
    applies: (f) => list(f, "noDriver").length > 0,
    command: (f) => list(f, "noDriver").map((q) => `lpadmin -p ${safeQueue(q)} -m everywhere`).join(" && "),
  },
  {
    id: "add-printer",
    label: "Find your printer on the network and add it",
    applies: (f) => has(f, "printers") && list(f, "printers").length === 0,
    recipe: "add-printer",
  },
];

function problemSentence(f: Facts): string | null {
  const printers = list(f, "printers");
  if (has(f, "printers") && printers.length === 0) return "No printer is set up on this Mac.";
  const paused = list(f, "paused");
  const rejecting = list(f, "rejecting");
  const noDriver = list(f, "noDriver");
  const jobs = num(f, "jobs");
  const affected = [...new Set([...paused, ...rejecting, ...noDriver, ...list(f, "jobPrinters")])];
  if (!paused.length && !rejecting.length && !noDriver.length && jobs === 0) return null;
  const stuck = `${jobs} stuck print job${jobs > 1 ? "s" : ""}`;
  if (affected.length <= 1) {
    const parts = [
      paused.length ? "is paused" : "",
      rejecting.length ? "isn't taking new jobs" : "",
      noDriver.length ? "is missing its driver" : "",
      jobs ? `has ${stuck}` : "",
    ].filter(Boolean);
    const who = affected.length ? `Your printer “${printerName(affected[0])}”` : "Your printer";
    return `${who} ${joinAnd(parts)}.`;
  }
  const parts = [
    paused.length ? `${paused.length} ${paused.length > 1 ? "are" : "is"} paused` : "",
    rejecting.length ? `${rejecting.length} won't take new jobs` : "",
    noDriver.length ? `${noDriver.length} ${noDriver.length > 1 ? "are" : "is"} missing a driver` : "",
    jobs ? `${stuck} ${jobs > 1 ? "are" : "is"} waiting` : "",
  ].filter(Boolean);
  return `Your printers need help: ${joinAnd(parts)}.`;
}

export function joinAnd(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1];
}

function status(f: Facts): { label: string; value: string }[] {
  if (!has(f, "printers")) return [{ label: "Printer", value: "Couldn't check" }];
  const printers = list(f, "printers");
  if (printers.length === 0) return [{ label: "Printer", value: "None set up" }];
  const state = (q: string) =>
    list(f, "paused").includes(q) ? "Paused"
    : list(f, "rejecting").includes(q) ? "Not taking jobs"
    : list(f, "noDriver").includes(q) ? "Missing its driver"
    : "Ready";
  const jobs = num(f, "jobs");
  return [
    { label: "Printer", value: printers.map((q) => `${printerName(q)}: ${state(q)}`).join(", ") },
    { label: "Stuck print jobs", value: jobs ? String(jobs) : "None" },
  ];
}

export const printerGuide: FixGuide = {
  id: "printer",
  title: "Printer won't print",
  goal: "Get your printer printing again",
  describe: "The printer won't print, shows as offline or paused, has stuck print jobs, says driver unavailable, or no printer is set up.",
  examples: [
    "my printer won't print",
    "printer offline",
    "printer is paused",
    "print jobs are stuck",
    "printer driver unavailable",
    "I can't find my printer",
    "nothing comes out when I print",
  ],
  checks,
  fixes,
  problemSentence,
  status,
};
