// The buddy's look. This is the ONLY file that knows what the mascot looks like.
// To swap in a new character, keep the same window.BuddySprite shape and redraw render().
//
// Drawing grid: 20 x 16 "pixels", each U screen px. Feet sit at the bottom middle (10, 16).
// Props (sign, box, glass, bubble) may draw outside the grid; the svg overflows visibly.
(function () {
  "use strict";

  const U = 6; // screen px per art pixel
  const GW = 20;
  const GH = 16;
  const NS = "http://www.w3.org/2000/svg";

  const C = {
    body: "#D77757",
    eye: "#1b1b1b",
    mouth: "#4a1f12",
    tear: "#7cc7ff",
    white: "#ffffff",
    ink: "#2b2b2b",
    steel: "#7b7f86",
    glass: "#bfe6ff",
    box: "#c8955e",
    boxDark: "#a2713f",
    tape: "#ecc993",
    keys: "#4a4a52",
    key: "#cfd0d8",
    keyHit: "#ffffff",
    stop: "#e0393e",
  };

  // Where the claw tip is for each aim, in grid units (unmirrored, facing right).
  const TIPS = { side: [20.5, 9.5], up: [21, 4.5], down: [21, 15] };

  // Build the list of pixels for a pose. Each item: [x, y, w, h, color].
  function pixels(pose, frame, o) {
    const p = [];
    const R = (x, y, w, h, c) => p.push([x, y, w, h, c]);
    const f = frame | 0;
    const lookX = o.lookX || 0;
    const lookY = o.lookY || 0;

    let bodyTop = 6;
    let legs = "stand";
    let arms = "rest";
    let eyes = "open";
    let eyeDX = lookX;
    let eyeDY = lookY;
    const after = []; // props drawn on top of the body

    if (o.air) { legs = "tuck"; arms = "flap"; }
    else if (o.walk) legs = f % 2 ? "walkA" : "walkB";

    switch (pose) {
      case "wave":
        arms = f % 2 ? "waveA" : "waveB";
        break;
      case "scan":
        arms = "holdGlass";
        break;
      case "think":
        eyeDX = 1; eyeDY = -1;
        arms = "chin";
        break;
      case "type":
        eyeDY = 1;
        arms = "type";
        break;
      case "carry":
        arms = "carry";
        if (!o.air && !o.walk) legs = f % 4 < 2 ? "stand" : "brace";
        break;
      case "stop":
        arms = "sign";
        eyes = "firm";
        break;
      case "point":
        arms = "point";
        eyeDX = 1;
        eyeDY = o.aim === "up" ? -1 : o.aim === "down" ? 1 : 0;
        break;
      case "celebrate":
        arms = f % 2 ? "cheerA" : "cheerB";
        eyes = "happy";
        break;
      case "sad":
        bodyTop = 7;
        arms = "droop";
        eyes = "sad";
        break;
      default:
        break; // idle, talk
    }
    if (o.blink && eyes === "open") eyes = "closed";

    // Body
    R(4, bodyTop, 12, 14 - bodyTop, C.body);

    // Legs
    const L = [5, 7, 12, 14];
    for (let i = 0; i < 4; i++) {
      const x = L[i];
      if (legs === "tuck") R(x, 14, 1, 1, C.body);
      else if (legs === "walkA") R(x, 14, 1, i % 2 ? 1 : 2, C.body);
      else if (legs === "walkB") R(x, 14, 1, i % 2 ? 2 : 1, C.body);
      else if (legs === "brace") R(x + (i < 2 ? -1 : 1), 14, 1, 2, C.body);
      else R(x, 14, 1, 2, C.body);
    }

    // Arms
    const leftRest = () => R(2, 9, 2, 2, C.body);
    const rightRest = () => R(16, 9, 2, 2, C.body);
    switch (arms) {
      case "flap":
        R(2, 7, 2, 2, C.body); R(16, 7, 2, 2, C.body);
        break;
      case "waveA":
        leftRest(); R(16, 4, 2, 5, C.body);
        break;
      case "waveB":
        leftRest(); R(16, 6, 2, 3, C.body); R(18, 4, 2, 3, C.body);
        break;
      case "holdGlass": {
        leftRest(); R(16, 8, 2, 2, C.body);
        // magnifying glass: handle then lens
        R(18, 7, 1, 1, C.ink); R(19, 6, 1, 1, C.ink);
        const gy = f % 6 < 3 ? 0 : 1; // tiny wobble
        after.push([20, 1 + gy, 3, 1, C.ink], [20, 5 + gy, 3, 1, C.ink], [19, 2 + gy, 1, 3, C.ink], [23, 2 + gy, 1, 3, C.ink]);
        after.push([20, 2 + gy, 3, 3, C.glass], [20, 2 + gy, 1, 1, C.white]);
        break;
      }
      case "chin":
        leftRest(); R(16, 10, 2, 2, C.body);
        break;
      case "type": {
        // keyboard in front, claws tapping in turn
        const k = [[2, 13, 16, 3, C.keys]];
        for (let x = 3; x <= 16; x += 2) k.push([x, 14, 1, 1, C.key]);
        const leftDown = f % 2 === 0;
        k.push([leftDown ? 5 : 13, 14, 1, 1, C.keyHit]);
        after.push(...k);
        after.push([2, leftDown ? 12 : 11, 2, 2, C.body], [16, leftDown ? 11 : 12, 2, 2, C.body]);
        break;
      }
      case "carry": {
        const b = f % 4 < 2 ? 0 : 1; // box sinks a little, then lifts
        R(3, 1 + b, 2, 8 - b, C.body); R(15, 1 + b, 2, 8 - b, C.body);
        after.push([5, -1 + b, 10, 7, C.box], [5, 5 + b, 10, 1, C.boxDark], [9, -1 + b, 2, 6, C.tape]);
        break;
      }
      case "sign":
        R(2, 7, 2, 2, C.body); // other claw up: "hold on"
        R(16, 9, 2, 2, C.body);
        R(18, 0, 1, 11, C.steel);
        after.push(
          [17, -7, 3, 1, C.stop], [16, -6, 5, 1, C.stop], [15, -5, 7, 3, C.stop],
          [16, -2, 5, 1, C.stop], [17, -1, 3, 1, C.stop], [16, -4, 5, 1, C.white]
        );
        break;
      case "point": {
        leftRest();
        const jab = f % 4 < 2 ? 0 : 1;
        if (o.aim === "up") {
          R(16, 8, 2, 2, C.body); R(18, 6, 2, 2, C.body); R(20, 5 - jab, 1, 1, C.body);
        } else if (o.aim === "down") {
          R(16, 10, 2, 2, C.body); R(18, 12, 2, 2, C.body); R(20, 14 + jab, 1, 1, C.body);
        } else {
          R(16, 9, 3, 2, C.body); R(19, 9, 1 + jab, 1, C.body);
        }
        break;
      }
      case "cheerA":
        R(2, 3, 2, 4, C.body); R(16, 3, 2, 4, C.body);
        break;
      case "cheerB":
        R(1, 2, 2, 3, C.body); R(2, 5, 2, 2, C.body); R(17, 2, 2, 3, C.body); R(16, 5, 2, 2, C.body);
        break;
      case "droop":
        R(2, 11, 2, 2, C.body); R(16, 11, 2, 2, C.body);
        break;
      default:
        leftRest(); rightRest();
    }

    // Eyes
    const ex = [7 + eyeDX, 12 + eyeDX];
    const ey = 8 + eyeDY;
    for (const x of ex) {
      if (eyes === "open") R(x, ey, 1, 2, C.eye);
      else if (eyes === "closed") R(x, ey + 1, 1, 1, C.eye);
      else if (eyes === "firm") { R(x, ey, 1, 2, C.eye); R(x === ex[0] ? x : x - 1, ey - 1, 2, 1, C.eye); }
      else if (eyes === "happy") { R(x - 1, ey + 1, 1, 1, C.eye); R(x, ey, 1, 1, C.eye); R(x + 1, ey + 1, 1, 1, C.eye); }
      else if (eyes === "sad") { R(x, ey + 2, 1, 1, C.eye); R(x === ex[0] ? x - 1 : x + 1, ey + 1, 1, 1, C.eye); }
    }
    if (eyes === "sad" && f % 8 < 4) R(ex[1], ey + 3 + (f % 4 < 2 ? 0 : 1), 1, 1, C.tear);

    // Mouth while talking
    if (o.talking || pose === "talk") {
      const m = f % 3;
      if (m === 0) R(9, 11, 2, 1, C.mouth);
      else if (m === 1) R(9, 11, 2, 2, C.mouth);
    }

    // Thought bubble with dots that fill in
    if (pose === "think") {
      after.push([15, -7, 7, 5, C.white], [14, -6, 9, 3, C.white], [14, 0, 2, 1, C.white], [13, 2, 1, 1, C.white]);
      const n = (f >> 1) % 4;
      for (let i = 0; i < n; i++) after.push([16 + i * 2, -5, 1, 1, C.ink]);
    }

    return p.concat(after);
  }

  function render(pose, frame, opts) {
    const o = opts || {};
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("width", String(GW * U));
    svg.setAttribute("height", String(GH * U));
    svg.setAttribute("viewBox", `0 0 ${GW} ${GH}`);
    svg.setAttribute("shape-rendering", "crispEdges");
    svg.setAttribute("aria-hidden", "true");
    const g = document.createElementNS(NS, "g");
    if (pose === "think") g.setAttribute("transform", "rotate(-7 10 16)");
    for (const [x, y, w, h, c] of pixels(pose, frame, o)) {
      const r = document.createElementNS(NS, "rect");
      r.setAttribute("x", String(x));
      r.setAttribute("y", String(y));
      r.setAttribute("width", String(w));
      r.setAttribute("height", String(h));
      r.setAttribute("fill", c);
      g.appendChild(r);
    }
    svg.appendChild(g);
    return svg;
  }

  // How far the art reaches from the feet, in screen px (unmirrored). Used to keep it on screen.
  const boundsCache = {};
  function bounds(pose) {
    if (boundsCache[pose]) return boundsCache[pose];
    let l = Infinity, r = -Infinity, t = Infinity;
    for (const aim of ["side", "up", "down"]) {
      for (let f = 0; f < 8; f++) {
        for (const [x, y, w] of pixels(pose, f, { aim, talking: true })) {
          l = Math.min(l, x); r = Math.max(r, x + w); t = Math.min(t, y);
        }
      }
    }
    const b = { left: (l - GW / 2) * U, right: (r - GW / 2) * U, top: (t - GH) * U - (pose === "think" ? 6 : 0) };
    boundsCache[pose] = b;
    return b;
  }

  const tips = {};
  for (const k of Object.keys(TIPS)) tips[k] = { x: (TIPS[k][0] - GW / 2) * U, y: (TIPS[k][1] - GH) * U };

  window.BuddySprite = {
    size: { w: GW * U, h: GH * U }, // 120 x 96 px box; the body itself is ~84 x 60
    anchor: { x: (GW / 2) * U, y: GH * U }, // feet: bottom middle of the sprite box
    fps: 8, // pixel-art frame rate
    headY: -10 * U, // top of the body, from the feet
    tips, // claw tip for point, relative to the feet, facing right
    bounds,
    render,
  };
})();
