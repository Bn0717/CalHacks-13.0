// Copies Stride's message definitions (src/learn/bridge-protocol.ts) into the helper (src/protocol.ts).
// The copy is committed too, so the helper still builds on its own when the Stride source isn't next to it.
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, "..", "..", "..", "src", "learn", "bridge-protocol.ts");
const target = join(here, "..", "src", "protocol.ts");

if (!existsSync(source)) {
  console.log("Stride source not found, keeping the committed src/protocol.ts");
} else if (existsSync(target) && readFileSync(source, "utf8") === readFileSync(target, "utf8")) {
  console.log("src/protocol.ts is up to date");
} else {
  copyFileSync(source, target);
  console.log("Copied src/learn/bridge-protocol.ts to src/protocol.ts");
}
