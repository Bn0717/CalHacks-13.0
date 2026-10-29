// Keeps the helper connected to Stride. Reads the port and token from bridge.json, says hello, and if Stride
// isn't running (or goes away) tries again later, waiting a bit longer each time (1 s, 2 s, 4 s … up to 30 s).
// Nothing here imports vscode, so it can be tested with a fake socket.
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import {
  BRIDGE_FILE_NAME,
  BRIDGE_PROTOCOL_VERSION,
  BridgeFileSchema,
  WelcomeSchema,
  parseJson,
  type EditorEvent,
} from "./protocol";
import { realTimers, type Timers } from "./reporter";

// Where Stride writes bridge.json on the Mac. STRIDE_BRIDGE_FILE overrides it (handy for testing).
export function defaultBridgeFile(): string {
  return process.env.STRIDE_BRIDGE_FILE ?? join(homedir(), "Library", "Application Support", "Stride", BRIDGE_FILE_NAME);
}

// The few parts of a WebSocket we use, so tests can pass a fake.
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  on(event: "open", listener: () => void): unknown;
  on(event: "message", listener: (data: unknown) => void): unknown;
  on(event: "close", listener: () => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
}

export interface ConnectionOptions {
  bridgeFile?: string;
  clientVersion?: string;
  folders?: () => string[]; // the folders open in VS Code, sent with hello
  onReady?: () => void; // Stride accepted us: a good time to send what's open now
  onCommand?: (data: unknown) => void; // every message from Stride after the welcome
  onDisconnected?: () => void;
  readText?: (path: string) => Promise<string>;
  createSocket?: (url: string) => SocketLike;
  timers?: Timers;
  minDelayMs?: number;
  maxDelayMs?: number;
  log?: (message: string) => void;
}

const OPEN = 1;

export class Connection {
  private socket: SocketLike | undefined;
  private ready = false;
  private stopped = false;
  private retry: unknown;
  private delay: number;
  private readonly o: Required<Omit<ConnectionOptions, "clientVersion">> & { clientVersion?: string };

  constructor(options: ConnectionOptions = {}) {
    this.o = {
      bridgeFile: options.bridgeFile ?? defaultBridgeFile(),
      clientVersion: options.clientVersion,
      folders: options.folders ?? (() => []),
      onReady: options.onReady ?? (() => {}),
      onCommand: options.onCommand ?? (() => {}),
      onDisconnected: options.onDisconnected ?? (() => {}),
      readText: options.readText ?? ((path) => readFile(path, "utf8")),
      createSocket: options.createSocket ?? ((url) => new WebSocket(url, { maxPayload: 10 * 1024 * 1024 }) as unknown as SocketLike),
      timers: options.timers ?? realTimers,
      minDelayMs: options.minDelayMs ?? 1000,
      maxDelayMs: options.maxDelayMs ?? 30_000,
      log: options.log ?? (() => {}),
    };
    this.delay = this.o.minDelayMs;
  }

  // True once Stride has accepted our token.
  get connected(): boolean {
    return this.ready && this.socket?.readyState === OPEN;
  }

  start(): void {
    this.stopped = false;
    void this.attempt();
  }

  // Send an event to Stride. Dropped quietly when Stride isn't there; a fresh snapshot goes out on reconnect.
  send(event: EditorEvent): boolean {
    if (!this.connected) return false;
    this.socket!.send(JSON.stringify(event));
    return true;
  }

  dispose(): void {
    this.stopped = true;
    if (this.retry !== undefined) this.o.timers.clear(this.retry);
    this.retry = undefined;
    const socket = this.socket;
    this.socket = undefined;
    socket?.close();
  }

  private async attempt(): Promise<void> {
    this.retry = undefined;
    if (this.stopped) return;
    let info;
    try {
      info = BridgeFileSchema.parse(JSON.parse(await this.o.readText(this.o.bridgeFile)));
    } catch {
      // Stride isn't running yet (no bridge.json) or the file is odd: look again later.
      return this.again();
    }
    if (this.stopped) return;

    const socket = this.o.createSocket(`ws://127.0.0.1:${info.port}`);
    this.socket = socket;
    this.ready = false;
    socket.on("open", () => {
      socket.send(
        JSON.stringify({
          type: "hello",
          token: info.token,
          client: "vscode",
          protocol: BRIDGE_PROTOCOL_VERSION,
          folders: this.o.folders(),
          ...(this.o.clientVersion ? { clientVersion: this.o.clientVersion } : {}),
        }),
      );
    });
    socket.on("message", (raw) => {
      if (this.socket !== socket) return;
      const data = parseJson(raw);
      if (!this.ready) {
        if (!WelcomeSchema.safeParse(data).success) return;
        this.ready = true;
        this.delay = this.o.minDelayMs;
        this.o.log("Connected to Stride");
        this.safely(() => this.o.onReady());
        return;
      }
      this.safely(() => this.o.onCommand(data));
    });
    socket.on("error", (e) => this.o.log(`Stride connection: ${e.message}`));
    socket.on("close", () => {
      if (this.socket !== socket) return;
      const wasReady = this.ready;
      this.socket = undefined;
      this.ready = false;
      if (wasReady) this.o.onDisconnected();
      this.again();
    });
  }

  // A problem in VS Code-side code shouldn't break the connection.
  private safely(fn: () => void): void {
    try {
      fn();
    } catch (e) {
      this.o.log(`Problem handling a Stride message: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private again(): void {
    if (this.stopped || this.retry !== undefined) return;
    const wait = this.delay;
    this.delay = Math.min(this.delay * 2, this.o.maxDelayMs);
    this.retry = this.o.timers.set(() => void this.attempt(), wait);
  }
}
