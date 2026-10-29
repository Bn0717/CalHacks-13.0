// Claude's structured output has limits on how complex an answer shape can be: at most 24 optional fields, and a size
// limit on the grammar it builds (a list of "one of these 7 kinds" objects, like a lesson's checks, goes past it).
// A whole lesson is past both. fitSchema makes such a shape simpler for the model, and restore() turns the answer back
// into the original shape, so callers and their Zod checks never notice:
//   1. "One of these kinds" objects become one flat object with every field, all required. Fields a kind doesn't use
//      are sent as "" (text) or -1 (numbers), and dropped again afterwards.
//   2. Text formats (like "uri") are left out: they make the grammar much bigger, and Zod checks them anyway.
//   3. If more than 24 optional fields are still left, the deepest simple ones become required the same way.
// Shapes that are already fine are sent unchanged. Pure: no model call.

export const MAX_OPTIONAL = 24;

type Json = Record<string, unknown>;

const SIMPLE = new Set(["string", "number", "integer", "boolean"]);
const UNUSED_NOTE = 'Send "" (or -1 for a number) when it doesn\'t apply.';

function isObj(x: unknown): x is Json {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

// ---------- Counting ----------

function walkObjects(schema: unknown, fn: (node: Json, depth: number) => void, depth = 0): void {
  if (Array.isArray(schema)) return schema.forEach((x) => walkObjects(x, fn, depth));
  if (!isObj(schema)) return;
  if (isObj(schema.properties)) fn(schema, depth);
  for (const [k, v] of Object.entries(schema)) walkObjects(v, fn, k === "properties" ? depth + 1 : depth);
}

// How many optional fields the shape has, counted the way the API counts them.
export function countOptional(schema: unknown): number {
  let n = 0;
  walkObjects(schema, (node) => {
    const required = new Set((node.required as string[] | undefined) ?? []);
    n += Object.keys(node.properties as Json).filter((k) => !required.has(k)).length;
  });
  return n;
}

// ---------- "One of these kinds" ----------

// The fixed value of a kind's `key` field ("type", "kind"…). The SDK moves `const` into the description ({const: "x"}).
function kindOf(variant: Json, key: string): string | undefined {
  const t = (variant.properties as Json | undefined)?.[key];
  if (!isObj(t)) return undefined;
  if (typeof t.const === "string") return t.const;
  if (Array.isArray(t.enum) && t.enum.length === 1 && typeof t.enum[0] === "string") return t.enum[0];
  const m = typeof t.description === "string" ? /\{const: "([^"]+)"\}/.exec(t.description) : null;
  return m?.[1];
}

type Kinds = { key: string; list: Json[] };

// A list of object kinds told apart by one field with a fixed value in each ("type", "kind"…).
function kindsOf(node: Json): Kinds | null {
  const list = node.anyOf;
  if (!Array.isArray(list) || list.length < 2 || !list.every((v) => isObj(v) && isObj(v.properties))) return null;
  const first = (list[0] as Json).properties as Json;
  const key = Object.keys(first).find((k) => (list as Json[]).every((v) => kindOf(v, k) !== undefined));
  return key ? { key, list: list as Json[] } : null;
}

function flatten({ key, list: kinds }: Kinds): Json {
  const kindOf_ = (v: Json) => kindOf(v, key)!;
  const props: Json = {};
  const usedBy = new Map<string, string[]>();
  for (const v of kinds) {
    for (const [k, p] of Object.entries(v.properties as Json)) {
      if (k === key) continue;
      if (!(k in props)) props[k] = { ...(p as Json) };
      usedBy.set(k, [...(usedBy.get(k) ?? []), kindOf_(v)]);
    }
  }
  for (const [k, p] of Object.entries(props)) {
    const users = usedBy.get(k)!;
    const which = users.length === kinds.length ? "" : `Only for: ${users.join(", ")}. `;
    const own = typeof (p as Json).description === "string" ? `${(p as Json).description} ` : "";
    props[k] = { ...(p as Json), description: `${own}${which}${UNUSED_NOTE}`.trim() };
  }
  const kindsText = kinds.map((v) => `${kindOf_(v)}${typeof v.description === "string" ? ` = ${v.description}` : ""}`).join("; ");
  return {
    type: "object",
    description: `One of these kinds, picked by "${key}": ${kindsText}`,
    properties: { [key]: { type: "string", enum: kinds.map(kindOf_) }, ...props },
    required: [key, ...Object.keys(props)],
    additionalProperties: false,
  };
}

function simplify(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(simplify);
  if (!isObj(node)) return node;
  const kinds = kindsOf(node);
  if (kinds) return flatten({ key: kinds.key, list: kinds.list.map((v) => simplify(v) as Json) });
  return Object.fromEntries(
    Object.entries(node)
      .filter(([k, v]) => !(k === "format" && typeof v === "string" && node.type === "string"))
      .map(([k, v]) => [k, simplify(v)]),
  );
}

// Makes the deepest simple optional fields required until at most `max` are left.
function requireExtras(schema: Json, max: number): void {
  const optional: { node: Json; key: string; depth: number; i: number }[] = [];
  walkObjects(schema, (node, depth) => {
    const required = new Set((node.required as string[] | undefined) ?? []);
    for (const key of Object.keys(node.properties as Json)) if (!required.has(key)) optional.push({ node, key, depth, i: optional.length });
  });
  let left = optional.length;
  const simple = optional.filter((o) => {
    const p = (o.node.properties as Json)[o.key];
    return isObj(p) && typeof p.type === "string" && SIMPLE.has(p.type);
  });
  simple.sort((a, b) => b.depth - a.depth || b.i - a.i);
  for (const o of simple) {
    if (left <= max) break;
    const p = (o.node.properties as Json)[o.key] as Json;
    p.description = `${typeof p.description === "string" ? `${p.description} ` : ""}${UNUSED_NOTE}`;
    o.node.required = [...((o.node.required as string[] | undefined) ?? []), o.key];
    left--;
  }
}

function needsFitting(schema: Json, max: number): boolean {
  let kinds = false;
  const look = (n: unknown): void => {
    if (kinds) return;
    if (Array.isArray(n)) return n.forEach(look);
    if (!isObj(n)) return;
    if (kindsOf(n)) kinds = true;
    else Object.values(n).forEach(look);
  };
  look(schema);
  return kinds || countOptional(schema) > max;
}

// ---------- Back to the original shape ----------

function unused(v: unknown): boolean {
  return v === "" || v === null || (typeof v === "number" && v < 0);
}

function restoreTo(value: unknown, original: unknown): unknown {
  if (!isObj(original)) return value;
  if (Array.isArray(value)) return isObj(original.items) ? value.map((x) => restoreTo(x, original.items)) : value;
  if (!isObj(value)) return value;
  const kinds = kindsOf(original);
  const shape = kinds ? kinds.list.find((v) => kindOf(v, kinds.key) === value[kinds.key]) : original;
  if (!shape || !isObj(shape.properties)) return value;
  const props = shape.properties as Json;
  const required = new Set((shape.required as string[] | undefined) ?? []);
  const out: Json = {};
  for (const [k, v] of Object.entries(value)) {
    if (!(k in props)) {
      if (!kinds) out[k] = v; // a field this kind doesn't have is dropped; anything else is left for Zod to judge
      continue;
    }
    if (!required.has(k) && unused(v)) continue;
    out[k] = restoreTo(v, props[k]);
  }
  return out;
}

// The shape to send, and how to turn an answer back. `changed` is false when the shape was sent as it is.
export function fitSchema(schema: Json, max = MAX_OPTIONAL): { schema: Json; changed: boolean; restore: (answer: unknown) => unknown } {
  if (!needsFitting(schema, max)) return { schema, changed: false, restore: (a) => a };
  const fitted = simplify(structuredClone(schema)) as Json;
  if (countOptional(fitted) > max) requireExtras(fitted, max);
  return { schema: fitted, changed: true, restore: (a) => restoreTo(a, schema) };
}
