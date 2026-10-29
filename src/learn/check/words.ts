// Turns the code words a check is written in (like "header h1", "color" or "href") into plain words a beginner understands,
// so the student reads "I can't see a big heading (<h1>) inside the page yet" and never a raw CSS selector.
// The tag itself stays in brackets, because that's what the student types.
import { parseSelector, UnsupportedSelector, type Complex, type Compound } from "./selector.js";

type Noun = { one: string; many: string };
const noun = (one: string, many = `${one}s`): Noun => ({ one, many });

const TAGS: Record<string, Noun> = {
  html: noun("page"),
  body: noun("page body", "page bodies"),
  head: noun("head part"),
  title: noun("page title"),
  meta: noun("page info line"),
  link: noun("link to a style file"),
  style: noun("style block"),
  script: noun("script"),
  h1: noun("big heading"),
  h2: noun("smaller heading"),
  h3: noun("small heading"),
  h4: noun("small heading"),
  h5: noun("small heading"),
  h6: noun("small heading"),
  p: noun("paragraph"),
  a: noun("link"),
  img: noun("picture"),
  ul: noun("bullet list"),
  ol: noun("numbered list"),
  li: noun("list item"),
  div: noun("box", "boxes"),
  span: noun("bit of text", "bits of text"),
  section: noun("section"),
  header: noun("header"),
  footer: noun("footer"),
  main: noun("main part"),
  nav: noun("menu"),
  article: noun("article"),
  aside: noun("side box", "side boxes"),
  button: noun("button"),
  form: noun("form"),
  input: noun("input box", "input boxes"),
  textarea: noun("big text box", "big text boxes"),
  label: noun("label"),
  select: noun("drop-down list"),
  option: noun("choice in a drop-down list", "choices in a drop-down list"),
  strong: noun("bold bit of text", "bold bits of text"),
  b: noun("bold bit of text", "bold bits of text"),
  em: noun("slanted bit of text", "slanted bits of text"),
  i: noun("slanted bit of text", "slanted bits of text"),
  br: noun("line break"),
  hr: noun("dividing line"),
  table: noun("table"),
  tr: noun("table row"),
  td: noun("table cell"),
  th: noun("table heading cell"),
  figure: noun("figure"),
  figcaption: noun("caption"),
  video: noun("video"),
  audio: noun("sound player"),
  iframe: noun("embedded page"),
  svg: noun("drawing"),
  blockquote: noun("quote"),
};

// What an attribute is for, for "needs ..." messages.
const ATTRS: Record<string, string> = {
  href: "an address to point to (href)",
  src: "a file to show (src)",
  alt: "a short description of the picture (alt)",
  rel: "a rel saying what kind of link it is",
  lang: "a lang saying which language the page is in",
  charset: "a charset",
  class: "a class name",
  id: "an id",
  type: "a type",
  placeholder: "grey example text (placeholder)",
  target: "a target saying where the link opens",
  title: "a title that shows when the mouse is over it",
  name: "a name",
  for: "a for saying which box it labels",
  value: "a value",
  content: "a content value",
  width: "a width",
  height: "a height",
};

// What a CSS property changes, for "doesn't have the right ... yet" messages.
const PROPS: Record<string, string> = {
  color: "text colour",
  background: "background",
  "background-color": "background colour",
  "background-image": "background picture",
  "font-family": "font",
  "font-size": "text size",
  "font-weight": "boldness",
  "font-style": "text style",
  "text-align": "text lining up (text-align)",
  "text-decoration": "underline (text-decoration)",
  "text-transform": "capital letters (text-transform)",
  "line-height": "space between lines (line-height)",
  "letter-spacing": "space between letters",
  margin: "space around the outside (margin)",
  padding: "space on the inside (padding)",
  border: "border",
  "border-radius": "rounded corners",
  "box-shadow": "shadow",
  width: "width",
  height: "height",
  "max-width": "largest width (max-width)",
  "min-height": "smallest height (min-height)",
  display: "layout (display)",
  "flex-direction": "direction of the row (flex-direction)",
  "flex-wrap": "wrapping onto new lines (flex-wrap)",
  "justify-content": "spacing along the row (justify-content)",
  "align-items": "lining up (align-items)",
  gap: "gap between items",
  "grid-template-columns": "columns (grid-template-columns)",
  position: "position",
  opacity: "see-through amount (opacity)",
  cursor: "mouse pointer",
  transition: "animation timing (transition)",
  transform: "movement or size change (transform)",
};

export function propertyWords(property: string): string {
  const p = property.trim().toLowerCase();
  if (PROPS[p]) return PROPS[p]!;
  const side = /^(margin|padding|border)-(top|right|bottom|left)$/.exec(p);
  if (side) return `${PROPS[side[1]!]} on the ${side[2]}`;
  return `${p} setting`;
}

export function attributeWords(name: string): string {
  return ATTRS[name.toLowerCase()] ?? `a ${name}`;
}

// A selector in words: "bare" has no "a"/"the" in front, so a message can say "a …", "the …" or "3 …".
export type Described = { bare: string; bareMany: string; article: "a" | "an" | "the" };

const FALLBACK: Described = { bare: "part of the page", bareMany: "parts of the page", article: "the" };

export function describeSelector(selector: string): Described {
  const hover = /:hover\b/.test(selector);
  // Things the words don't need: mouse-over and other states, ::before and the like.
  const plain = selector.replace(/::?[a-z-]+(\([^)]*\))?/gi, (m) => (/^:(first-child|last-child|nth-child)/i.test(m) ? m : ""));
  let list: Complex[];
  try {
    list = parseSelector(plain);
  } catch (e) {
    if (!(e instanceof UnsupportedSelector)) throw e;
    return FALLBACK;
  }
  const parts = list.map(complexWords);
  const join = (key: "bare" | "bareMany") => parts.map((p) => p[key]).join(" or ");
  const suffix = hover ? " when the mouse is over it" : "";
  return { bare: join("bare") + suffix, bareMany: join("bareMany") + suffix, article: parts[0]!.article };
}

export function withArticle(d: Described): string {
  return d.bare.startsWith("everything") ? d.bare : `${d.article} ${d.bare}`;
}

export function withThe(d: Described): string {
  return d.bare.startsWith("everything") ? d.bare : `the ${d.bare}`;
}

export function counted(d: Described, n: number): string {
  return `${n} ${n === 1 ? d.bare : d.bareMany}`;
}

function complexWords(c: Complex): Described {
  const target = c.compounds[c.compounds.length - 1]!;
  const containers = c.compounds.slice(0, -1).reverse();
  const own = compoundWords(target, true);
  // Only the nearest container that says something: "a link (<a>) inside the menu (<nav>)". <html> and <body> are "the page".
  const near = containers.find((k) => k.tag !== "html" && k.tag !== "body") ?? containers.find((k) => k.tag === "body" || k.tag === "html");
  let where = "";
  if (near) where = near.tag === "html" || (near.tag === "body" && !hasExtras(near)) ? " inside the page" : ` inside the ${compoundWords(near, false).bare}`;
  return { bare: own.bare + where, bareMany: own.bareMany + where, article: own.article };
}

function hasExtras(c: Compound): boolean {
  return c.id !== undefined || c.classes.length > 0 || c.attrs.length > 0 || c.pseudos.length > 0;
}

function compoundWords(c: Compound, isTarget: boolean): Described {
  const known = c.tag ? TAGS[c.tag] : undefined;
  let one: string;
  let many: string;
  if (c.tag === "body" && !isTarget) [one, many] = ["page", "pages"];
  else if (known) [one, many] = [`${known.one} (<${c.tag}>)`, `${known.many} (<${c.tag}>)`];
  else if (c.tag) [one, many] = [`<${c.tag}> part`, `<${c.tag}> parts`];
  else [one, many] = ["part", "parts"];

  const extras: string[] = [];
  if (c.id !== undefined) extras.push(`id="${c.id}"`);
  if (c.classes.length > 0) extras.push(`class="${c.classes.join(" ")}"`);
  for (const a of c.attrs) extras.push(a.value === undefined ? `${/^[aeiou]/i.test(a.name) ? "an" : "a"} ${a.name}` : `${a.name}="${a.value}"`);
  const tail = extras.length ? ` with ${extras.join(" and ")}` : "";

  let article: Described["article"] = /^[aeiou]/i.test(one) ? "an" : "a";
  let lead = "";
  const pseudo = c.pseudos[0];
  if (pseudo) {
    article = "the";
    lead = pseudo.kind === "nth" ? `${ordinal(pseudo.n)} ` : `${pseudo.kind} `;
  }
  if (c.id !== undefined || c.tag === "body" || c.tag === "html" || c.tag === "head" || c.tag === "title") article = "the";
  if (!c.tag && !hasExtras(c)) return { bare: "everything", bareMany: "everything", article: "the" };
  return { bare: `${lead}${one}${tail}`, bareMany: `${lead}${many}${tail}`, article };
}

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
}

// Starts a sentence with a capital letter.
export function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Words the student should never see in a message (B1 in docs/learn/GOAL.md).
export const JARGON = /\b(DOM|selectors?|pars(e|es|ed|ing|er)|runner|element tree|elements?|AST|syntax tree|node ?list)\b/i;
