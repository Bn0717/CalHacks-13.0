// The safety rules. Plain code decides how risky a command is; the AI is never asked to.
import type { Assessment, Finding, RiskLevel } from "./types.js";
import { stricter } from "./types.js";
import { hasInvisibleCharacters, normalizeCommand } from "./normalize.js";
import {
  isSubstitutionWord,
  parseCommand,
  substitutionIndexes,
  type Segment,
} from "./shell.js";
import { isSuspiciousHost, isTrustedInstaller, isVendorHost } from "./trusted.js";

export interface AssessContext {
  /** Host of the page the instructions came from, e.g. "support.hp.com". */
  pageHost?: string;
}

const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish", "tcsh", "csh"]);
const INTERPRETERS = new Set(["python", "python2", "python3", "perl", "ruby", "node", "php", "osascript", "pwsh"]);
const DOWNLOADERS = new Set(["curl", "wget", "fetch"]);

// ---------- Read-only commands (the only ones that can be "safe") ----------

/** Commands that only read, whatever their arguments. */
const ALWAYS_READ_ONLY = new Set([
  "ls", "cat", "head", "tail", "grep", "egrep", "fgrep", "rg", "wc", "echo", "printf", "pwd",
  "whoami", "id", "hostname", "date", "ps", "df", "du", "mdfind", "mdls", "file", "stat",
  "lpstat", "ioreg", "kextstat", "sw_vers", "uname", "which", "whereis", "type", "test", "[",
  "true", "false", "system_profiler", "tr", "sort", "uniq", "cut", "less", "more", "uptime",
  "arch", "groups", "env", "printenv", "locale", "sysctl", "lsof", "netstat", "dig", "nslookup",
  "host", "md5", "shasum", "sha256sum", "cksum", "basename", "dirname", "realpath", "readlink",
  "getconf", "lsappinfo", "nvram", "log",
]);

/** Commands that are read-only only with certain first arguments. */
const READ_ONLY_SUBCOMMANDS: Record<string, (args: string[]) => boolean> = {
  brew: (a) => ["list", "ls", "info", "--version", "-v", "config", "search", "outdated", "--prefix", "--cellar", "deps", "leaves", "desc", "doctor", "home"].includes(a[0] ?? ""),
  defaults: (a) => ["read", "read-type", "domains", "find"].includes(a[0] ?? ""),
  launchctl: (a) => ["list", "print", "print-disabled", "blame"].includes(a[0] ?? ""),
  pkgutil: (a) => a.length > 0 && a.every((x) => !x.startsWith("-") || ["--pkgs", "--pkg-info", "--files", "--check-signature", "--pkgs-plist", "--pkg-info-plist", "--export-plist", "--file-info"].includes(x)),
  codesign: (a) => a.some((x) => ["-d", "-dv", "-dvv", "-dvvv", "--display", "-v", "--verify"].includes(x)) && !a.some((x) => ["-s", "--sign", "--remove-signature", "-f", "--force"].includes(x)),
  spctl: (a) => a.some((x) => ["--status", "-a", "--assess"].includes(x)) && !a.some((x) => /disable|enable|--add|--remove/.test(x)),
  csrutil: (a) => a[0] === "status",
  diskutil: (a) => ["list", "info", "apfs"].includes(a[0] ?? "") && !a.some((x) => /erase|delete|resize|unmount|mount/i.test(x)),
  networksetup: (a) => (a[0] ?? "").startsWith("-get") || (a[0] ?? "").startsWith("-list"),
  pmset: (a) => a[0] === "-g",
  scutil: (a) => a[0] === "--get" || a[0] === "--dns" || a[0] === "--proxy",
  xattr: (a) => a.length === 0 || a.every((x) => !x.startsWith("-") || ["-l", "-p", "-x"].includes(x)),
  ifconfig: (a) => a.length <= 1,
  find: (a) => !a.some((x) => ["-delete", "-exec", "-execdir", "-ok", "-okdir", "-fprint", "-fls"].includes(x)),
  sed: (a) => !a.some((x) => x.startsWith("-i") || x === "--in-place"),
  awk: (a) => !a.some((x) => /system\s*\(|>|\bprint\b.*\|/.test(x)),
  git: (a) => ["--version", "status", "log", "diff", "show", "branch", "remote", "config"].includes(a[0] ?? "") && !(a[0] === "config" && !a.includes("--get") && !a.includes("--list") && !a.includes("-l")),
  "xcode-select": (a) => ["-p", "--print-path", "-v", "--version"].includes(a[0] ?? ""),
  softwareupdate: (a) => a[0] === "--history",
  security: (a) => ["find-certificate", "list-keychains", "show-keychain-info"].includes(a[0] ?? ""),
  tmutil: (a) => ["listlocalsnapshots", "destinationinfo", "status", "latestbackup", "listbackups"].includes(a[0] ?? ""),
  kmutil: (a) => a[0] === "showloaded",
  systemextensionsctl: (a) => a[0] === "list",
  npm: (a) => ["-v", "--version", "ls", "list", "view", "config"].includes(a[0] ?? "") && !(a[0] === "config" && a[1] !== "get" && a[1] !== "list"),
  pip3: (a) => ["--version", "-V", "list", "show", "freeze"].includes(a[0] ?? ""),
  pip: (a) => ["--version", "-V", "list", "show", "freeze"].includes(a[0] ?? ""),
  python3: (a) => ["--version", "-V"].includes(a[0] ?? "") || (a[0] === "-m" && a[1] === "pip" && ["list", "show", "--version"].includes(a[2] ?? "")),
  node: (a) => ["-v", "--version"].includes(a[0] ?? ""),
  command: (a) => a[0] === "-v" || a[0] === "-V",
  "lpinfo": () => true,
  "lpoptions": (a) => a.every((x) => x !== "-o" && x !== "-x" && x !== "-d"),
};

const VERSION_FLAGS = new Set(["--version", "-version", "-v", "-V", "--help", "-h", "version"]);

function segmentIsReadOnly(seg: Segment): boolean {
  if (seg.sudo) return false;
  if (seg.writesTo.length) return false;
  if (seg.argv.some(isSubstitutionWord)) return false;
  const args = seg.argv.slice(1);
  if (ALWAYS_READ_ONLY.has(seg.cmd)) {
    // `env FOO=bar cmd` and `log erase` are not just reading.
    if (seg.cmd === "log") return ["show", "stream", "stats"].includes(args[0] ?? "");
    if (seg.cmd === "nvram") return args.every((a) => !a.includes("=") && a !== "-d" && a !== "-c");
    if (seg.cmd === "sysctl") return !args.includes("-w") && !args.some((a) => a.includes("="));
    return true;
  }
  const check = READ_ONLY_SUBCOMMANDS[seg.cmd];
  if (check) return check(args);
  // `anything --version` only prints a version.
  return args.length === 1 && VERSION_FLAGS.has(args[0]);
}

// ---------- Rules ----------

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function urlsIn(text: string): string[] {
  return text.match(/\bhttps?:\/\/[^\s'"`<>)|;]+/gi) ?? [];
}

/** Rating for code that is downloaded and run straight away. */
function downloadAndRunFinding(urls: string[], how: string): Finding {
  if (urls.length > 0 && urls.every(isTrustedInstaller)) {
    return {
      rule: "official-installer",
      level: "ask",
      reason: `Runs the official installer from ${hostOf(urls[0])} straight from the internet. This is normal for this tool, but it still runs code you can't see first.`,
    };
  }
  // An https download from the company's own site (not a place anyone can upload to, like GitHub).
  const fromCompany = (u: string) => {
    const host = hostOf(u);
    return u.startsWith("https://") && !!host && isVendorHost(host) && !/(^|\.)(github\.com|githubusercontent\.com)$/.test(host);
  };
  if (urls.length > 0 && urls.every(fromCompany)) {
    return {
      rule: "official-installer",
      level: "ask",
      reason: `Downloads the installer from ${hostOf(urls[0])}, a company we recognize, and runs it. It still runs code you can't see first.`,
    };
  }
  return {
    rule: "download-and-run",
    level: "blocked",
    reason: `Downloads code from the internet and ${how}, without showing you what it is. This is the most common trick in "paste this into Terminal" scams.`,
  };
}

function isDecoder(seg: Segment): boolean {
  const a = seg.argv.slice(1);
  if (seg.cmd === "base64") return a.some((x) => ["-d", "-D", "--decode"].includes(x));
  if (seg.cmd === "openssl") return a.includes("base64") && a.includes("-d");
  if (seg.cmd === "xxd") return a.includes("-r");
  if (seg.cmd === "rev") return true;
  return false;
}

/** A shell or interpreter that runs code it reads from its input (no script file given). */
function runsStdin(seg: Segment): boolean {
  if (!SHELLS.has(seg.cmd) && !INTERPRETERS.has(seg.cmd)) return false;
  const args = seg.argv.slice(1);
  if (args.length === 0) return true;
  if (args.some((a) => VERSION_FLAGS.has(a))) return false;
  if (args.includes("-s") || args.includes("-")) return true;
  // `bash -x` etc. with only flags still reads its input.
  return args.every((a) => a.startsWith("-") && a !== "-c" && a !== "-e");
}

/** A shell or interpreter told to run text given right on the command line. */
function runsInlineCode(seg: Segment): string | null {
  const args = seg.argv.slice(1);
  if (SHELLS.has(seg.cmd)) {
    const i = args.indexOf("-c");
    if (i !== -1) return args[i + 1] ?? "";
  }
  if (INTERPRETERS.has(seg.cmd)) {
    const i = args.findIndex((a) => a === "-c" || a === "-e");
    if (i !== -1) return args[i + 1] ?? "";
  }
  if (seg.cmd === "eval") return args.join(" ");
  return null;
}

const DESTRUCTIVE_TARGETS = new Set(["/", "/*", "~", "~/", "~/*", "$HOME", "$HOME/", "$HOME/*", "/System", "/Users", "/Applications", "/Library", "/usr", "/bin", "/etc", "/private", "."]);

function ruleSegment(seg: Segment, findings: Finding[]): void {
  const a = seg.argv.slice(1);
  const joined = a.join(" ");

  // Turning off macOS (or Windows) malware protection.
  if (seg.cmd === "spctl" && a.some((x) => /--master-disable|--global-disable|--disable/.test(x))) {
    findings.push({ rule: "disable-gatekeeper", level: "blocked", reason: "Turns off Gatekeeper, the macOS feature that stops unknown apps from running. Malware instructions often ask for this." });
  }
  if (seg.cmd === "csrutil" && (a[0] === "disable" || a[0] === "authenticated-root")) {
    findings.push({ rule: "disable-sip", level: "blocked", reason: "Turns off System Integrity Protection, which protects macOS itself from being changed." });
  }
  if (seg.cmd === "defaults" && /LSQuarantine/i.test(joined) && /false|0|NO/i.test(joined)) {
    findings.push({ rule: "disable-quarantine", level: "blocked", reason: "Stops macOS from warning you about downloaded files." });
  }
  if (seg.cmd === "xattr" && (a.includes("-c") || a.includes("-cr") || a.includes("-rc") || (a.includes("-d") && /com\.apple\.quarantine/.test(joined)))) {
    findings.push({ rule: "remove-quarantine", level: "ask", reason: "Removes the \"downloaded from the internet\" mark, so macOS won't check this app before opening it. Only do this for apps you trust." });
  }
  if (/Set-MpPreference/i.test(seg.argv.join(" ")) && /Disable/i.test(joined)) {
    findings.push({ rule: "disable-defender", level: "blocked", reason: "Turns off Windows Defender antivirus." });
  }

  // Reading saved passwords.
  if (seg.cmd === "security" && /^(find-generic-password|find-internet-password|dump-keychain|export|unlock-keychain)$/.test(a[0] ?? "")) {
    findings.push({ rule: "password-access", level: "blocked", reason: "Reads passwords saved in your Keychain. Instructions should never need this." });
  }
  if (/Login Data|Cookies\.binarycookies|Keychains\/|Local State|wallet|\.ssh\/id_/i.test(seg.argv.join(" ")) && !segmentIsReadOnly(seg)) {
    findings.push({ rule: "secret-files", level: "blocked", reason: "Touches files that hold your saved passwords, cookies, keys or crypto wallets." });
  }
  if (seg.cmd === "dscl" && a.some((x) => /-authonly|-passwd/.test(x))) {
    findings.push({ rule: "password-check", level: "blocked", reason: "Checks or changes your account password from the command line." });
  }

  // Fake password boxes and hidden AppleScript.
  if (seg.cmd === "osascript") {
    if (/display dialog/i.test(joined) && /hidden answer|password/i.test(joined)) {
      findings.push({ rule: "fake-password-box", level: "blocked", reason: "Shows a pop-up asking for your password. This is how Mac password-stealing malware works." });
    } else if (/do shell script/i.test(joined)) {
      findings.push({ rule: "applescript-shell", level: "ask", reason: "Runs a hidden shell command through AppleScript." });
    } else {
      findings.push({ rule: "applescript", level: "ask", reason: "Runs an AppleScript, which can control other apps." });
    }
  }

  // Wiping things.
  if (seg.cmd === "rm") {
    const recursive = a.some((x) => /^-[a-zA-Z]*[rR]/.test(x) || x === "--recursive");
    const targets = a.filter((x) => !x.startsWith("-"));
    if (recursive && targets.some((t) => DESTRUCTIVE_TARGETS.has(t.replace(/\/+$/, "") || "/") || DESTRUCTIVE_TARGETS.has(t))) {
      findings.push({ rule: "wipe", level: "blocked", reason: "Deletes a whole folder like your home folder or the system. This would destroy your files." });
    } else {
      findings.push({ rule: "delete", level: "ask", reason: "Deletes files." });
    }
  }
  if (seg.cmd === "diskutil" && /erase|zeroDisk|randomDisk|secureErase|partitionDisk/i.test(a[0] ?? "")) {
    findings.push({ rule: "erase-disk", level: "blocked", reason: "Erases a whole disk." });
  }
  if (seg.cmd === "dd" && a.some((x) => /^of=\/dev\//.test(x))) {
    findings.push({ rule: "raw-disk-write", level: "blocked", reason: "Writes directly over a disk, which can erase it." });
  }

  // Windows tricks (also flagged as the wrong platform elsewhere).
  const all = seg.argv.join(" ");
  if (/^(powershell|pwsh)(\.exe)?$/.test(seg.cmd) && /-e(nc|ncodedcommand)?\b/i.test(joined)) {
    findings.push({ rule: "encoded-powershell", level: "blocked", reason: "Runs a scrambled PowerShell command so you can't read what it does." });
  }
  if (/\b(iex|Invoke-Expression)\b/i.test(all) && /DownloadString|Invoke-WebRequest|iwr|irm|Invoke-RestMethod|Net\.WebClient/i.test(all)) {
    findings.push({ rule: "powershell-download-run", level: "blocked", reason: "Downloads PowerShell code from the internet and runs it right away." });
  }
  if (/^mshta(\.exe)?$/.test(seg.cmd) || (seg.cmd.startsWith("certutil") && /-urlcache/i.test(joined)) || (seg.cmd.startsWith("bitsadmin") && /\/transfer/i.test(joined))) {
    findings.push({ rule: "windows-lolbin", level: "blocked", reason: "Uses a built-in Windows tool in a way malware commonly does to download and run code." });
  }

  // Things that start automatically.
  if (/LaunchAgents|LaunchDaemons/.test(all) || seg.writesTo.some((w) => /LaunchAgents|LaunchDaemons/.test(w)) || (seg.cmd === "crontab" && !a.includes("-l"))) {
    findings.push({ rule: "autostart", level: "ask", reason: "Makes something start automatically every time your Mac starts." });
  }

  // Normal changes that need a yes.
  if (seg.sudo) {
    findings.push({ rule: "admin", level: "ask", reason: "Needs your Mac password (administrator access) and can change system files." });
  }
  const installs: Record<string, (x: string[]) => boolean> = {
    brew: (x) => ["install", "reinstall", "upgrade", "uninstall", "remove", "rm", "tap", "untap", "link", "unlink", "services", "cleanup", "update"].includes(x[0] ?? ""),
    port: (x) => ["install", "uninstall", "upgrade"].includes(x[0] ?? ""),
    pip: (x) => ["install", "uninstall"].includes(x[0] ?? ""),
    pip3: (x) => ["install", "uninstall"].includes(x[0] ?? ""),
    npm: (x) => ["install", "i", "uninstall", "update"].includes(x[0] ?? ""),
    gem: (x) => ["install", "uninstall", "update"].includes(x[0] ?? ""),
    installer: () => true,
    softwareupdate: (x) => x.some((y) => ["-i", "--install", "-ia", "--all"].includes(y)),
    mas: (x) => ["install", "uninstall", "upgrade"].includes(x[0] ?? ""),
    cargo: (x) => x[0] === "install",
  };
  if (installs[seg.cmd]?.(a)) {
    findings.push({ rule: "installs-software", level: "ask", reason: "Installs, updates or removes software on your Mac." });
  }
}

/** Rules that look at how commands are joined together. */
function rulePipeline(pipeline: Segment[], subs: string[], findings: Finding[]): void {
  for (let i = 1; i < pipeline.length; i++) {
    const seg = pipeline[i];
    if (!runsStdin(seg)) continue;
    const before = pipeline.slice(0, i);
    const feederUrls = before.flatMap((s) => s.argv.flatMap(urlsIn));
    if (before.some((s) => DOWNLOADERS.has(s.cmd))) {
      findings.push(downloadAndRunFinding(feederUrls, `runs it with ${seg.cmd}`));
    } else if (before.some(isDecoder)) {
      findings.push({ rule: "decode-and-run", level: "blocked", reason: "Unscrambles hidden text and runs it as code. Real instructions never hide what they run." });
    } else {
      findings.push({ rule: "pipe-to-shell", level: "ask", reason: `Sends text into ${seg.cmd} to run as code.` });
    }
  }

  for (const seg of pipeline) {
    // bash -c "$(curl ...)", eval "$(curl ...)", sh <(curl ...)
    const inline = runsInlineCode(seg);
    const subWords = seg.argv.filter(isSubstitutionWord);
    const runsSub = (SHELLS.has(seg.cmd) || INTERPRETERS.has(seg.cmd) || seg.cmd === "eval" || seg.cmd === "source" || seg.cmd === ".") && subWords.length > 0;
    if (runsSub || (inline !== null && isSubstitutionWord(inline))) {
      const idx = subWords.flatMap(substitutionIndexes);
      const inner = idx.map((n) => subs[n] ?? "").join(" ");
      const innerParsed = parseCommand(inner);
      const innerSegs = innerParsed.pipelines.flat();
      if (innerSegs.some((s) => DOWNLOADERS.has(s.cmd))) {
        findings.push(downloadAndRunFinding(innerParsed.urls, `runs it with ${seg.cmd}`));
      } else if (innerSegs.some(isDecoder)) {
        findings.push({ rule: "decode-and-run", level: "blocked", reason: "Unscrambles hidden text and runs it as code. Real instructions never hide what they run." });
      } else {
        findings.push({ rule: "run-generated-code", level: "ask", reason: `Runs code that is built while the command runs, so you can't see it in advance.` });
      }
    } else if (inline !== null) {
      // bash -c 'some text': check the text as its own command.
      findings.push(...assessCommand(inline).findings);
      if (seg.cmd === "eval") findings.push({ rule: "eval", level: "ask", reason: "Uses eval, which runs text as code." });
    }
  }
}

/** Rules that look at the whole command line at once. */
function ruleWholeCommand(text: string, segs: Segment[], findings: Finding[], ctx: AssessContext): void {
  const downloadsFile = segs.some((s) => DOWNLOADERS.has(s.cmd) && s.argv.some((x) => ["-o", "-O", "--output", "--remote-name", "-P"].includes(x) || /^-[a-zA-Z]*[oO]$/.test(x)));
  const makesRunnable = segs.some((s) => s.cmd === "chmod" && s.argv.some((x) => /\+x|7[0-7][0-7]|5[0-7][0-7]/.test(x)));
  // "installer -pkg" runs the package's own scripts as administrator, so it counts as running the download.
  const opensOrRuns = segs.some((s) => s.cmd === "open" || s.cmd === "installer" || s.argv[0]?.startsWith("./") || s.argv[0]?.startsWith("/tmp/") || s.argv[0]?.startsWith("/private/tmp/"));
  const urls = urlsIn(text);
  if (downloadsFile && (makesRunnable || opensOrRuns)) {
    findings.push(downloadAndRunFinding(urls, "makes it runnable and starts it"));
  }

  // Where things are downloaded from.
  for (const url of urls) {
    const host = hostOf(url);
    if (!host) continue;
    const fetched = segs.some((s) => DOWNLOADERS.has(s.cmd));
    if (isSuspiciousHost(host)) {
      findings.push({ rule: "suspicious-host", level: fetched ? "blocked" : "ask", reason: `Uses ${host}, a link shortener, anonymous file host or raw IP address. Real companies don't ship software this way.` });
    } else if (fetched && url.startsWith("http://")) {
      findings.push({ rule: "insecure-download", level: "ask", reason: `Downloads over plain http, so the file could be swapped on the way.` });
    } else if (fetched && !isVendorHost(host) && !isTrustedInstaller(url) && !(ctx.pageHost && host.endsWith(ctx.pageHost.replace(/^www\./, "")))) {
      findings.push({ rule: "unknown-host", level: "ask", reason: `Downloads from ${host}, which isn't a company we recognize.` });
    }
  }

  // Long scrambled-looking text.
  if (/[A-Za-z0-9+/]{60,}={0,2}/.test(text)) {
    findings.push({ rule: "long-encoded-text", level: "ask", reason: "Contains a long block of scrambled text, which can hide what the command really does." });
  }
  if (/(\\x[0-9a-fA-F]{2}){4,}/.test(text)) {
    findings.push({ rule: "hex-escapes", level: "ask", reason: "Contains hidden characters written as codes (\\x..), which can hide what the command really does." });
  }
}

// ---------- Old commands and the wrong operating system ----------

const WINDOWS_CMDS = new Set(["powershell", "powershell.exe", "pwsh", "cmd", "cmd.exe", "reg", "reg.exe", "winget", "choco", "pnputil", "dism", "sfc", "msiexec", "ipconfig", "net", "netsh", "wmic", "certutil", "bitsadmin", "mshta", "regsvr32", "rundll32", "taskkill", "sc", "bcdedit", "start-process", "get-item", "set-executionpolicy"]);
const LINUX_CMDS = new Set(["apt", "apt-get", "yum", "dnf", "pacman", "zypper", "snap", "systemctl", "service", "update-grub", "modprobe", "lsmod", "dpkg", "rpm"]);

function detectPlatform(text: string, segs: Segment[]): Assessment["wrongPlatform"] {
  if (segs.some((s) => WINDOWS_CMDS.has(s.cmd) || s.cmd.endsWith(".exe") || s.cmd.endsWith(".bat") || s.cmd.endsWith(".ps1")) || /\b[A-Z]:\\/.test(text) || /^\s*Get-|Set-|New-Item/.test(text)) {
    return { platform: "windows", reason: "This command is for Windows, not a Mac." };
  }
  if (segs.some((s) => LINUX_CMDS.has(s.cmd))) {
    return { platform: "linux", reason: "This command is for Linux, not a Mac." };
  }
  return undefined;
}

function detectOutdated(segs: Segment[]): Assessment["outdated"] {
  for (const s of segs) {
    const a = s.argv.slice(1);
    if (s.cmd === "brew" && a[0] === "cask") {
      const sub = a[1] ?? "install";
      const rest = a.slice(2).join(" ");
      return { suggestion: `brew ${sub} --cask ${rest}`.trim(), reason: "\"brew cask\" was removed from Homebrew in 2020. The new form does the same thing." };
    }
    if (s.cmd === "brew" && a[0] === "tap" && /caskroom\/cask|homebrew\/cask$|homebrew\/cask-versions/.test(a[1] ?? "")) {
      return { suggestion: "", reason: "Not needed any more: apps (casks) are built into Homebrew now. This step can be skipped." };
    }
    if (s.cmd === "easy_install") {
      return { suggestion: `python3 -m pip install ${a.filter((x) => !x.startsWith("-")).join(" ")}`.trim(), reason: "easy_install was removed years ago. pip replaced it." };
    }
    if ((s.cmd === "python" || s.cmd === "python2") && s.argv[0] !== "python3") {
      return { suggestion: ["python3", ...a].join(" "), reason: "Macs no longer come with \"python\" (Python 2). Use python3." };
    }
    if (s.cmd === "pip" || s.cmd === "pip2") {
      return { suggestion: ["python3", "-m", "pip", ...a].join(" "), reason: "On a Mac, \"pip\" usually isn't there. \"python3 -m pip\" always works." };
    }
    if (s.cmd === "launchctl" && (a[0] === "load" || a[0] === "unload")) {
      return { suggestion: "", reason: "\"launchctl load/unload\" is old. It still works, but newer guides use \"launchctl bootstrap/bootout\"." };
    }
  }
  return undefined;
}

// ---------- Main entry points ----------

function finalize(findings: Finding[], readOnly: boolean, extra: Partial<Assessment>): Assessment {
  let level: RiskLevel = readOnly ? "safe" : "ask";
  for (const f of findings) level = stricter(level, f.level);
  if (!readOnly && !findings.some((f) => f.level !== "safe")) {
    findings.push({ rule: "changes-something", level: "ask", reason: "This command changes something on your Mac, so we'll ask before running it." });
  }
  // Remove repeated reasons.
  const seen = new Set<string>();
  const unique = findings.filter((f) => (seen.has(f.reason) ? false : (seen.add(f.reason), true)));
  return { level, findings: unique, readOnly, ...extra };
}

/** Rates one shell command. */
export function assessCommand(raw: string, ctx: AssessContext = {}): Assessment {
  const findings: Finding[] = [];
  if (hasInvisibleCharacters(raw)) {
    findings.push({ rule: "invisible-characters", level: "blocked", reason: "The command contains invisible characters. This is a trick to hide extra code inside something that looks harmless." });
  }
  const text = normalizeCommand(raw);
  if (!text) return { level: "safe", findings: [], readOnly: true };

  const parsed = parseCommand(text);
  const segs = parsed.pipelines.flat();
  if (segs.length === 0) {
    findings.push({ rule: "unreadable", level: "ask", reason: "We couldn't understand this command, so we'll ask before running it." });
    return finalize(findings, false, {});
  }

  // Substitutions run too, so check what's inside them.
  const subAssessments = parsed.substitutions.map((s) => assessCommand(s, ctx));
  for (const sub of subAssessments) findings.push(...sub.findings.filter((f) => f.rule !== "changes-something"));
  const subsReadOnly = subAssessments.every((s) => s.readOnly);

  for (const seg of segs) ruleSegment(seg, findings);
  for (const p of parsed.pipelines) rulePipeline(p, parsed.substitutions, findings);
  ruleWholeCommand(text, segs, findings, ctx);

  const readOnly = subsReadOnly && segs.every(segmentIsReadOnly) && !segs.some((s) => runsStdin(s) || runsInlineCode(s) !== null);
  const wrongPlatform = detectPlatform(text, segs);
  const outdated = detectOutdated(segs);
  return finalize(findings, readOnly, { wrongPlatform, outdated });
}

/** Rates a file download address. */
export function assessDownload(url: string, ctx: AssessContext = {}): Assessment {
  const findings: Finding[] = [];
  const host = hostOf(url);
  if (!host) {
    findings.push({ rule: "bad-url", level: "blocked", reason: "This isn't a valid web address." });
  } else if (isSuspiciousHost(host)) {
    findings.push({ rule: "suspicious-host", level: "blocked", reason: `${host} is a link shortener, anonymous file host or raw IP address. Real companies don't ship drivers or apps this way.` });
  } else if (!url.startsWith("https://")) {
    findings.push({ rule: "insecure-download", level: "blocked", reason: "The download isn't secure (no https), so the file could be swapped on the way." });
  } else if (isVendorHost(host) || (ctx.pageHost && host.endsWith(ctx.pageHost.replace(/^www\./, "")))) {
    findings.push({ rule: "vendor-download", level: "ask", reason: `Downloads a file from ${host}. We'll check the file's signature before you open it.` });
  } else {
    findings.push({ rule: "unknown-host", level: "ask", reason: `Downloads from ${host}, which isn't a company we recognize. We'll check the file's signature before you open it.` });
  }
  return finalize(findings, false, {});
}
