// Downloads a file to a holding folder and checks who signed it before anyone opens it.
import { createHash } from "node:crypto";
import { createWriteStream, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { runNormally } from "./exec.js";

export const DOWNLOAD_FOLDER = join(homedir(), "Downloads", "CalHack");
const MAX_BYTES = 2 * 1024 * 1024 * 1024;

export interface SignatureCheck {
  signed: boolean;
  /** Who signed it, e.g. "Developer ID Installer: HP Inc. (ABCDE12345)". */
  signer?: string;
  /** True when Apple scanned it for malware (notarized). */
  notarized?: boolean;
  /** True when the signer's name matches the company whose site it came from. */
  signerMatchesSite?: boolean;
  /** One plain-English line for the user. */
  summary: string;
}

export interface DownloadResult {
  path: string;
  bytes: number;
  sha256: string;
  signature: SignatureCheck;
}

function fileNameFor(url: string, contentDisposition: string | null): string {
  const fromHeader = contentDisposition?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)?.[1];
  const raw = fromHeader ?? (basename(new URL(url).pathname) || "download");
  return decodeURIComponent(raw).replace(/[/\\:]/g, "_");
}

function uniquePath(folder: string, name: string): string {
  let path = join(folder, name);
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let n = 2; existsSync(path); n++) path = join(folder, `${stem} ${n}${ext}`);
  return path;
}

/** Company name hint from a host, e.g. "hp" from "ftp.hp.com". */
function companyFromHost(host: string): string {
  const parts = host.toLowerCase().split(".");
  return parts.length >= 2 ? parts[parts.length - 2] : parts[0];
}

export async function checkSignature(path: string, sourceUrl?: string): Promise<SignatureCheck> {
  const ext = extname(path).toLowerCase();
  let signer: string | undefined;
  let signed = false;
  let notarized: boolean | undefined;

  if (ext === ".pkg" || ext === ".mpkg") {
    const r = await runNormally(`pkgutil --check-signature ${JSON.stringify(path)}`, 60_000);
    signed = /Status: signed/i.test(r.output);
    notarized = /Notarization: trusted/i.test(r.output) || undefined;
    signer = r.output.match(/1\.\s+(.+)/)?.[1]?.trim();
  } else if (ext === ".dmg" || ext === ".app" || ext === ".zip") {
    const cs = await runNormally(`codesign -dv --verbose=2 ${JSON.stringify(path)} 2>&1`, 60_000);
    signer = cs.output.match(/Authority=(.+)/)?.[1]?.trim();
    signed = !!signer;
    const sp = await runNormally(`spctl -a -vv -t open --context context:primary-signature ${JSON.stringify(path)} 2>&1`, 60_000);
    notarized = /Notarized/i.test(sp.output) || undefined;
  } else {
    return { signed: false, summary: "This kind of file can't carry a signature, so we can't confirm who made it." };
  }

  let signerMatchesSite: boolean | undefined;
  if (signer && sourceUrl) {
    const company = companyFromHost(new URL(sourceUrl).hostname);
    signerMatchesSite = signer.toLowerCase().replace(/[^a-z0-9]/g, "").includes(company.replace(/[^a-z0-9]/g, ""));
  }

  let summary: string;
  if (!signed) summary = "Not signed. We can't confirm who made this file. Don't open it unless you trust where it came from.";
  else if (signerMatchesSite === false) summary = `Signed by "${signer}", which doesn't match the website it came from. Be careful.`;
  else summary = `Signed by "${signer}"${notarized ? " and checked by Apple for malware" : ""}.`;
  return { signed, signer, notarized, signerMatchesSite, summary };
}

export async function downloadAndVerify(url: string): Promise<DownloadResult> {
  mkdirSync(DOWNLOAD_FOLDER, { recursive: true });
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`The download failed (${res.status}).`);
  const finalUrl = res.url || url;
  if (!finalUrl.startsWith("https://")) throw new Error("The download was redirected to an insecure address, so we stopped.");
  const path = uniquePath(DOWNLOAD_FOLDER, fileNameFor(finalUrl, res.headers.get("content-disposition")));

  const hash = createHash("sha256");
  let bytes = 0;
  await pipeline(
    Readable.fromWeb(res.body as import("node:stream/web").ReadableStream),
    async function* (source: AsyncIterable<Buffer>) {
      for await (const chunk of source) {
        bytes += chunk.length;
        if (bytes > MAX_BYTES) throw new Error("The file is too big.");
        hash.update(chunk);
        yield chunk;
      }
    },
    createWriteStream(path),
  );
  const signature = await checkSignature(path, finalUrl);
  return { path, bytes, sha256: hash.digest("hex"), signature };
}
