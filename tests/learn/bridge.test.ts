import { mkdtempSync, readFileSync, rmSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { Connection } from "../../extensions/vscode/src/connection";
import { Bridge, CLOSE, type EditorEvent } from "../../src/learn/bridge.js";

// A real ws client talking to the real server on 127.0.0.1, standing in for the VS Code helper.
class FakeHelper {
  readonly received: unknown[] = [];
  closed: { code: number; reason: string } | undefined;
  private constructor(readonly socket: WebSocket) {
    socket.on("message", (raw) => this.received.push(JSON.parse(raw.toString())));
    socket.on("close", (code, reason) => (this.closed = { code, reason: reason.toString() }));
  }

  static async connect(port: number, headers: Record<string, string> = {}): Promise<FakeHelper> {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`, { headers });
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });
    return new FakeHelper(socket);
  }

  send(message: unknown): void {
    this.socket.send(typeof message === "string" ? message : JSON.stringify(message));
  }

  hello(token: string): void {
    this.send({ type: "hello", token, client: "vscode", protocol: 1, folders: ["/Users/sam/bakery"] });
  }

  waitClosed(): Promise<{ code: number; reason: string }> {
    if (this.closed) return Promise.resolve(this.closed);
    return new Promise((resolve) => this.socket.once("close", (code, reason) => resolve({ code, reason: reason.toString() })));
  }

  async waitFor(type: string): Promise<Record<string, unknown>> {
    for (let i = 0; i < 200; i++) {
      const found = this.received.find((m) => (m as { type: string }).type === type);
      if (found) return found as Record<string, unknown>;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error(`no ${type} message`);
  }
}

function next<K extends "connected" | "event" | "ignored" | "disconnected">(bridge: Bridge, name: K): Promise<unknown> {
  return new Promise((resolve) => bridge.once(name, ((value: unknown) => resolve(value)) as never));
}

let dir: string;
let bridge: Bridge;
const helpers: FakeHelper[] = [];

async function helper(headers?: Record<string, string>): Promise<FakeHelper> {
  const h = await FakeHelper.connect(bridge.port, headers);
  helpers.push(h);
  return h;
}

async function connectedHelper(): Promise<FakeHelper> {
  const h = await helper();
  const connected = next(bridge, "connected");
  h.hello(bridge.token);
  await connected;
  await h.waitFor("welcome");
  return h;
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "stride-bridge-"));
  bridge = new Bridge({ dir: join(dir, "Stride"), helloTimeoutMs: 200 });
  await bridge.start();
});

afterEach(async () => {
  for (const h of helpers.splice(0)) h.socket.terminate();
  await bridge.stop();
  rmSync(dir, { recursive: true, force: true });
});

describe("bridge.json", () => {
  it("is written with the port and a random token, readable by this user only", () => {
    const file = join(dir, "Stride", "bridge.json");
    const content = JSON.parse(readFileSync(file, "utf8"));
    expect(content).toMatchObject({ port: bridge.port, token: bridge.token, protocol: 1, pid: process.pid });
    expect(bridge.token).toMatch(/^[0-9a-f]{64}$/);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("gets a new token each start, and is removed on stop", async () => {
    const other = new Bridge({ dir: join(dir, "Other") });
    await other.start();
    expect(other.token).not.toBe(bridge.token);
    expect(other.port).not.toBe(bridge.port);
    await other.stop();
    expect(existsSync(join(dir, "Other", "bridge.json"))).toBe(false);
  });
});

describe("token check", () => {
  it("accepts the right token and says welcome", async () => {
    const h = await helper();
    const connected = next(bridge, "connected");
    h.hello(bridge.token);
    expect(await connected).toMatchObject({ client: "vscode", folders: ["/Users/sam/bakery"] });
    expect(await h.waitFor("welcome")).toEqual({ type: "welcome", protocol: 1 });
    expect(bridge.connected).toBe(true);
  });

  it("closes the connection on a wrong token", async () => {
    const h = await helper();
    h.hello("0".repeat(64));
    expect((await h.waitClosed()).code).toBe(CLOSE.badToken);
    expect(bridge.connected).toBe(false);
    expect(h.received).toEqual([]);
  });

  it("closes the connection when the first message isn't a hello", async () => {
    const h = await helper();
    h.send({ type: "change", path: "/a.html", text: "", version: 1 });
    expect((await h.waitClosed()).code).toBe(CLOSE.badHello);
  });

  it("closes the connection when no hello comes in time", async () => {
    const h = await helper();
    expect((await h.waitClosed()).code).toBe(CLOSE.badHello);
  });

  it("refuses connections from a web page (Origin header)", async () => {
    const ignored = next(bridge, "ignored");
    await expect(FakeHelper.connect(bridge.port, { Origin: "https://evil.example" })).rejects.toThrow();
    expect(await ignored).toMatch(/web page/);
  });

  it("lets a newer helper replace the old one", async () => {
    const first = await connectedHelper();
    await connectedHelper();
    expect((await first.waitClosed()).code).toBe(CLOSE.replaced);
    expect(bridge.connected).toBe(true);
  });
});

describe("events from the helper", () => {
  it("passes on valid events, typed by name", async () => {
    const h = await connectedHelper();
    const changes: EditorEvent[] = [];
    const diagnostics: EditorEvent[] = [];
    bridge.on("change", (e) => changes.push(e));
    bridge.on("diagnostics", (e) => diagnostics.push(e));
    const all: EditorEvent[] = [];
    bridge.on("event", (e) => all.push(e));

    h.send({ type: "change", path: "/Users/sam/bakery/index.html", text: "<h1>Hi</h1>", version: 3 });
    h.send({
      type: "diagnostics",
      path: "/Users/sam/bakery/style.css",
      items: [{ severity: "error", message: "} expected", line: 4, column: 1, endLine: 4, endColumn: 2, source: "css" }],
    });
    h.send({ type: "cursor", path: "/Users/sam/bakery/index.html", line: 2, column: 5 });
    h.send({ type: "active", path: null });
    h.send({ type: "save", path: "/Users/sam/bakery/index.html", text: "<h1>Hi</h1>", version: 3 });

    await waitUntil(() => all.length === 5);
    expect(changes).toEqual([{ type: "change", path: "/Users/sam/bakery/index.html", text: "<h1>Hi</h1>", version: 3 }]);
    expect(diagnostics).toHaveLength(1);
    expect(all.map((e) => e.type)).toEqual(["change", "diagnostics", "cursor", "active", "save"]);
  });

  it("ignores invalid messages and keeps the connection open", async () => {
    const h = await connectedHelper();
    const ignored: string[] = [];
    bridge.on("ignored", (r) => ignored.push(r));
    const all: EditorEvent[] = [];
    bridge.on("event", (e) => all.push(e));

    h.send("not json");
    h.send({ type: "runShell", command: "rm -rf ~" });
    h.send({ type: "change", path: "/a.html", version: 1 }); // no text
    h.send({ type: "cursor", path: "/a.html", line: 0, column: 1 }); // lines start at 1
    h.send({ type: "hello", token: bridge.token, client: "vscode", protocol: 1 }); // a second hello
    h.send({ type: "active", path: "/a.html" });

    await waitUntil(() => all.length === 1);
    expect(all).toEqual([{ type: "active", path: "/a.html" }]);
    expect(ignored).toHaveLength(5);
    expect(h.closed).toBeUndefined();
  });

  it("says when the helper goes away", async () => {
    const h = await connectedHelper();
    const gone = next(bridge, "disconnected");
    h.socket.close();
    await gone;
    expect(bridge.connected).toBe(false);
  });
});

describe("commands to the helper", () => {
  it("sends the four commands", async () => {
    const h = await connectedHelper();
    expect(bridge.send({ type: "highlight", path: "/a.html", startLine: 3, endLine: 5, message: "Add your title here" })).toBe(true);
    expect(bridge.send({ type: "clearHighlight" })).toBe(true);
    expect(bridge.send({ type: "insert", path: "/a.html", text: "<p>Hi</p>\n", anchor: { afterLine: 4 } })).toBe(true);
    expect(bridge.send({ type: "openFile", path: "/a.html", line: 2 })).toBe(true);
    await waitUntil(() => h.received.length === 5);
    expect(h.received.slice(1).map((m) => (m as { type: string }).type)).toEqual(["highlight", "clearHighlight", "insert", "openFile"]);
  });

  it("refuses to send anything that isn't one of the four commands", async () => {
    await connectedHelper();
    expect(() => bridge.send({ type: "runShell" } as never)).toThrow();
    expect(() => bridge.send({ type: "highlight", path: "/a.html", startLine: 5, endLine: 2 })).toThrow();
  });

  it("returns false when no helper is connected", () => {
    expect(bridge.send({ type: "clearHighlight" })).toBe(false);
  });

  it("waits for the helper's done reply", async () => {
    const h = await connectedHelper();
    h.socket.on("message", (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === "insert") h.send({ type: "done", id: m.id, command: "insert", ok: true, startLine: 5, endLine: 5 });
    });
    const done = await bridge.request({ type: "insert", path: "/a.html", text: "<p>Hi</p>", anchor: { after: "<body>" } });
    expect(done).toMatchObject({ type: "done", command: "insert", ok: true, startLine: 5 });
  });

  it("gives up waiting after the timeout", async () => {
    await connectedHelper();
    expect(await bridge.request({ type: "clearHighlight" }, 50)).toBeUndefined();
  });
});

async function waitUntil(ok: () => boolean): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (ok()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("timed out waiting");
}

describe("shared protocol", () => {
  it("the helper's copy is identical to src/learn/bridge-protocol.ts (fix: npm --prefix extensions/vscode run copy-protocol)", () => {
    const source = readFileSync(new URL("../../src/learn/bridge-protocol.ts", import.meta.url), "utf8");
    const copy = readFileSync(new URL("../../extensions/vscode/src/protocol.ts", import.meta.url), "utf8");
    expect(copy).toBe(source);
  });
});

describe("the helper's real connection code against the real bridge", () => {
  it("connects with bridge.json, sends events and gets commands", async () => {
    const commands: unknown[] = [];
    const connection = new Connection({
      bridgeFile: bridge.file,
      folders: () => ["/proj"],
      onCommand: (d) => commands.push(d),
      minDelayMs: 10,
    });
    const connected = next(bridge, "connected");
    connection.start();
    expect(await connected).toMatchObject({ client: "vscode", folders: ["/proj"] });
    await waitUntil(() => connection.connected);

    const event = next(bridge, "event");
    connection.send({ type: "cursor", path: "/proj/index.html", line: 3, column: 2 });
    expect(await event).toEqual({ type: "cursor", path: "/proj/index.html", line: 3, column: 2 });

    bridge.send({ type: "openFile", path: "/proj/index.html" });
    await waitUntil(() => commands.length === 1);
    expect(commands).toEqual([{ type: "openFile", path: "/proj/index.html" }]);
    connection.dispose();
  });
});
