// Stride Learn Helper: connects VS Code to Stride while a student follows a lesson.
// This file is only the glue to VS Code; the logic lives in commands.ts, reporter.ts and connection.ts.
import { isAbsolute, relative } from "node:path";
import * as vscode from "vscode";
import { handleCommand, type Editor } from "./commands";
import { Connection } from "./connection";
import { Reporter, toDiagnostics } from "./reporter";

interface Mark {
  path: string;
  startLine: number; // counted from 1
  endLine: number;
  message?: string;
}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Stride");
  const log = (m: string) => output.appendLine(`[${new Date().toLocaleTimeString()}] ${m}`);

  // Stride's red, soft enough to read the code through.
  const lineStyle = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: "rgba(255, 59, 48, 0.15)",
    border: "1px solid rgba(255, 59, 48, 0.6)",
    overviewRulerColor: "rgba(255, 59, 48, 0.8)",
    overviewRulerLane: vscode.OverviewRulerLane.Full,
  });
  const noteStyle = vscode.window.createTextEditorDecorationType({
    after: { margin: "0 0 0 2em", color: "rgba(255, 59, 48, 0.9)", fontStyle: "italic" },
  });
  let marks: Mark[] = [];

  const isFile = (doc: vscode.TextDocument) => doc.uri.scheme === "file";
  const samePath = (a: string, b: string) => a === b;
  const editorsFor = (path: string) => vscode.window.visibleTextEditors.filter((e) => samePath(e.document.uri.fsPath, path));
  const toRange = (doc: vscode.TextDocument, startLine: number, endLine: number) => {
    const last = Math.max(0, doc.lineCount - 1);
    const start = Math.min(startLine - 1, last);
    const end = Math.min(endLine - 1, last);
    return new vscode.Range(start, 0, end, doc.lineAt(end).text.length);
  };

  // Draw Stride's marks again on every visible editor (VS Code forgets them when a tab is hidden).
  const paint = () => {
    for (const ed of vscode.window.visibleTextEditors) {
      const mine = marks.filter((m) => samePath(m.path, ed.document.uri.fsPath));
      ed.setDecorations(
        lineStyle,
        mine.map((m) => toRange(ed.document, m.startLine, m.endLine)),
      );
      ed.setDecorations(
        noteStyle,
        mine
          .filter((m) => m.message)
          .map((m) => ({
            range: toRange(ed.document, m.startLine, m.startLine),
            hoverMessage: m.message,
            renderOptions: { after: { contentText: `← ${m.message}` } },
          })),
      );
    }
  };

  const showFile = async (path: string) => {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(path));
    return vscode.window.showTextDocument(doc, { preview: false });
  };

  const editor: Editor = {
    allowed(path) {
      const inFolder = (vscode.workspace.workspaceFolders ?? []).some((f) => {
        const rel = relative(f.uri.fsPath, path);
        return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
      });
      return inFolder || vscode.workspace.textDocuments.some((d) => isFile(d) && samePath(d.uri.fsPath, path));
    },
    async open(path, line) {
      const ed = await showFile(path);
      if (line !== undefined) {
        const pos = new vscode.Position(Math.min(line - 1, ed.document.lineCount - 1), 0);
        ed.selection = new vscode.Selection(pos, pos);
        ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      }
      return ed.document.getText();
    },
    async insertAt(path, offset, text) {
      const ed = await showFile(path);
      return ed.edit((b) => b.insert(ed.document.positionAt(offset), text));
    },
    select(path, startLine, endLine) {
      for (const ed of editorsFor(path)) {
        const range = toRange(ed.document, startLine, endLine);
        ed.selection = new vscode.Selection(range.start, range.end);
        ed.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      }
    },
    highlight(path, startLine, endLine, message) {
      marks = [{ path, startLine, endLine, ...(message ? { message } : {}) }];
      paint();
      for (const ed of editorsFor(path)) {
        ed.revealRange(toRange(ed.document, startLine, endLine), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      }
    },
    clearHighlights() {
      marks = [];
      paint();
    },
  };

  let connection: Connection;
  const reporter = new Reporter((event) => connection.send(event));

  // Right after connecting, tell Stride what's open now.
  const snapshot = () => {
    reporter.reset();
    const ed = vscode.window.activeTextEditor;
    if (!ed || !isFile(ed.document)) {
      reporter.active(null);
    } else {
      const doc = ed.document;
      reporter.active(doc.uri.fsPath, doc.languageId);
      connection.send({ type: "change", path: doc.uri.fsPath, text: doc.getText(), version: doc.version });
      reporter.cursor(doc.uri.fsPath, ed.selection.active.line + 1, ed.selection.active.character + 1);
    }
    for (const [uri, list] of vscode.languages.getDiagnostics()) {
      if (uri.scheme === "file" && list.length > 0) reporter.diagnostics(uri.fsPath, toDiagnostics(list));
    }
  };

  connection = new Connection({
    clientVersion: String(context.extension.packageJSON.version ?? ""),
    folders: () => (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
    onReady: snapshot,
    onDisconnected: () => log("Stride went away, will reconnect when it's back"),
    onCommand: (data) => {
      void handleCommand(data, editor).then((done) => {
        if (!done) return;
        if (!done.ok) log(`${done.command} didn't work: ${done.error ?? ""}`);
        connection.send(done);
      });
    },
    log,
  });

  context.subscriptions.push(
    output,
    lineStyle,
    noteStyle,
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (!isFile(e.document) || e.contentChanges.length === 0) return;
      const doc = e.document;
      reporter.change(doc.uri.fsPath, () => doc.getText(), doc.version);
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (isFile(doc)) reporter.save(doc.uri.fsPath, doc.getText(), doc.version);
    }),
    vscode.languages.onDidChangeDiagnostics((e) => {
      for (const uri of e.uris) {
        if (uri.scheme === "file") reporter.diagnostics(uri.fsPath, toDiagnostics(vscode.languages.getDiagnostics(uri)));
      }
    }),
    vscode.window.onDidChangeActiveTextEditor((ed) => {
      if (!ed || !isFile(ed.document)) return reporter.active(null);
      reporter.active(ed.document.uri.fsPath, ed.document.languageId);
      reporter.cursor(ed.document.uri.fsPath, ed.selection.active.line + 1, ed.selection.active.character + 1);
    }),
    vscode.window.onDidChangeTextEditorSelection((e) => {
      if (!isFile(e.textEditor.document)) return;
      const at = e.selections[0]?.active ?? e.textEditor.selection.active;
      reporter.cursor(e.textEditor.document.uri.fsPath, at.line + 1, at.character + 1);
    }),
    vscode.window.onDidChangeVisibleTextEditors(paint),
    { dispose: () => reporter.dispose() },
    { dispose: () => connection.dispose() },
  );

  connection.start();
}

export function deactivate(): void {
  // Everything is cleaned up through context.subscriptions.
}
