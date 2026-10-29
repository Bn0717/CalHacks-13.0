import { describe, expect, it } from "vitest";
import { Connection, type SocketLike } from "../src/connection";
import type { Timers } from "../src/reporter";

// A pretend WebSocket we drive by hand.
class FakeSocket implements SocketLike {
  readyState = 0;
  sent: unknown[] = [];
  private listeners = new Map<string, ((arg?: unknown) => void)[]>();
  constructor(readonly url: string) {}
  on(event: string, listener: (...args: any[]) => void): unknown {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener as (arg?: unknown) => void]);
    return this;
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(): void {
    this.fire("close");
  }
  fire(event: string, arg?: unknown): void {
    if (event === "open") this.readyState = 1;
    if (event === "close") this.readyState = 3;
    for (const l of this.listeners.get(event) ?? []) l(arg);
  }
  serverSays(message: unknown): void {
    this.fire("message", Buffer.from(JSON.stringify(message)));
  }
}

class ManualTimers implements Timers {
  waits: number[] = [];
  private jobs: (() => void)[] = [];
  set(fn: () => void, ms: number): unknown {
    this.waits.push(ms);
    this.jobs.push(fn);
    return this.jobs.length;
  }
  clear(): void {
    this.jobs = [];
  }
  runNext(): void {
    this.jobs.shift()?.();
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(file: string | null = JSON.stringify({ port: 4567, token: "secret", protocol: 1 })) {
  const sockets: FakeSocket[] = [];
  const timers = new ManualTimers();
  const commands: unknown[] = [];
  let ready = 0;
  let gone = 0;
  const files = { content: file };
  const connection = new Connection({
    bridgeFile: "/home/sam/bridge.json",
    readText: async () => {
      if (files.content === null) throw new Error("ENOENT");
      return files.content;
    },
    createSocket: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    folders: () => ["/proj"],
    clientVersion: "0.1.0",
    onReady: () => ready++,
    onDisconnected: () => gone++,
    onCommand: (d) => commands.push(d),
    timers,
  });
  return { connection, sockets, timers, commands, files, counts: () => ({ ready, gone }) };
}

describe("Connection", () => {
  it("reads bridge.json, connects to 127.0.0.1 and says hello with the token", async () => {
    const { connection, sockets, counts } = setup();
    connection.start();
    await flush();
    expect(sockets[0]!.url).toBe("ws://127.0.0.1:4567");
    sockets[0]!.fire("open");
    expect(sockets[0]!.sent).toEqual([{ type: "hello", token: "secret", client: "vscode", protocol: 1, folders: ["/proj"], clientVersion: "0.1.0" }]);
    expect(connection.connected).toBe(false);
    sockets[0]!.serverSays({ type: "welcome", protocol: 1 });
    expect(connection.connected).toBe(true);
    expect(counts().ready).toBe(1);
  });

  it("only sends events once Stride has said welcome", async () => {
    const { connection, sockets } = setup();
    connection.start();
    await flush();
    sockets[0]!.fire("open");
    expect(connection.send({ type: "active", path: null })).toBe(false);
    sockets[0]!.serverSays({ type: "welcome", protocol: 1 });
    expect(connection.send({ type: "active", path: null })).toBe(true);
    expect(sockets[0]!.sent.at(-1)).toEqual({ type: "active", path: null });
  });

  it("passes later messages on as commands", async () => {
    const { connection, sockets, commands } = setup();
    connection.start();
    await flush();
    sockets[0]!.fire("open");
    sockets[0]!.serverSays({ type: "highlight", path: "/proj/a.html", startLine: 1, endLine: 1 }); // before welcome: dropped
    sockets[0]!.serverSays({ type: "welcome", protocol: 1 });
    sockets[0]!.serverSays({ type: "clearHighlight" });
    expect(commands).toEqual([{ type: "clearHighlight" }]);
  });

  it("waits longer each time Stride isn't running, then connects when it starts", async () => {
    const { connection, sockets, timers, files } = setup(null);
    connection.start();
    await flush();
    timers.runNext();
    await flush();
    timers.runNext();
    await flush();
    expect(sockets).toHaveLength(0);
    expect(timers.waits).toEqual([1000, 2000, 4000]);
    files.content = JSON.stringify({ port: 9999, token: "t", protocol: 1 });
    timers.runNext();
    await flush();
    expect(sockets[0]!.url).toBe("ws://127.0.0.1:9999");
  });

  it("ignores a broken bridge.json and tries again", async () => {
    const { connection, sockets, timers } = setup('{"port": "nope"}');
    connection.start();
    await flush();
    expect(sockets).toHaveLength(0);
    expect(timers.waits).toEqual([1000]);
  });

  it("reconnects after Stride goes away, starting again from a short wait", async () => {
    const { connection, sockets, timers, counts } = setup();
    connection.start();
    await flush();
    sockets[0]!.fire("open");
    sockets[0]!.serverSays({ type: "welcome", protocol: 1 });
    sockets[0]!.fire("close");
    expect(counts().gone).toBe(1);
    expect(connection.connected).toBe(false);
    expect(timers.waits).toEqual([1000]);
    timers.runNext();
    await flush();
    expect(sockets).toHaveLength(2);
  });

  it("stops trying after dispose", async () => {
    const { connection, sockets, timers } = setup();
    connection.start();
    await flush();
    connection.dispose();
    expect(sockets[0]!.readyState).toBe(3);
    timers.runNext();
    await flush();
    expect(sockets).toHaveLength(1);
  });
});
