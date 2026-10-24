// Breaks a shell command into its parts so the safety rules can look at real structure,
// not just raw text.
import { parse } from "shell-quote";

/** One simple command, e.g. `curl -fsSL https://x` inside `curl -fsSL https://x | bash`. */
export interface Segment {
  /** Words of the command with wrappers like sudo/env removed. */
  argv: string[];
  /** Lower-case program name without its folder, e.g. "bash" for "/bin/bash". */
  cmd: string;
  /** True when the command was run through sudo. */
  sudo: boolean;
  /** Files this segment writes to with > or >> (other than /dev/null). */
  writesTo: string[];
}

/** Commands joined by pipes: the output of each feeds the next. */
export type Pipeline = Segment[];

export interface ParsedCommand {
  /** Every pipeline in the command (separated by ; && || &). */
  pipelines: Pipeline[];
  /** Text inside $( ), backticks and <( ). These run as their own commands. */
  substitutions: string[];
  /** Every web address mentioned anywhere in the command. */
  urls: string[];
}

const PLACEHOLDER = "__SUBST_";

/**
 * Pulls out $( ... ), `...`, <( ... ) and >( ... ) so they can be checked on their own.
 * The outer command keeps a placeholder where each one was.
 */
export function extractSubstitutions(cmd: string): { outer: string; subs: string[] } {
  const subs: string[] = [];
  let out = "";
  let i = 0;
  let inSingle = false;
  while (i < cmd.length) {
    const ch = cmd[i];
    if (ch === "'" && !inSingle) {
      // Inside single quotes nothing is expanded, so copy straight through.
      const end = cmd.indexOf("'", i + 1);
      if (end === -1) {
        out += cmd.slice(i);
        break;
      }
      out += cmd.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    const two = cmd.slice(i, i + 2);
    if (two === "$(" || two === "<(" || two === ">(") {
      let depth = 1;
      let j = i + 2;
      while (j < cmd.length && depth > 0) {
        if (cmd[j] === "(") depth++;
        else if (cmd[j] === ")") depth--;
        j++;
      }
      const inner = cmd.slice(i + 2, depth === 0 ? j - 1 : j);
      subs.push(inner);
      // Keep the < or > of process substitution visible to the outer parse as a word.
      out += (two === "$(" ? "" : two[0] === "<" ? "PROCSUB_IN" : "PROCSUB_OUT") + PLACEHOLDER + (subs.length - 1) + "__";
      i = j;
      continue;
    }
    if (ch === "`") {
      const end = cmd.indexOf("`", i + 1);
      const inner = end === -1 ? cmd.slice(i + 1) : cmd.slice(i + 1, end);
      subs.push(inner);
      out += PLACEHOLDER + (subs.length - 1) + "__";
      i = end === -1 ? cmd.length : end + 1;
      continue;
    }
    out += ch;
    i++;
  }
  // Nested substitutions are found too.
  const nested = subs.flatMap((s) => extractSubstitutions(s).subs);
  return { outer: out, subs: [...subs, ...nested] };
}

const SEPARATORS = new Set([";", "&&", "||", "&", ";;", "(", ")", "\n"]);
const PIPES = new Set(["|", "|&"]);
const REDIRECT_OUT = new Set([">", ">>", ">|", "&>", "&>>"]);
const REDIRECT_OTHER = new Set(["<", "<<", "<<<", ">&", "<&"]);

/** Wrapper programs that just run the command after them. */
const WRAPPERS = new Set(["sudo", "env", "command", "builtin", "exec", "nohup", "time", "doas"]);
/** sudo options that take a value, e.g. -u root. */
const SUDO_VALUE_FLAGS = new Set(["-u", "-g", "-C", "-h", "-p", "-U", "-r", "-t"]);

function basename(word: string): string {
  const parts = word.split("/");
  return (parts[parts.length - 1] || word).toLowerCase();
}

function toSegment(words: string[], writesTo: string[]): Segment | null {
  let i = 0;
  let sudo = false;
  // Skip VAR=value assignments and wrapper programs like sudo and env.
  for (;;) {
    while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) i++;
    if (i >= words.length) break;
    const w = basename(words[i]);
    if (!WRAPPERS.has(w)) break;
    // `command -v x` looks a program up; it doesn't run it.
    if (w === "command" && (words[i + 1] === "-v" || words[i + 1] === "-V")) break;
    if (w === "sudo" || w === "doas") sudo = true;
    i++;
    // Skip the wrapper's own options.
    while (i < words.length && words[i].startsWith("-")) {
      const flag = words[i];
      i++;
      if ((w === "sudo" || w === "doas") && SUDO_VALUE_FLAGS.has(flag)) i++;
    }
  }
  const argv = words.slice(i);
  if (argv.length === 0) return sudo ? { argv: [], cmd: "", sudo, writesTo } : null;
  return { argv, cmd: basename(argv[0]), sudo, writesTo };
}

/** Splits a command (without substitutions) into pipelines of segments. */
function splitPipelines(outer: string): Pipeline[] {
  // Keep $VARS as written instead of expanding them.
  const tokens = parse(outer, (key: string) => "$" + key) as unknown[];
  const pipelines: Pipeline[] = [];
  let pipeline: Segment[] = [];
  let words: string[] = [];
  let writes: string[] = [];
  let pendingRedirect: "out" | "other" | null = null;

  const endSegment = () => {
    const seg = toSegment(words, writes);
    if (seg) pipeline.push(seg);
    words = [];
    writes = [];
  };
  const endPipeline = () => {
    endSegment();
    if (pipeline.length) pipelines.push(pipeline);
    pipeline = [];
  };

  for (const tok of tokens) {
    if (typeof tok === "string") {
      if (pendingRedirect === "out") {
        if (tok !== "/dev/null") writes.push(tok);
        pendingRedirect = null;
      } else if (pendingRedirect === "other") {
        pendingRedirect = null;
      } else {
        words.push(tok);
      }
      continue;
    }
    const t = tok as { op?: string; pattern?: string; comment?: string };
    if (t.comment !== undefined) continue;
    if (t.op === "glob" && t.pattern) {
      words.push(t.pattern);
      continue;
    }
    if (!t.op) continue;
    if (PIPES.has(t.op)) endSegment();
    else if (SEPARATORS.has(t.op)) endPipeline();
    else if (REDIRECT_OUT.has(t.op)) pendingRedirect = "out";
    else if (REDIRECT_OTHER.has(t.op)) pendingRedirect = "other";
  }
  endPipeline();

  // "2>&1" leaves a stray "2" or "1" word before/after the redirect; drop lone digits at the end.
  for (const p of pipelines) {
    for (const s of p) {
      while (s.argv.length > 1 && /^\d$/.test(s.argv[s.argv.length - 1])) s.argv.pop();
    }
  }
  return pipelines;
}

const URL_RE = /\bhttps?:\/\/[^\s'"`<>)|;]+/gi;

export function findUrls(text: string): string[] {
  return [...new Set(text.match(URL_RE) ?? [])];
}

/** Parses a whole command line, including what is inside $( ) and backticks. */
export function parseCommand(cmd: string): ParsedCommand {
  const { outer, subs } = extractSubstitutions(cmd);
  let pipelines: Pipeline[];
  try {
    pipelines = splitPipelines(outer);
  } catch {
    pipelines = [];
  }
  return { pipelines, substitutions: subs, urls: findUrls(cmd) };
}

/** True when a word is a placeholder for a $( ) or `` substitution. */
export function isSubstitutionWord(word: string): boolean {
  return word.includes(PLACEHOLDER);
}

/** Which substitution numbers a word refers to. */
export function substitutionIndexes(word: string): number[] {
  return [...word.matchAll(/__SUBST_(\d+)__/g)].map((m) => Number(m[1]));
}

export function isProcessSubstitutionWord(word: string): boolean {
  return word.includes("PROCSUB_IN" + PLACEHOLDER) || word.includes("PROCSUB_OUT" + PLACEHOLDER);
}
