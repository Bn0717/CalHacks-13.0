// When Claude can't be reached (no internet), CalHack still helps with the problems its built-in guides cover,
// because those checks and fixes run entirely on the Mac.
import { getGuide, type FixGuide } from "../core/fixes/index.js";

/** Picks a built-in fix guide from plain words, for when Claude can't be reached. */
export function offlineGuide(text: string): FixGuide | undefined {
  const t = text.toLowerCase();
  if (/\b(wi-?fi|wifi|internet|online|network|web ?sites?|connect(ed|ion)?)\b|网络|上网|无线/.test(t)) return getGuide("wifi");
  if (/\b(print(er|ing)?)\b|打印/.test(t)) return getGuide("printer");
  if (/\b(sound|audio|hear|volume|speakers?|mute[d]?|quiet)\b|声音|听不到/.test(t)) return getGuide("sound");
  return undefined;
}
