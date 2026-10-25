import { describe, expect, it } from "vitest";
import { busyness, busyTable, chooseEmptySpot, type Bitmap, type Rect } from "../src/app/empty-spot.js";

/** A white screen (1 image pixel = 1 point), with "text" (black/white stripes, like lines of letters) in the given boxes. */
function screenWith(width: number, height: number, text: Rect[]): Bitmap {
  const data = new Uint8Array(width * height * 4).fill(255);
  for (const r of text) {
    for (let y = r.y; y < r.y + r.height; y++) {
      for (let x = r.x; x < r.x + r.width; x++) {
        if ((x + y) % 3 === 0) {
          const i = (y * width + x) * 4;
          data[i] = data[i + 1] = data[i + 2] = 0;
        }
      }
    }
  }
  return { data, width, height };
}

const area = { x: 0, y: 0, width: 800, height: 600 };
const card = { width: 200, height: 120 };

describe("how busy part of the screen is", () => {
  it("is 0 on a blank screen and high over text", () => {
    const img = screenWith(800, 600, [{ x: 0, y: 0, width: 400, height: 600 }]);
    const sat = busyTable(img);
    expect(busyness(sat, 800, 600, { x: 500, y: 100, width: 200, height: 100 })).toBe(0);
    expect(busyness(sat, 800, 600, { x: 50, y: 100, width: 200, height: 100 })).toBeGreaterThan(0.5);
  });
});

describe("where the bar goes", () => {
  it("moves off the words to the empty side", () => {
    // Text fills the left half, where the bar is now.
    const img = screenWith(800, 600, [{ x: 0, y: 0, width: 400, height: 600 }]);
    const c = chooseEmptySpot(img, 1, area, card, { x: 100, y: 400 });
    expect(c.move).toBe(true);
    expect(c.at.x).toBeGreaterThanOrEqual(400);
    expect(c.there).toBe(0);
  });

  it("stays put when it isn't covering anything", () => {
    const img = screenWith(800, 600, [{ x: 0, y: 0, width: 300, height: 600 }]);
    const c = chooseEmptySpot(img, 1, area, card, { x: 500, y: 400 });
    expect(c.move).toBe(false);
    expect(c.at).toEqual({ x: 500, y: 400 });
  });

  it("stays put when the whole screen is busy (nowhere better to go)", () => {
    const img = screenWith(800, 600, [area]);
    expect(chooseEmptySpot(img, 1, area, card, { x: 300, y: 400 }).move).toBe(false);
  });

  it("picks the nearer empty place when there are two", () => {
    // Text in the middle band; empty strips on the far left and far right. The bar is on the right part of the text.
    const img = screenWith(800, 600, [{ x: 220, y: 0, width: 360, height: 600 }]);
    const c = chooseEmptySpot(img, 1, area, card, { x: 450, y: 300 });
    expect(c.move).toBe(true);
    expect(c.at.x).toBeGreaterThanOrEqual(580);
  });

  it("prefers a completely blank spot far away over a nearly blank spot close by", () => {
    // Text covers the screen except: a few words near the bar (bottom middle) and a blank patch in the top-right corner.
    const img = screenWith(800, 600, [
      { x: 0, y: 0, width: 560, height: 600 },
      { x: 560, y: 260, width: 240, height: 340 },
      // The "few words" area: a lightly-busy strip at the bottom middle (just a short line).
      { x: 330, y: 560, width: 30, height: 4 },
    ]);
    // Clear the bottom middle except that short line, to make it "nearly blank".
    for (let y = 440; y < 600; y++) for (let x = 250; x < 500; x++) {
      if (y >= 560 && y < 564 && x >= 330 && x < 360) continue;
      const i = (y * 800 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
    }
    const c = chooseEmptySpot(img, 1, area, card, { x: 50, y: 470 });
    expect(c.move).toBe(true);
    expect(c.there).toBe(0);
    expect(c.at.x).toBeGreaterThanOrEqual(560);
    expect(c.at.y + card.height).toBeLessThanOrEqual(260);
  });

  it("goes where it covers the fewest words when nowhere is blank", () => {
    // Dense text everywhere, except one area with only every other line of text.
    const img = screenWith(800, 600, [area]);
    for (let y = 0; y < 300; y++) for (let x = 500; x < 800; x++) {
      if (Math.floor(y / 6) % 2 === 0) continue;
      const i = (y * 800 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
    }
    const c = chooseEmptySpot(img, 1, area, card, { x: 50, y: 400 });
    expect(c.move).toBe(true);
    expect(c.there).toBeLessThan(c.here);
    expect(c.at.x).toBeGreaterThanOrEqual(500);
    expect(c.at.y + card.height).toBeLessThanOrEqual(300);
  });

  it("moves even when it covers only a few words, if a blank spot exists", () => {
    const img = screenWith(800, 600, [{ x: 120, y: 450, width: 40, height: 8 }]);
    const c = chooseEmptySpot(img, 1, area, card, { x: 100, y: 400 });
    expect(c.move).toBe(true);
    expect(c.there).toBe(0);
  });

  it("works on a small screen copy (image pixels ≠ points)", () => {
    // Screen is 1600×1200 points, the copy is 800×600: text on the left half.
    const img = screenWith(800, 600, [{ x: 0, y: 0, width: 400, height: 600 }]);
    const c = chooseEmptySpot(img, 0.5, { x: 0, y: 0, width: 1600, height: 1200 }, { width: 400, height: 240 }, { x: 200, y: 800 });
    expect(c.move).toBe(true);
    expect(c.at.x).toBeGreaterThanOrEqual(800);
  });
});
