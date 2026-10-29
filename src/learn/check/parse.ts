// Level 1 of the checker: read the student's files with real parsers (parse5, css-tree, acorn) and spot half-typed code.
// Everything here is pure and instant: no browser, no model.
import { parse as parseJs } from "acorn";
import * as csstree from "css-tree";
import { parse as parseHtml, type DefaultTreeAdapterTypes } from "parse5";

export type HtmlDocument = DefaultTreeAdapterTypes.Document;
export type HtmlElement = DefaultTreeAdapterTypes.Element;

// What's wrong with a file that doesn't parse, in plain words, and where.
// mistake: a real slip, not half-typed code (e.g. "<h1>Hi<h1>", where the second <h1> swallows the lines after it).
export type ParseProblem = { message: string; line?: number; mistake?: boolean };

export type FileKind = "html" | "css" | "js" | "other";

export function fileKind(path: string): FileKind {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  if (ext === "html" || ext === "htm") return "html";
  if (ext === "css") return "css";
  if (ext === "js" || ext === "mjs" || ext === "cjs") return "js";
  return "other";
}

// Tags that never have a closing tag, and tags whose closing tag HTML lets you leave out.
const VOID = new Set("area base br col embed hr img input link meta source track wbr".split(" "));
const OPTIONAL_END = new Set("html head body p li dt dd option optgroup tr td th thead tbody tfoot colgroup caption rb rt rtc rp".split(" "));

// parse5 problems that mean "the student is still typing" (it shrugs off most other mistakes, like browsers do).
const FATAL_HTML = new Set([
  "eof-in-tag",
  "eof-in-comment",
  "eof-in-doctype",
  "eof-in-cdata",
  "eof-in-script-html-comment-like-text",
  "eof-before-tag-name",
  "unexpected-character-in-attribute-name", // e.g. "<p" typed with the next tag right after it
]);

export type ParsedHtml = { doc: HtmlDocument; problem?: ParseProblem };

// Parses HTML and reports the first sign of half-typed code: a tag cut off at the end, or an element never closed.
export function readHtml(source: string): ParsedHtml {
  let fatal: ParseProblem | undefined;
  const doc = parseHtml(source, {
    sourceCodeLocationInfo: true,
    onParseError: (e) => {
      // The line where the unfinished tag starts (the parser may only notice on a later line).
      if (!fatal && FATAL_HTML.has(e.code)) fatal = { message: "A tag isn't finished yet.", line: tagStartLine(source, e.startOffset, e.startLine) };
    },
  });
  return { doc, problem: fatal ?? unclosedElement(doc) };
}

// The line of the last "<" at or before `offset`: where the tag the parser stopped in began.
function tagStartLine(source: string, offset: number, fallback: number): number {
  // (Search from just before the error: the error itself can sit on the next tag's "<".)
  const at = source.lastIndexOf("<", Math.min(offset - 1, source.length - 1));
  return at < 0 ? fallback : source.slice(0, at).split("\n").length;
}

// Tags that only hold words, never whole blocks like paragraphs or lists.
const WORDS_ONLY = new Set("h1 h2 h3 h4 h5 h6 span a strong em b i label button title small".split(" "));
const BLOCKS = new Set("p ul ol li div section header footer main nav article aside h1 h2 h3 h4 h5 h6 table form figure blockquote".split(" "));

// The first element the student opened but never closed, e.g. a <ul> with no </ul>.
// An unclosed heading (or another words-only tag) that swallowed whole blocks after it is a slip, not half-typed code.
function unclosedElement(doc: HtmlDocument): ParseProblem | undefined {
  // "<h1>Hi<h1>" leaves two unclosed headings: the first holds only "Hi", the second swallows the lines after it.
  const unclosed = allElements(doc).filter((el) => {
    const loc = el.sourceCodeLocation;
    if (!loc?.startTag || loc.endTag || VOID.has(el.tagName) || OPTIONAL_END.has(el.tagName)) return false;
    return el.namespaceURI === "http://www.w3.org/1999/xhtml"; // self-closing SVG bits are fine
  });
  if (unclosed.length === 0) return undefined;
  const swallower = unclosed.find((el) => WORDS_ONLY.has(el.tagName) && allElements(el).some((child) => BLOCKS.has(child.tagName)));
  const el = unclosed.find((e) => swallower && e.tagName === swallower.tagName) ?? unclosed[0]!;
  return {
    message: `The <${el.tagName}> you started still needs its closing </${el.tagName}>.`,
    line: el.sourceCodeLocation!.startTag!.startLine,
    ...(swallower ? { mistake: true } : {}),
  };
}

// Tags typed with some closing tags but not enough, e.g. "<li>Drawing<li>" next to closed list items gives
// [{ tag: "li", missing: 1 }]. HTML lets <li> and <p> go unclosed, so the parser alone doesn't notice.
export function missingClosers(source: string): { tag: string; missing: number; line?: number }[] {
  const code = source.replace(/<!--[\s\S]*?(-->|$)/g, "").replace(/<(script|style)\b[\s\S]*?(<\/\1\s*>|$)/gi, "");
  const opens = new Map<string, number>();
  const closes = new Map<string, number>();
  for (const m of code.matchAll(/<(\/?)([a-z][a-z0-9-]*)\b[^>]*>/gi)) {
    const tag = m[2]!.toLowerCase();
    if (VOID.has(tag) || m[0].endsWith("/>")) continue;
    const map = m[1] ? closes : opens;
    map.set(tag, (map.get(tag) ?? 0) + 1);
  }
  // The usual slip: "<li>Drawing<li>", a start tag typed where the closing tag should be, at the end of a line.
  const swapped = new Map<string, { count: number; line: number }>();
  source.split("\n").forEach((text, i) => {
    const m = /<([a-z][a-z0-9-]*)\b[^>]*>[^<]+<\1>\s*$/i.exec(text);
    if (!m) return;
    const tag = m[1]!.toLowerCase();
    const seen = swapped.get(tag);
    swapped.set(tag, { count: (seen?.count ?? 0) + 1, line: seen?.line ?? i + 1 });
  });
  const out: { tag: string; missing: number; line?: number }[] = [];
  for (const [tag, open] of opens) {
    const close = closes.get(tag) ?? 0;
    const swap = swapped.get(tag);
    if (swap && !VOID.has(tag)) out.push({ tag, missing: swap.count, line: swap.line });
    else if (close > 0 && open > close && !["html", "head", "body"].includes(tag)) out.push({ tag, missing: open - close });
  }
  return out;
}

// Every element in the document, in source order.
export function allElements(root: DefaultTreeAdapterTypes.ParentNode): HtmlElement[] {
  const out: HtmlElement[] = [];
  const walk = (node: DefaultTreeAdapterTypes.ParentNode) => {
    for (const child of node.childNodes) {
      if ("tagName" in child) {
        out.push(child);
        walk(child);
      }
    }
  };
  walk(root);
  return out;
}

// Parses CSS. css-tree forgives a missing "}" or an empty value, so those are checked by hand.
export function cssProblem(source: string): ParseProblem | undefined {
  const braces = braceProblem(source);
  if (braces) return braces;
  let problem: ParseProblem | undefined;
  let ast: csstree.CssNode;
  try {
    ast = csstree.parse(source, {
      positions: true,
      onParseError: (e: { message: string; line?: number }) => {
        if (!problem) problem = { message: "This CSS isn't finished yet.", line: e.line };
      },
    });
  } catch {
    return { message: "This CSS isn't finished yet." };
  }
  if (problem) return problem;
  csstree.walk(ast, (node) => {
    if (problem || node.type !== "Declaration") return;
    const value = node.value.type === "Raw" ? node.value.value.trim() : csstree.generate(node.value).trim();
    if (value === "") problem = { message: `"${node.property}:" still needs a value after it.`, line: node.loc?.start.line };
  });
  return problem;
}

// Checks every "{" has its "}" (skipping comments and strings).
function braceProblem(source: string): ParseProblem | undefined {
  const open: number[] = [];
  let line = 1;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === "\n") line++;
    else if (c === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      if (end < 0) return { message: "A comment isn't closed with */ yet.", line };
      for (let j = i; j < end; j++) if (source[j] === "\n") line++;
      i = end + 1;
    } else if (c === '"' || c === "'") {
      const end = source.indexOf(c, i + 1);
      if (end < 0) return { message: "A quote isn't closed yet.", line };
      i = end;
    } else if (c === "{") open.push(line);
    else if (c === "}") {
      if (open.length === 0) return { message: "There's an extra }.", line };
      open.pop();
    }
  }
  if (open.length > 0) return { message: "A { isn't closed with } yet.", line: open[open.length - 1] };
  return undefined;
}

// Parses JavaScript as a normal script first, then as a module (for import/export).
export function jsProblem(source: string): ParseProblem | undefined {
  try {
    parseJs(source, { ecmaVersion: "latest", sourceType: "script" });
    return undefined;
  } catch {
    try {
      parseJs(source, { ecmaVersion: "latest", sourceType: "module" });
      return undefined;
    } catch (e) {
      const loc = (e as { loc?: { line: number } }).loc;
      return { message: "This JavaScript isn't finished yet.", line: loc?.line };
    }
  }
}

// Any file: what's wrong, or nothing if it parses. Unknown file types always "parse".
export function parseProblem(path: string, source: string): ParseProblem | undefined {
  const kind = fileKind(path);
  if (kind === "html") return readHtml(source).problem;
  if (kind === "css") return cssProblem(source);
  if (kind === "js") return jsProblem(source);
  return undefined;
}
