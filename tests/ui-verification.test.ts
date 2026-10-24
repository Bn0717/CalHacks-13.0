import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

// A small DOM surface for exercising the real helper-bar renderer without Electron.
class Element {
  children: Element[] = [];
  parentNode: Element | null = null;
  attrs: Record<string, string> = {};
  dataset = {};
  className = "";
  value = "";
  hidden = false;
  offsetHeight = 0;
  offsetWidth = 0;
  scrollTop = 0;
  scrollHeight = 0;
  clientHeight = 0;
  style = { setProperty() {} };
  constructor(public tag: string, private text = "") {}
  get textContent(): string { return this.text + this.children.map((c) => c.textContent).join(""); }
  set textContent(value: string) { this.text = value; this.children = []; }
  get isConnected() { return !!this.parentNode; }
  classList = {
    contains: (name: string) => this.className.split(" ").includes(name),
    add: (name: string) => { if (!this.classList.contains(name)) this.className += ` ${name}`; },
    remove: (name: string) => { this.className = this.className.split(" ").filter((n) => n !== name).join(" "); },
    toggle: (name: string, on: boolean) => on ? this.classList.add(name) : this.classList.remove(name),
  };
  setAttribute(k: string, v: string) { this.attrs[k] = v; if (k === "class") this.className = v; }
  removeAttribute(k: string) { delete this.attrs[k]; }
  addEventListener() {}
  append(...nodes: (Element | string)[]) {
    for (const n of nodes) {
      const child = typeof n === "string" ? new Element("#text", n) : n;
      child.remove(); child.parentNode = this; this.children.push(child);
    }
  }
  replaceChildren(...nodes: (Element | string)[]) { for (const n of this.children) n.parentNode = null; this.children = []; this.text = ""; this.append(...nodes); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((n) => n !== this); this.parentNode = null; }
  after(node: Element) { this.parentNode?.append(node); }
  contains(node: Element | null): boolean { return node === this || this.children.some((c) => c.contains(node)); }
  querySelector(selector: string): Element | undefined { return this.all().find((e) => e.classList.contains(selector.slice(1))); }
  all(): Element[] { return this.children.flatMap((c) => [c, ...c.all()]); }
}

describe("helper-bar uncertainty rendering", () => {
  it("renders visible text and an accessible question mark instead of a success mark", () => {
    const root = new Element("document");
    const ids = new Map<string, Element>();
    const listeners = new Map<string, (s: unknown) => void>();
    const document = {
      getElementById(id: string) {
        if (!ids.has(id)) { const n = new Element("div"); ids.set(id, n); root.append(n); }
        return ids.get(id)!;
      },
      createElement: (tag: string) => new Element(tag),
      createElementNS: (_ns: string, tag: string) => new Element(tag),
      createTextNode: (text: string) => new Element("#text", text),
      addEventListener() {}, activeElement: null,
    };
    runInNewContext(readFileSync(new URL("../src/app/ui/bar.js", import.meta.url), "utf8"), {
      Node: Element, document,
      window: { calhack: { send() {}, on: (channel: string, handler: (s: unknown) => void) => listeners.set(channel, handler) }, matchMedia: () => ({ matches: true }), addEventListener() {} },
      localStorage: { getItem: () => null }, requestAnimationFrame: vi.fn(() => 1), setTimeout: vi.fn(() => 1), clearTimeout() {},
    });
    listeners.get("bar")!({ phase: "plan", goal: "Install app", steps: [{ id: "1", text: "Launch app", status: "unverified", note: "Ran, not verified" }], notes: [], okLabel: "Run", cancelLabel: "Cancel" });
    const row = ids.get("body")!.querySelector(".step")!;
    expect(row.textContent).toContain("Launch app");
    expect(row.textContent.match(/Ran, not verified/g)).toHaveLength(1);
    expect(row.querySelector(".unknown")?.attrs).toMatchObject({ role: "img", "aria-label": "Ran, not verified" });
    expect(row.querySelector(".ok")).toBeUndefined();
  });
});
