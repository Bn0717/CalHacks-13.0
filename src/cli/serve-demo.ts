// Serves the demo pages at http://localhost:4321 (only reachable from this Mac).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = join(process.cwd(), "demo", "pages");
const PORT = Number(process.env.PORT ?? 4321);
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".pdf": "application/pdf", ".png": "image/png" };

export function createDemoServer() {
  return createServer(async (req, res) => {
    let path: string;
    try { path = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname); }
    catch { res.writeHead(400).end("Invalid path"); return; }
    // Check the URL's trailing slash before Windows converts it to a backslash.
    const file = resolve(ROOT, "." + (path.endsWith("/") ? path + "index.html" : path));
    if (!file.startsWith(ROOT + sep)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" }).end(body);
    } catch {
      res.writeHead(404).end("Not found");
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  createDemoServer().listen(PORT, "127.0.0.1", () => console.log(`Demo pages: http://localhost:${PORT}/`));
}
