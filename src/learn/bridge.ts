// Stride's side of the local connection to its VS Code helper.
//
// How it stays private:
// - The server listens on 127.0.0.1 only, on a random free port, and refuses anything not coming from 127.0.0.1.
// - It refuses connections that carry an Origin header, so a web page in a browser can't talk to it.
// - Each start makes a new random token and writes it with the port to bridge.json (readable by this user only).
//   The helper's first message must be { type: "hello", token } with that token, within a few seconds,
//   or the connection is closed.
// - Every message is checked with Zod; anything that doesn't fit is ignored.
// - Stride can only send the four commands in bridge-protocol.ts.
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { EventEmitter } from "node:events";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import {
  BRIDGE_FILE_NAME,
  BRIDGE_PROTOCOL_VERSION,
  CommandSchema,
  HelloSchema,
  HelperMessageSchema,
  parseJson,
  type BridgeFile,
  type Command,
  type EditorEvent,
  type Hello,
} from "./bridge-protocol.js";

export * from "./bridge-protocol.js";

// Where bridge.json lives on the Mac. The helper looks in the same place.
export function defaultBridgeDir(): string {
  return join(homedir(), "Library", "Application Support", "Stride");
}

export interface BridgeOptions {
  dir?: string; // folder for bridge.json (tests pass a temp folder)
  helloTimeoutMs?: number; // how long a new connection has to say hello (default 5 s)
  log?: (message: string) => void;
}

type Done = Extract<EditorEvent, { type: "done" }>;

// What the bridge tells the rest of Stride.
export interface BridgeEvents {
  connected: [hello: Hello]; // the helper said hello with the right token
  disconnected: [];
  event: [event: EditorEvent]; // every message from the helper, after hello
  change: [event: Extract<EditorEvent, { type: "change" }>];
  save: [event: Extract<EditorEvent, { type: "save" }>];
  diagnostics: [event: Extract<EditorEvent, { type: "diagnostics" }>];
  active: [event: Extract<EditorEvent, { type: "active" }>];
  cursor: [event: Extract<EditorEvent, { type: "cursor" }>];
  done: [event: Done];
  ignored: [reason: string]; // a message or connection was turned away (handy for logs and tests)
}

const LOCAL_ADDRESSES = new Set(["127.0.0.1", "::ffff:127.0.0.1"]);
const MAX_PAYLOAD = 10 * 1024 * 1024;

// Close codes the helper understands.
export const CLOSE = { badHello: 4000, badToken: 4001, replaced: 4002, stopped: 4003 } as const;

export class Bridge extends EventEmitter<BridgeEvents> {
  readonly token = randomBytes(32).toString("hex");
  readonly dir: string;
  private server: WebSocketServer | undefined;
  private editor: WebSocket | undefined;
  private readonly helloTimeoutMs: number;
  private readonly log: (message: string) => void;

  constructor(options: BridgeOptions = {}) {
    super();
    this.dir = options.dir ?? defaultBridgeDir();
    this.helloTimeoutMs = options.helloTimeoutMs ?? 5000;
    this.log = options.log ?? (() => {});
  }

  get file(): string {
    return join(this.dir, BRIDGE_FILE_NAME);
  }

  get port(): number {
    const address = this.server?.address();
    if (!address || typeof address === "string") throw new Error("The bridge isn't running.");
    return address.port;
  }

  // True while a helper is connected and has given the right token.
  get connected(): boolean {
    return this.editor?.readyState === WebSocket.OPEN;
  }

  // Start listening on 127.0.0.1 (random free port) and write bridge.json.
  async start(): Promise<void> {
    if (this.server) return;
    const server = new WebSocketServer({
      host: "127.0.0.1",
      port: 0,
      maxPayload: MAX_PAYLOAD,
      verifyClient: (info: { req: IncomingMessage; origin?: string }) => this.allowed(info.req),
    });
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    server.on("error", (e) => this.log(`bridge error: ${e.message}`));
    server.on("connection", (socket, req) => this.accept(socket, req));
    this.server = server;
    await this.writeFile();
  }

  // Stop listening, drop the helper and remove bridge.json.
  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = undefined;
    for (const client of server.clients) client.close(CLOSE.stopped, "Stride stopped");
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await this.removeFile();
  }

  // Send one of the four commands to the helper. Returns false when no helper is connected.
  send(command: Command): boolean {
    const checked = CommandSchema.parse(command);
    const editor = this.editor;
    if (!editor || editor.readyState !== WebSocket.OPEN) return false;
    editor.send(JSON.stringify(checked));
    return true;
  }

  // Send a command and wait for the helper's "done" reply (or undefined after the timeout / with no helper).
  async request(command: Command, timeoutMs = 5000): Promise<Done | undefined> {
    const id = command.id ?? randomUUID();
    return new Promise((resolve) => {
      const finish = (done: Done | undefined) => {
        clearTimeout(timer);
        this.off("done", onDone);
        resolve(done);
      };
      const onDone = (done: Done) => {
        if (done.id === id) finish(done);
      };
      const timer = setTimeout(() => finish(undefined), timeoutMs);
      this.on("done", onDone);
      if (!this.send({ ...command, id })) finish(undefined);
    });
  }

  // Only 127.0.0.1, and never from a web page (browsers always send an Origin header).
  private allowed(req: IncomingMessage): boolean {
    const address = req.socket.remoteAddress ?? "";
    if (!LOCAL_ADDRESSES.has(address)) {
      this.emit("ignored", `connection from ${address} refused`);
      return false;
    }
    if (req.headers.origin !== undefined) {
      this.emit("ignored", "connection from a web page refused");
      return false;
    }
    return true;
  }

  private accept(socket: WebSocket, req: IncomingMessage): void {
    // Belt and braces: check the address again in case verifyClient was skipped.
    if (!LOCAL_ADDRESSES.has(req.socket.remoteAddress ?? "")) {
      socket.terminate();
      return;
    }
    let hello: Hello | undefined;
    const timer = setTimeout(() => {
      if (!hello) this.refuse(socket, CLOSE.badHello, "no hello");
    }, this.helloTimeoutMs);

    socket.on("message", (raw, isBinary) => {
      const data = parseJson(isBinary ? undefined : raw.toString("utf8"));
      if (!hello) {
        clearTimeout(timer);
        const first = HelloSchema.safeParse(data);
        if (!first.success) return this.refuse(socket, CLOSE.badHello, "first message wasn't a hello");
        if (!sameToken(first.data.token, this.token)) return this.refuse(socket, CLOSE.badToken, "wrong token");
        hello = first.data;
        this.adopt(socket, hello);
        return;
      }
      const message = HelperMessageSchema.safeParse(data);
      if (!message.success || message.data.type === "hello") {
        this.emit("ignored", "message didn't match the protocol");
        return;
      }
      const event = message.data;
      this.emit("event", event);
      // Each type also gets its own event name; the cast is safe because the name matches the payload.
      (this.emit as (name: string, e: EditorEvent) => boolean)(event.type, event);
    });

    socket.on("close", () => {
      clearTimeout(timer);
      if (this.editor === socket) {
        this.editor = undefined;
        this.emit("disconnected");
      }
    });
    socket.on("error", (e) => this.log(`helper connection error: ${e.message}`));
  }

  // The newest helper wins: a VS Code reload connects again, so the old connection is closed.
  private adopt(socket: WebSocket, hello: Hello): void {
    const old = this.editor;
    this.editor = socket;
    if (old && old !== socket) {
      old.close(CLOSE.replaced, "another editor connected");
      this.emit("disconnected");
    }
    socket.send(JSON.stringify({ type: "welcome", protocol: BRIDGE_PROTOCOL_VERSION }));
    this.emit("connected", hello);
  }

  private refuse(socket: WebSocket, code: number, reason: string): void {
    this.emit("ignored", reason);
    socket.close(code, reason);
  }

  // Write to a temp file first, then rename, so the helper never reads half a file. Only this user can read it.
  private async writeFile(): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const content: BridgeFile = { port: this.port, token: this.token, pid: process.pid, protocol: BRIDGE_PROTOCOL_VERSION };
    const temp = `${this.file}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(content, null, 2), { mode: 0o600 });
    await chmod(temp, 0o600);
    await rename(temp, this.file);
  }

  // Remove bridge.json, unless another Stride has already replaced it with its own.
  private async removeFile(): Promise<void> {
    try {
      const current = JSON.parse(await readFile(this.file, "utf8")) as Partial<BridgeFile>;
      if (current.token === this.token) await rm(this.file, { force: true });
    } catch {
      // Already gone or unreadable: nothing to clean up.
    }
  }
}

// Compare tokens without leaking how much of a wrong one matched.
function sameToken(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Start a bridge in one call.
export async function startBridge(options: BridgeOptions = {}): Promise<Bridge> {
  const bridge = new Bridge(options);
  await bridge.start();
  return bridge;
}
