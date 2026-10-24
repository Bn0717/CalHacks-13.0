// Every fix guide we have. The AI picks one by id from guideMenu(); code does the rest.
import { printerGuide } from "./printer.js";
import { soundGuide } from "./sound.js";
import { wifiGuide } from "./wifi.js";
import type { FixGuide, GuideId } from "./types.js";

export const GUIDES: readonly FixGuide[] = [printerGuide, soundGuide, wifiGuide];

/** The guide with this id, or undefined (so an id made up by the AI just finds nothing). */
export function getGuide(id: string): FixGuide | undefined {
  return GUIDES.find((g) => g.id === id);
}

/** What the AI picker sees: no commands, just what each guide is for. */
export function guideMenu(): { id: GuideId; title: string; describe: string; examples: string[] }[] {
  return GUIDES.map((g) => ({ id: g.id, title: g.title, describe: g.describe, examples: g.examples }));
}

export * from "./types.js";
export * from "./diagnose.js";
export { printerGuide, soundGuide, wifiGuide };
