// Gets exact text from a web page or a file, so commands are copied character for character.
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

/** Turns a web page into readable text, keeping code blocks intact. */
export function htmlToText(html: string): string {
  let body = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, "")
    .replace(/<(nav|footer|aside)\b[\s\S]*?<\/\1>/gi, "");
  // Hidden text can't be seen by the person, so it doesn't count as instructions.
  body = body.replace(/<([a-z0-9]+)\b(?=[^>]*(\shidden(?=[\s>=/])|style="[^"]*(display:\s*none|visibility:\s*hidden)))[^>]*>[\s\S]*?<\/\1>/gi, "");
  body = body
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|pre|tr|section|article|blockquote|ol|ul|table)>/gi, "\n")
    .replace(/<(li)\b[^>]*>/gi, "\n• ")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(body)
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function fetchPageText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Macintosh) CalHack/0.1" }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`The page didn't load (${res.status}).`);
  const type = res.headers.get("content-type") ?? "";
  const body = await res.text();
  return type.includes("html") || /<html|<body/i.test(body) ? htmlToText(body) : body;
}

async function pdfText(path: string): Promise<string> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await getDocument({ data: new Uint8Array(readFileSync(path)), useSystemFonts: true }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= Math.min(doc.numPages, 60); i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    let page = "";
    for (const item of content.items as { str?: string; hasEOL?: boolean }[]) {
      page += (item.str ?? "") + (item.hasEOL ? "\n" : "");
    }
    pages.push(page);
  }
  return pages.join("\n\n");
}

function textutil(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("/usr/bin/textutil", ["-convert", "txt", "-stdout", path], { timeout: 15_000, maxBuffer: 20 * 1024 * 1024 }, (err, out) =>
      err ? reject(err) : resolve(out.toString()),
    );
  });
}

/** Reads text from a PDF, Word, RTF, HTML or plain text file. */
export async function fileText(path: string): Promise<string> {
  const ext = extname(path).toLowerCase();
  if (ext === ".pdf") return pdfText(path);
  if ([".txt", ".md", ".sh", ".command", ".text"].includes(ext)) return readFileSync(path, "utf8");
  if ([".html", ".htm"].includes(ext)) return htmlToText(readFileSync(path, "utf8"));
  if ([".doc", ".docx", ".rtf", ".rtfd", ".odt", ".webarchive", ".pages"].includes(ext)) return textutil(path);
  throw new Error(`Can't read ${ext} files yet.`);
}
