// Finds the emptiest part of the screen for the helper bar, so it doesn't cover the words the person is reading.
// Works on a small copy of the screen (raw pixels, kept in memory only). No Electron here, so it can be tested.

export interface Rect { x: number; y: number; width: number; height: number }
export interface Point { x: number; y: number }

/** A small screen copy: BGRA or RGBA bytes, 4 per pixel (the channel order doesn't matter here). */
export interface Bitmap { data: Uint8Array; width: number; height: number }

/** How different two neighbouring pixels must be to count as "something here" (text, an edge, a picture). */
const EDGE = 18;

/**
 * A summed-area table of "busy" pixels: a pixel is busy when it differs clearly from the pixel to its right or below.
 * Text, icons and photos are full of these; empty backgrounds (plain or soft gradients) have almost none.
 */
export function busyTable(img: Bitmap): Uint32Array {
  const { data, width: w, height: h } = img;
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) lum[i] = 0.3 * data[i * 4] + 0.59 * data[i * 4 + 1] + 0.11 * data[i * 4 + 2];
  const sat = new Uint32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const right = x + 1 < w ? Math.abs(lum[i] - lum[i + 1]) : 0;
      const down = y + 1 < h ? Math.abs(lum[i] - lum[i + w]) : 0;
      if (right > EDGE || down > EDGE) row++;
      sat[(y + 1) * (w + 1) + x + 1] = sat[y * (w + 1) + x + 1] + row;
    }
  }
  return sat;
}

/** Share of busy pixels (0..1) inside a rectangle of the table (whole pixels, clamped to the image). */
export function busyness(sat: Uint32Array, w: number, h: number, r: Rect): number {
  const x0 = Math.max(0, Math.min(w, Math.round(r.x)));
  const y0 = Math.max(0, Math.min(h, Math.round(r.y)));
  const x1 = Math.max(x0, Math.min(w, Math.round(r.x + r.width)));
  const y1 = Math.max(y0, Math.min(h, Math.round(r.y + r.height)));
  const area = (x1 - x0) * (y1 - y0);
  if (area <= 0) return 1;
  const W = w + 1;
  const sum = sat[y1 * W + x1] - sat[y0 * W + x1] - sat[y1 * W + x0] + sat[y0 * W + x0];
  return sum / area;
}

/** Busy share (0..1) below which a spot counts as blank: only specks (a cursor, a hairline), not even a short word. */
const BLANK = 0.0005;
/** Whether two spots count as equally empty: only specks apart, or within 10% of each other. */
const same = (a: number, b: number) => Math.abs(a - b) <= Math.max(BLANK, 0.1 * Math.min(a, b));
/** Free space wanted around the card, in points. */
const MARGIN = 12;

export interface SpotChoice {
  /** Top-left of the card at its new place, in screen points. Equal to `current` when it should stay. */
  at: Point;
  move: boolean;
  /** Busy share where the card is now, and at the chosen place (0..1). */
  here: number;
  there: number;
}

/**
 * Where the card should go. Everything is in screen points; `toImage` turns points into image pixels.
 * - `card`: the card's size, and where its top-left is now (`current`).
 * - `area`: where it may go (the screen's work area, so not over the menu bar or the Dock).
 * Goes to the place that covers the fewest words (best: none at all). Stays put when it already covers nothing.
 */
export function chooseEmptySpot(img: Bitmap, toImage: number, area: Rect, card: { width: number; height: number }, current: Point): SpotChoice {
  const sat = busyTable(img);
  const px = (r: Rect): Rect => ({ x: r.x * toImage, y: r.y * toImage, width: r.width * toImage, height: r.height * toImage });
  // Each spot is judged with a small margin around the card, so it doesn't sit right up against the words either.
  const score = (p: Point) =>
    busyness(sat, img.width, img.height, px({ x: p.x - MARGIN, y: p.y - MARGIN, width: card.width + 2 * MARGIN, height: card.height + 2 * MARGIN }));
  const here = score(current);
  const result = (at: Point, there: number, move: boolean): SpotChoice => ({ at, move, here, there });

  const maxX = area.x + area.width - card.width;
  const maxY = area.y + area.height - card.height;
  if (maxX < area.x || maxY < area.y) return result(current, here, false);

  // Try spots every ~16 points. The one covering the fewest words wins, wherever it is on the screen; a completely
  // blank spot always beats one with a few words. Distance only decides between spots that are equally empty.
  const step = 16;
  let best = { at: current, there: here, dist: 0 };
  for (let y = area.y; y <= maxY + step - 1; y += step) {
    for (let x = area.x; x <= maxX + step - 1; x += step) {
      const p = { x: Math.min(x, maxX), y: Math.min(y, maxY) };
      const there = score(p);
      const dist = Math.hypot(p.x - current.x, p.y - current.y);
      const emptier = there < best.there && !same(there, best.there);
      const asEmptyButNearer = same(there, best.there) && dist < best.dist;
      if (emptier || asEmptyButNearer) best = { at: p, there, dist };
    }
  }
  // Move whenever it's covering words and somewhere covers fewer. Blank where it is: it stays.
  const worth = here > BLANK && best.there < here && !same(best.there, here);
  return worth ? result(best.at, best.there, true) : result(current, here, false);
}
