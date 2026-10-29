// What the helper does when Stride sends a command. Nothing here imports vscode, so it can be tested with a fake editor.
// Only the four commands in protocol.ts are carried out; anything else is ignored.
import { isAbsolute } from "node:path";
import { CommandSchema, type Command, type EditorEvent, type InsertAnchor } from "./protocol";

type Done = Extract<EditorEvent, { type: "done" }>;

// The small part of VS Code the commands need. extension.ts fills it in with the real thing.
export interface Editor {
  // May Stride touch this file? (Inside an open folder, or already open in VS Code.)
  allowed(path: string): boolean;
  // Open the file in front, optionally jumping to a line, and return its current text.
  open(path: string, line?: number): Promise<string>;
  // Put text at a character offset in the file. Returns false if VS Code refused the edit.
  insertAt(path: string, offset: number, text: string): Promise<boolean>;
  // Select whole lines (counted from 1) and scroll to them.
  select(path: string, startLine: number, endLine: number): void;
  // Mark whole lines (counted from 1) and scroll to them, with an optional short note.
  highlight(path: string, startLine: number, endLine: number, message?: string): void;
  clearHighlights(): void;
}

export interface InsertPlan {
  offset: number; // where the text goes
  text: string; // what goes there (may gain a line break at the start or end)
  startLine: number; // the lines the new code ends up on, counted from 1
  endLine: number;
}

// Work out where "Show me" code goes. Code is always added as whole lines, below the anchor line.
export function planInsert(doc: string, anchor: InsertAnchor, code: string): InsertPlan | { error: string } {
  let afterLine: number;
  if ("afterLine" in anchor) {
    afterLine = anchor.afterLine;
  } else {
    const at = doc.indexOf(anchor.after);
    if (at < 0) return { error: `Couldn't find "${anchor.after}" in the file.` };
    afterLine = lineAt(doc, at + anchor.after.length - 1);
  }

  const lineStarts = [0];
  for (let i = 0; i < doc.length; i++) if (doc[i] === "\n") lineStarts.push(i + 1);
  // Lines that really hold text (a final line break doesn't start a new line).
  const lineCount = doc.endsWith("\n") ? lineStarts.length - 1 : lineStarts.length;

  let offset: number;
  let prefix = "";
  if (afterLine <= 0) offset = 0;
  else if (afterLine < lineCount) offset = lineStarts[afterLine]!;
  else {
    offset = doc.length;
    if (doc.length > 0 && !doc.endsWith("\n")) prefix = "\n";
  }

  const body = code.endsWith("\n") ? code : `${code}\n`;
  const startLine = lineAt(doc, offset) + (prefix ? 1 : 0);
  const endLine = startLine + body.split("\n").length - 2;
  return { offset, text: prefix + body, startLine, endLine };
}

// Which line (from 1) a character offset is on.
function lineAt(doc: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < doc.length; i++) if (doc[i] === "\n") line++;
  return line;
}

// Carry out one message from Stride. Returns the "done" reply, or undefined for messages that aren't commands.
export async function handleCommand(data: unknown, editor: Editor): Promise<Done | undefined> {
  const parsed = CommandSchema.safeParse(data);
  if (!parsed.success) return undefined;
  const command = parsed.data;
  const reply = (ok: boolean, extra: Partial<Done> = {}): Done => ({ type: "done", id: command.id, command: command.type, ok, ...extra });

  if (command.type !== "clearHighlight" && !(isAbsolute(command.path) && editor.allowed(command.path))) {
    return reply(false, { error: "That file isn't in the project open in VS Code." });
  }
  try {
    return await run(command, editor, reply);
  } catch (e) {
    return reply(false, { error: e instanceof Error ? e.message.slice(0, 500) : "Something went wrong in VS Code." });
  }
}

async function run(command: Command, editor: Editor, reply: (ok: boolean, extra?: Partial<Done>) => Done): Promise<Done> {
  switch (command.type) {
    case "clearHighlight":
      editor.clearHighlights();
      return reply(true);
    case "openFile":
      await editor.open(command.path, command.line);
      return reply(true);
    case "highlight":
      await editor.open(command.path, command.startLine);
      editor.highlight(command.path, command.startLine, command.endLine, command.message);
      return reply(true);
    case "insert": {
      const doc = await editor.open(command.path);
      const plan = planInsert(doc, command.anchor, command.text);
      if ("error" in plan) return reply(false, { error: plan.error });
      if (!(await editor.insertAt(command.path, plan.offset, plan.text))) return reply(false, { error: "VS Code didn't accept the edit." });
      editor.select(command.path, plan.startLine, plan.endLine);
      return reply(true, { startLine: plan.startLine, endLine: plan.endLine });
    }
  }
}
