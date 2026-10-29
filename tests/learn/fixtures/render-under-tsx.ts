// Run with tsx by check-browser.test.ts: renders a page the way `npm run learn` does (through tsx/esbuild) and prints the answer.
import { playwrightRenderer } from "../../../src/learn/check/render.js";

const r = playwrightRenderer();
try {
  const result = await r.render({
    page: "index.html",
    files: [
      { path: "index.html", content: '<link rel="stylesheet" href="style.css"><h1>Hi</h1>' },
      { path: "style.css", content: "h1 { color: tomato; }" },
    ],
    probes: [{ kind: "style", selector: "h1", property: "color", expected: "tomato" }],
  });
  process.stdout.write(JSON.stringify(result));
} catch (e) {
  process.stdout.write(JSON.stringify({ error: (e as Error).message }));
} finally {
  await r.close();
}
