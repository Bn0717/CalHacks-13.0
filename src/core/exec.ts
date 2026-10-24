// Runs commands. Read-only commands run inside a macOS sandbox that can't write files or use the internet.
import { spawn } from "node:child_process";

export interface ExecResult {
  code: number;
  output: string;
  timedOut: boolean;
}

/**
 * The sandbox for read-only commands: no network, and no writing anywhere except /dev and the temp folders
 * the shell itself needs.
 */
const READ_ONLY_PROFILE = `(version 1)
(allow default)
(deny network*)
(allow network-outbound (remote unix-socket (path-literal "/private/var/run/cupsd")))
(deny file-write*)
(allow file-write* (literal "/dev/null") (literal "/dev/tty") (literal "/dev/dtracehelper") (regex #"^/dev/fd/"))
`;

const MAX_OUTPUT = 20_000;

function run(file: string, args: string[], timeoutMs: number): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(file, args, { env: { ...process.env, HOMEBREW_NO_AUTO_UPDATE: "1", NONINTERACTIVE: "1" } });
    let output = "";
    const add = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.length > MAX_OUTPUT * 2) output = output.slice(-MAX_OUTPUT);
    };
    child.stdout.on("data", add);
    child.stderr.on("data", add);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: 127, output: String(err), timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, output: output.slice(-MAX_OUTPUT), timedOut });
    });
  });
}

/** Login shell so Homebrew and other tools are on the PATH, like in the user's own Terminal. */
const SHELL = "/bin/zsh";

/** Runs a read-only command inside the sandbox. */
export function runSandboxed(command: string, timeoutMs = 30_000): Promise<ExecResult> {
  return run("/usr/bin/sandbox-exec", ["-p", READ_ONLY_PROFILE, SHELL, "-lc", command], timeoutMs);
}

/** Runs a command normally. Only used after the user said yes. */
export function runNormally(command: string, timeoutMs = 15 * 60_000): Promise<ExecResult> {
  return run(SHELL, ["-lc", command], timeoutMs);
}

/** Puts text inside an AppleScript string. */
function appleScriptString(text: string): string {
  return '"' + text.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

/**
 * Runs a command as administrator. macOS shows its own password box, so this app never sees the password.
 * A leading "sudo" is removed because the whole command already runs as administrator.
 */
export function runAsAdmin(command: string, timeoutMs = 15 * 60_000): Promise<ExecResult> {
  const withoutSudo = command.replace(/(^|&&|;|\|\|)\s*sudo\s+(-[A-Za-z]+\s+)*/g, "$1 ").trim();
  const script = `do shell script ${appleScriptString(`/bin/zsh -lc ${shellQuote(withoutSudo)}`)} with administrator privileges`;
  return run("/usr/bin/osascript", ["-e", script], timeoutMs);
}

function shellQuote(text: string): string {
  return "'" + text.replace(/'/g, "'\\''") + "'";
}
