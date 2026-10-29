// The messages Stride and its VS Code helper send each other over the local connection.
// The one source is src/learn/bridge-protocol.ts. extensions/vscode/src/protocol.ts is an exact copy made when the
// helper is built (extensions/vscode/scripts/copy-protocol.mjs): edit the source, never the copy.
// Only zod is imported here, so the helper can bundle this file on its own.
import { z } from "zod";

export const BRIDGE_PROTOCOL_VERSION = 1;

// Lines are counted from 1 and columns from 1, like the line numbers people see in VS Code.
const line = z.number().int().min(1);
const column = z.number().int().min(1);
// Files are full paths on the Mac, e.g. /Users/sam/bakery/index.html.
const path = z.string().min(1).max(4096);
// Big enough for any beginner's file, small enough that nothing silly gets sent.
export const MAX_TEXT = 2_000_000;
const text = z.string().max(MAX_TEXT);
// Optional id on a command, echoed back in its "done" reply so Stride knows which command it was.
const commandId = z.string().min(1).max(100).optional();

// ---------- Helper → Stride ----------

// First message on every connection. Stride closes the connection if the token is wrong or this doesn't come quickly.
export const HelloSchema = z.object({
  type: z.literal("hello"),
  token: z.string().min(1).max(200),
  client: z.literal("vscode"),
  clientVersion: z.string().max(50).optional(),
  protocol: z.number().int(),
  folders: z.array(path).max(50).default([]).describe("The folders open in VS Code."),
});

// The whole text of a file each time the student pauses typing (sent a moment after the last key press).
export const ChangeSchema = z.object({ type: z.literal("change"), path, text, version: z.number().int().min(0) });

// The student saved a file.
export const SaveSchema = z.object({ type: z.literal("save"), path, text, version: z.number().int().min(0) });

// VS Code's error underlines for one file. An empty list means the file has no problems now.
export const DiagnosticSchema = z.object({
  severity: z.enum(["error", "warning", "info", "hint"]),
  message: z.string().max(2000),
  line,
  column,
  endLine: line,
  endColumn: column,
  source: z.string().max(100).optional(),
});
export const DiagnosticsSchema = z.object({ type: z.literal("diagnostics"), path, items: z.array(DiagnosticSchema).max(500) });

// Which file is in front. path is null when no file is open.
export const ActiveSchema = z.object({ type: z.literal("active"), path: path.nullable(), languageId: z.string().max(100).optional() });

// Where the text cursor is.
export const CursorSchema = z.object({ type: z.literal("cursor"), path, line, column });

// The reply to a command: did it work?
export const DoneSchema = z.object({
  type: z.literal("done"),
  id: commandId,
  command: z.enum(["highlight", "clearHighlight", "insert", "openFile"]),
  ok: z.boolean(),
  error: z.string().max(500).optional(),
  // For insert: the lines the new code ended up on.
  startLine: line.optional(),
  endLine: line.optional(),
});

export const EditorEventSchema = z.discriminatedUnion("type", [
  ChangeSchema,
  SaveSchema,
  DiagnosticsSchema,
  ActiveSchema,
  CursorSchema,
  DoneSchema,
]);

export const HelperMessageSchema = z.discriminatedUnion("type", [HelloSchema, ...EditorEventSchema.options]);

export type Hello = z.infer<typeof HelloSchema>;
export type Diagnostic = z.infer<typeof DiagnosticSchema>;
export type EditorEvent = z.infer<typeof EditorEventSchema>;
export type HelperMessage = z.infer<typeof HelperMessageSchema>;

// ---------- Stride → helper ----------

// Sent once the token is accepted.
export const WelcomeSchema = z.object({ type: z.literal("welcome"), protocol: z.number().int() });

// Mark lines startLine..endLine (inclusive) and scroll to them. Opens the file if needed.
export const HighlightSchema = z
  .object({ type: z.literal("highlight"), id: commandId, path, startLine: line, endLine: line, message: z.string().max(300).optional() })
  .refine((c) => c.endLine >= c.startLine, { message: "endLine must not be before startLine.", path: ["endLine"] });

// Remove every highlight Stride added.
export const ClearHighlightSchema = z.object({ type: z.literal("clearHighlight"), id: commandId });

// Where "Show me" puts the code: after a line number (0 = top of the file), or after the line holding some text.
export const InsertAnchorSchema = z.union([
  z.object({ afterLine: z.number().int().min(0) }),
  z.object({ after: z.string().min(1).max(500) }),
]);

// "Show me": type this code at the anchor, then select it so the student sees what was added.
export const InsertSchema = z.object({ type: z.literal("insert"), id: commandId, path, text: z.string().min(1).max(100_000), anchor: InsertAnchorSchema });

// Open a file (and optionally jump to a line).
export const OpenFileSchema = z.object({ type: z.literal("openFile"), id: commandId, path, line: line.optional() });

// The only four things Stride can ask the helper to do. Anything else is ignored.
export const CommandSchema = z.union([HighlightSchema, ClearHighlightSchema, InsertSchema, OpenFileSchema]);

export const StrideMessageSchema = z.union([WelcomeSchema, CommandSchema]);

export type Welcome = z.infer<typeof WelcomeSchema>;
export type InsertAnchor = z.infer<typeof InsertAnchorSchema>;
export type Command = z.infer<typeof CommandSchema>;
export type StrideMessage = z.infer<typeof StrideMessageSchema>;

// Where Stride writes the port and token, so the helper can find it. Stride writes it; the helper only reads it.
export const BridgeFileSchema = z.object({
  port: z.number().int().min(1).max(65535),
  token: z.string().min(1).max(200),
  pid: z.number().int().optional(),
  protocol: z.number().int(),
});
export type BridgeFile = z.infer<typeof BridgeFileSchema>;

export const BRIDGE_FILE_NAME = "bridge.json";

// Read one raw WebSocket message as JSON. Returns undefined for anything that isn't valid JSON.
export function parseJson(raw: unknown): unknown {
  const s = typeof raw === "string" ? raw : raw instanceof Uint8Array ? new TextDecoder().decode(raw) : undefined;
  if (s === undefined) return undefined;
  try {
    return JSON.parse(s) as unknown;
  } catch {
    return undefined;
  }
}
