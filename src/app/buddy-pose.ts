// What the buddy does for each bar moment, and where it sits. No Electron here, so it can be tested.
import type { BarState, BuddyPose } from "./protocol.js";

/** The buddy's pose while it sits on the bar. null = the bar is hidden, so the buddy goes away too. */
export function poseForBar(state: BarState): BuddyPose | null {
  switch (state.phase) {
    case "hidden":
      return null;
    case "looking":
    case "checking":
      return "scan";
    case "ask":
      return state.listening || state.transcribing ? "think" : "wave";
    case "plan":
      return state.notes.some((n) => n.tone === "blocked") ? "stop" : "wave";
    case "working":
      return "type";
    case "confirm":
      return state.tone === "danger" ? "stop" : "think";
    case "explain":
      return "think";
    case "needs-you":
      return "wave";
    case "done": {
      const v = state.receipt.verdict;
      if (v === "done" || v === "answered") return "celebrate";
      if (v === "cant-do") return "stop";
      return "sad";
    }
    case "error":
      return "sad";
  }
}

type Rect = { x: number; y: number; width: number; height: number };

/**
 * Where the buddy's feet go on top of the bar's card, in the layer's own coordinates (the layer covers `display`).
 * null when the card isn't known yet or isn't on that display (the person dragged the bar to another screen).
 */
export function seatOnCard(card: Rect | null, display: Rect): { x: number; y: number } | null {
  if (!card) return null;
  const x = card.x + 54 - display.x;
  const y = card.y + 6 - display.y;
  if (x < 0 || y < 0 || x > display.width || y > display.height) return null;
  return { x, y };
}
