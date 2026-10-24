// Serves the demo pages at http://localhost:4321 (only reachable from this Mac).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const ROOT = join(process.cwd(), "demo", "pages");
const PORT = Number(process.env.PORT ?? 4321);
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".pdf": "application/pdf", ".png": "image/png" };

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  const file = join(ROOT, path.endsWith("/") ? path + "index.html" : path);
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(PORT, "127.0.0.1", () => console.log(`Demo pages: http://localhost:${PORT}/`));
