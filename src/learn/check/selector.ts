// A small CSS selector matcher for parsed HTML (parse5), so most checks never need a browser.
// Supports: tag, *, #id, .class, [attr], [attr=value], descendant (space) and child (>) combinators, comma lists,
// :first-child, :last-child and :nth-child(n). Anything else throws UnsupportedSelector, and the checker asks the
// hidden browser instead.
import { allElements, type HtmlDocument, type HtmlElement } from "./parse.js";

export class UnsupportedSelector extends Error {
  constructor(selector: string) {
    super(`The quick checker can't read the selector "${selector}".`);
    this.name = "UnsupportedSelector";
  }
}

type AttrTest = { name: string; value?: string };
type Pseudo = { kind: "first" | "last" } | { kind: "nth"; n: number };
type Compound = { tag?: string; id?: string; classes: string[]; attrs: AttrTest[]; pseudos: Pseudo[] };
// Compounds left to right; combinators[i] joins compounds[i] and compounds[i + 1].
type Complex = { compounds: Compound[]; combinators: (" " | ">")[] };

const NAME = /^-?[_a-zA-Z][-_a-zA-Z0-9]*/;

// Turns "header h1, .card > p" into a list of parts to match. Throws UnsupportedSelector for anything unusual.
export function parseSelector(selector: string): Complex[] {
  const list: Complex[] = [];
  let rest = selector.trim();
  const fail = (): never => {
    throw new UnsupportedSelector(selector);
  };
  if (rest === "") fail();

  let current: Complex = { compounds: [], combinators: [] };
  let pending: " " | ">" | null = null;
  while (rest.length > 0) {
    const space = /^\s+/.exec(rest);
    if (space) {
      rest = rest.slice(space[0].length);
      if (current.compounds.length > 0 && pending === null) pending = " ";
      continue;
    }
    if (rest[0] === ">") {
      if (current.compounds.length === 0) fail();
      pending = ">";
      rest = rest.slice(1);
      continue;
    }
    if (rest[0] === ",") {
      if (current.compounds.length === 0 || pending === ">") fail();
      list.push(current);
      current = { compounds: [], combinators: [] };
      pending = null;
      rest = rest.slice(1);
      continue;
    }
    const [compound, after] = readCompound(rest, fail);
    if (current.compounds.length > 0) current.combinators.push(pending ?? fail());
    current.compounds.push(compound);
    pending = null;
    rest = after;
  }
  if (current.compounds.length === 0 || pending === ">") fail();
  list.push(current);
  return list;
}

function readCompound(text: string, fail: () => never): [Compound, string] {
  const c: Compound = { classes: [], attrs: [], pseudos: [] };
  let rest = text;
  let first = true;
  for (;;) {
    let m: RegExpExecArray | null;
    if (first && rest[0] === "*") {
      rest = rest.slice(1);
    } else if (first && (m = NAME.exec(rest))) {
      c.tag = m[0].toLowerCase();
      rest = rest.slice(m[0].length);
    } else if (rest[0] === "#" && (m = NAME.exec(rest.slice(1)))) {
      c.id = m[0];
      rest = rest.slice(1 + m[0].length);
    } else if (rest[0] === "." && (m = NAME.exec(rest.slice(1)))) {
      c.classes.push(m[0]);
      rest = rest.slice(1 + m[0].length);
    } else if (rest[0] === "[") {
      m = /^\[\s*([-_a-zA-Z0-9:]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([-_a-zA-Z0-9.\/:]+))\s*)?\]/.exec(rest);
      if (!m) fail();
      c.attrs.push({ name: m![1]!.toLowerCase(), value: m![2] ?? m![3] ?? m![4] });
      rest = rest.slice(m![0].length);
    } else if (rest[0] === ":") {
      m = /^:(first-child|last-child|nth-child\(\s*(\d+)\s*\))/.exec(rest);
      if (!m) fail();
      if (m![1] === "first-child") c.pseudos.push({ kind: "first" });
      else if (m![1] === "last-child") c.pseudos.push({ kind: "last" });
      else c.pseudos.push({ kind: "nth", n: Number(m![2]) });
      rest = rest.slice(m![0].length);
    } else break;
    first = false;
  }
  if (first) fail(); // nothing readable, e.g. "+" or "~"
  return [c, rest];
}

function attr(el: HtmlElement, name: string): string | undefined {
  return el.attrs.find((a) => a.name === name)?.value;
}

function elementSiblings(el: HtmlElement): HtmlElement[] {
  const parent = el.parentNode;
  if (!parent) return [el];
  return parent.childNodes.filter((n): n is HtmlElement => "tagName" in n);
}

function matchesCompound(el: HtmlElement, c: Compound): boolean {
  if (c.tag && el.tagName !== c.tag) return false;
  if (c.id !== undefined && attr(el, "id") !== c.id) return false;
  if (c.classes.length > 0) {
    const classes = (attr(el, "class") ?? "").split(/\s+/);
    if (!c.classes.every((k) => classes.includes(k))) return false;
  }
  for (const a of c.attrs) {
    const v = attr(el, a.name);
    if (v === undefined || (a.value !== undefined && v !== a.value)) return false;
  }
  for (const p of c.pseudos) {
    const sibs = elementSiblings(el);
    const i = sibs.indexOf(el);
    if (p.kind === "first" && i !== 0) return false;
    if (p.kind === "last" && i !== sibs.length - 1) return false;
    if (p.kind === "nth" && i !== p.n - 1) return false;
  }
  return true;
}

function parentElement(el: HtmlElement): HtmlElement | null {
  const p = el.parentNode;
  return p && "tagName" in p ? p : null;
}

// Matches right to left: the element must match the last part, then its ancestors the earlier parts.
function matchesComplex(el: HtmlElement, sel: Complex, index = sel.compounds.length - 1): boolean {
  if (!matchesCompound(el, sel.compounds[index]!)) return false;
  if (index === 0) return true;
  const combinator = sel.combinators[index - 1];
  let up = parentElement(el);
  if (combinator === ">") return up !== null && matchesComplex(up, sel, index - 1);
  while (up) {
    if (matchesComplex(up, sel, index - 1)) return true;
    up = parentElement(up);
  }
  return false;
}

// Every element matching the selector, in source order. Throws UnsupportedSelector for selectors it can't read.
export function querySelectorAll(doc: HtmlDocument, selector: string): HtmlElement[] {
  const parsed = parseSelector(selector);
  return allElements(doc).filter((el) => parsed.some((sel) => matchesComplex(el, sel)));
}

// The text inside an element, like the browser's textContent.
export function textOf(el: HtmlElement): string {
  let out = "";
  for (const child of el.childNodes) {
    if (child.nodeName === "#text") out += (child as { value: string }).value;
    else if ("tagName" in child) out += textOf(child);
  }
  return out;
}

export function attributeOf(el: HtmlElement, name: string): string | undefined {
  return attr(el, name.toLowerCase());
}
