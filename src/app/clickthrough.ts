// When the helper bar should let the mouse pass through to the windows underneath. No Electron here, so it's easy to test.

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The bar takes the mouse only while the cursor is on its card, and never while CalHack itself is clicking something on the
 * screen: then every click must land on the app underneath, even where the bar sits on top of it.
 */
export function shouldIgnoreMouse(cursor: { x: number; y: number }, card: Rect | null, holds: number, pad = 8): boolean {
  if (holds > 0) return true;
  if (!card) return true;
  const inside = cursor.x >= card.x - pad && cursor.x <= card.x + card.width + pad && cursor.y >= card.y - pad && cursor.y <= card.y + card.height + pad;
  return !inside;
}

/** Counts overlapping holds. Releasing twice, or after the safety timeout, never goes below zero. */
export class ClickHolds {
  private n = 0;

  get count(): number {
    return this.n;
  }

  /** Starts a hold. Call the returned function to end it (after `graceMs`). It ends by itself after `maxMs` too. */
  hold(graceMs = 300, maxMs = 60_000): () => void {
    this.n++;
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      this.n = Math.max(0, this.n - 1);
    };
    const safety = setTimeout(end, maxMs);
    safety.unref?.();
    return () => {
      clearTimeout(safety);
      setTimeout(end, graceMs).unref?.();
    };
  }
}
