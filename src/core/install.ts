// Installs an app from its official installer, after our checks:
// the address was verified as the maker's own site (src/core/official.ts), the file is signed,
// and the signer is the same company. Every command here is built by our code, never by the AI.
// .pkg installers run with the macOS password box; .dmg apps are copied into Applications.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { checkSignature, downloadAndVerify, DOWNLOAD_FOLDER, type DownloadResult } from "./download.js";
import { runAsAdmin, runNormally, runSandboxed, type ExecResult } from "./exec.js";
import type { Evidence } from "./types.js";
import { runOutcomeCheck } from "./verification.js";

export interface InstallRequest {
  /** Direct installer address on the maker's own site (.pkg or .dmg). */
  url: string;
  /** The company, e.g. "Zoom". The file's signer must match it. */
  publisher: string;
  /** The app's name, e.g. "Zoom", to find it afterwards. */
  appName: string;
}

export interface InstallProgress {
  (stage: "download" | "check" | "install" | "verify", message: string): void;
}

export interface InstallResult {
  ok: boolean;
  /** Installation completed; retries must only recheck its outcome. */
  actionCompleted?: boolean;
  /** One plain line, e.g. "Zoom is installed." or why it stopped. */
  message: string;
  appPath?: string;
  signer?: string;
  evidence: Evidence[];
}

export interface InstallDeps {
  download(url: string): Promise<DownloadResult>;
  admin(command: string): Promise<ExecResult>;
  normal(command: string): Promise<ExecResult>;
  sandboxed(command: string): Promise<ExecResult>;
  stagePackage(path: string): { path: string; cleanup(): void };
  apps(): Map<string, number>; // app bundle path → modified time
}

/**
 * Official "latest version" installer links that makers publish on their own sites.
 * Used when Droid finds the official download page but not a direct link. Still checked by checkOfficial
 * and by the file's signature.
 */
const KNOWN_INSTALLERS: Record<string, { url: string; publisher: string; appName: string }> = {
  zoom: { url: "https://zoom.us/client/latest/Zoom.pkg", publisher: "Zoom", appName: "Zoom" },
  "google chrome": { url: "https://dl.google.com/chrome/mac/universal/stable/GGRO/googlechrome.dmg", publisher: "Google", appName: "Google Chrome" },
  chrome: { url: "https://dl.google.com/chrome/mac/universal/stable/GGRO/googlechrome.dmg", publisher: "Google", appName: "Google Chrome" },
};

export function knownInstaller(appName: string): { url: string; publisher: string; appName: string } | null {
  return KNOWN_INSTALLERS[appName.trim().toLowerCase()] ?? null;
}

/** Where saved installers live for demos without internet. The file must still pass the signature check. */
export const INSTALLER_CACHE = () => process.env.CALHACK_INSTALLER_CACHE ?? join(process.env.CALHACK_ROOT ?? process.cwd(), "demo", "installers");

function q(text: string): string {
  return "'" + text.replace(/'/g, "'\\''") + "'";
}

function tail(output: string): string {
  return output.trim().split("\n").slice(-6).join("\n");
}

/** Use a saved copy of the installer when there is one (same file name), otherwise download it. */
async function downloadOrCached(url: string): Promise<DownloadResult> {
  const name = basename(new URL(url).pathname);
  const saved = name ? join(INSTALLER_CACHE(), name) : "";
  if (saved && existsSync(saved)) {
    mkdirSync(DOWNLOAD_FOLDER, { recursive: true });
    const path = join(DOWNLOAD_FOLDER, name);
    copyFileSync(saved, path);
    return { path, bytes: statSync(path).size, sha256: "", signature: await checkSignature(path, url) };
  }
  return downloadAndVerify(url);
}

function listApps(): Map<string, number> {
  const out = new Map<string, number>();
  for (const dir of ["/Applications"]) {
    try {
      for (const f of readdirSync(dir)) if (f.endsWith(".app")) out.set(join(dir, f), statSync(join(dir, f)).mtimeMs);
    } catch {
      // Not readable: skip.
    }
  }
  return out;
}

/** Administrator processes may not have access to the user's protected Downloads folder. */
export function stagePackage(path: string): { path: string; cleanup(): void } {
  const dir = mkdtempSync(join(tmpdir(), "calhack-install-"));
  const staged = join(dir, "installer.pkg");
  try {
    copyFileSync(path, staged);
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  return { path: staged, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export const realInstallDeps: InstallDeps = {
  stagePackage,
  download: downloadOrCached,
  admin: (c) => runAsAdmin(c, 15 * 60_000),
  normal: (c) => runNormally(c, 15 * 60_000),
  sandboxed: (c) => runSandboxed(c),
  apps: listApps,
};

/** Letters and digits only, lower case: "Zoom Video Communications, Inc." → "zoomvideocommunicationsinc". */
function squash(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** The signer must name the publisher, e.g. "Developer ID Installer: Zoom Video Communications, Inc." for "Zoom". */
export function signerMatches(signer: string | undefined, publisher: string): boolean {
  if (!signer) return false;
  const p = squash(publisher);
  return p.length >= 2 && squash(signer).includes(p);
}

/** The app that appeared or changed in /Applications, preferring one whose name matches. */
export function findInstalledApp(before: Map<string, number>, after: Map<string, number>, appName: string): string | null {
  const changed = [...after].filter(([path, t]) => !before.has(path) || before.get(path)! < t).map(([path]) => path);
  const want = squash(appName);
  const byName = (paths: string[]) => paths.find((p) => squash(basename(p, ".app")).includes(want)) ?? null;
  return byName(changed) ?? changed[0] ?? byName([...after.keys()]);
}

export async function installFromOfficial(req: InstallRequest, onProgress: InstallProgress = () => {}, deps: InstallDeps = realInstallDeps, previous?: InstallResult): Promise<InstallResult> {
  if (previous?.actionCompleted) return verifyInstallation(req, deps.apps(), [...previous.evidence], previous.signer, onProgress, deps, previous.appPath);
  const evidence: Evidence[] = [];
  const lower = new URL(req.url).pathname.toLowerCase();
  const kind = lower.endsWith(".pkg") ? "pkg" : lower.endsWith(".dmg") ? "dmg" : null;
  if (!kind) return { ok: false, message: "That isn't an installer file we know how to use.", evidence };

  // 1. Download (or use the saved copy), then check who signed it.
  onProgress("download", `Downloading ${req.appName} from ${new URL(req.url).hostname}…`);
  let dl: DownloadResult;
  try {
    dl = await deps.download(req.url);
  } catch (error) {
    return { ok: false, message: `The download didn't work: ${(error as Error).message}`, evidence };
  }
  onProgress("check", `Checking the file really comes from ${req.publisher}…`);
  const sig = dl.signature;
  evidence.push({ kind: "run", command: kind === "pkg" ? `pkgutil --check-signature ${q(dl.path)}` : `codesign -dv ${q(dl.path)}`, code: sig.signed ? 0 : 1, output: sig.summary });
  if (!sig.signed) return { ok: false, message: `I stopped: the file isn't signed, so I can't confirm it's from ${req.publisher}.`, evidence };
  if (!signerMatches(sig.signer, req.publisher)) {
    return { ok: false, message: `I stopped: the file is signed by "${sig.signer}", not ${req.publisher}.`, evidence, signer: sig.signer };
  }

  // 2. Install.
  const before = deps.apps();
  onProgress("install", kind === "pkg" ? "Installing. Your Mac will ask for your password." : `Copying ${req.appName} into Applications…`);
  if (kind === "pkg") {
    let staged: ReturnType<InstallDeps["stagePackage"]>;
    try {
      staged = deps.stagePackage(dl.path);
    } catch (error) {
      return { ok: false, message: `I couldn't prepare the installer: ${(error as Error).message}`, evidence, signer: sig.signer };
    }
    try {
      const command = `/usr/sbin/installer -pkg ${q(staged.path)} -target /`;
      const r = await deps.admin(command);
      evidence.push({ kind: "run", command: "sudo " + command, code: r.code, output: tail(r.output) });
      if (r.code !== 0) {
        if (/User cancell?ed|-128\)/i.test(r.output)) return { ok: false, message: "You cancelled the password box, so nothing was installed.", evidence, signer: sig.signer };
        return { ok: false, message: "The installer didn't finish.", evidence, signer: sig.signer };
      }
    } finally {
      staged.cleanup();
    }
  } else {
    const mount = join(tmpdir(), `calhack-dmg-${Date.now()}`);
    const attach = `hdiutil attach -nobrowse -readonly -mountpoint ${q(mount)} ${q(dl.path)}`;
    const a = await deps.normal(attach);
    evidence.push({ kind: "run", command: attach, code: a.code, output: tail(a.output) });
    if (a.code !== 0) return { ok: false, message: "I couldn't open the disk image.", evidence, signer: sig.signer };
    try {
      const app = readdirSync(mount).find((f) => f.endsWith(".app"));
      if (!app) return { ok: false, message: "There's no app inside the disk image.", evidence, signer: sig.signer };
      // The app inside must be signed by the same company too.
      const inner = await checkSignature(join(mount, app));
      if (!signerMatches(inner.signer, req.publisher)) return { ok: false, message: `I stopped: the app inside is signed by "${inner.signer ?? "nobody"}", not ${req.publisher}.`, evidence, signer: sig.signer };
      const copy = `ditto ${q(join(mount, app))} ${q(join("/Applications", app))}`;
      const c = await deps.normal(copy);
      evidence.push({ kind: "run", command: copy, code: c.code, output: tail(c.output) });
      if (c.code !== 0) return { ok: false, message: `I couldn't copy ${req.appName} into Applications.`, evidence, signer: sig.signer };
    } finally {
      await deps.normal(`hdiutil detach ${q(mount)} -quiet`);
    }
  }

  return verifyInstallation(req, before, evidence, sig.signer, onProgress, deps);
}

/** Read-only, and safe to repeat after an installer finished without conclusive proof. */
async function verifyInstallation(req: InstallRequest, before: Map<string, number>, evidence: Evidence[], signer: string | undefined, onProgress: InstallProgress, deps: InstallDeps, knownPath?: string): Promise<InstallResult> {
  onProgress("verify", `Checking ${req.appName} is installed…`);
  const appPath = knownPath ?? findInstalledApp(before, deps.apps(), req.appName);
  if (!appPath) return { ok: false, actionCompleted: true, message: `The installer finished, but I can't find ${req.appName} in Applications.`, evidence, signer };
  const there = await runOutcomeCheck(`test -d ${q(appPath)}`, "after", deps.sandboxed);
  there.checkId = "app-present";
  const signature = await runOutcomeCheck(`codesign --verify ${q(appPath)}`, "after", deps.sandboxed);
  signature.checkId = "app-signature";
  evidence.push(there, signature);
  const ok = there.outcome === "passed" && signature.outcome === "passed";
  const message = there.outcome !== "passed" ? `The installer finished; I couldn't verify ${req.appName} is in Applications.`
    : signature.outcome !== "passed" ? `${req.appName} is present, but its installed signature could not be verified.`
    : `${req.appName} is installed and its signature checks out.`;
  return { ok, actionCompleted: true, message, appPath, signer, evidence };
}
