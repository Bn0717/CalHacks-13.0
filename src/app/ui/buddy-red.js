// Stride, CalHack's red buddy. Original Clawd stays in buddy-sprite.js.
// To restore Clawd, remove this script from buddy.html (or preview ?mascot=clawd).
(function () {
  "use strict";
  if (new URLSearchParams(location.search).get("mascot") === "clawd") return;
  const NS = "http://www.w3.org/2000/svg";
  function render(pose, frame, o = {}) {
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 120 120");
    svg.setAttribute("width", "120");
    svg.setAttribute("height", "120");
    svg.setAttribute("aria-hidden", "true");
    svg.style.shapeRendering = "geometricPrecision";
    const add = (tag, attrs, parent = svg) => {
      const node = document.createElementNS(NS, tag);
      for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
      parent.appendChild(node);
      return node;
    };
    const line = (d, parent = svg, color = "#111") => add("path", { d, fill: "none", stroke: color, "stroke-width": 1.7, "stroke-linecap": "round", "stroke-linejoin": "round" }, parent);
    const beat = frame % 2;
    let left = "M23 53 Q3 70 12 93", right = "M97 51 Q116 68 108 91";
    if (pose === "wave") right = `M96 52 Q113 43 ${beat ? 106 : 116} 25`;
    if (pose === "celebrate" || o.air) { left = "M24 51 Q8 43 9 26"; right = "M96 51 Q113 41 112 24"; }
    if (pose === "point") right = o.aim === "up" ? "M96 52 Q110 43 114 22" : o.aim === "down" ? "M96 52 Q111 68 114 104" : "M96 52 Q109 58 120 58";
    if (pose === "think") right = "M96 56 Q110 83 73 76";
    if (pose === "scan") right = "M96 53 Q107 66 110 49";
    if (pose === "stop") right = "M96 54 Q109 61 110 37";
    if (pose === "carry") { left = "M24 53 Q8 33 31 16"; right = "M96 53 Q111 32 89 16"; }
    if (pose === "type") { left = `M24 55 Q8 82 42 ${beat ? 97 : 92}`; right = `M96 55 Q113 82 78 ${beat ? 92 : 97}`; }
    line(left); line(right);
    const step = o.walk ? (beat ? 5 : -5) : 0;
    if (o.air) { line("M46 96 Q36 105 42 108"); line("M77 96 Q88 105 82 108"); }
    else { line(`M46 94 Q39 108 ${43 + step} 117 Q39 116 ${37 + step} 119`); line(`M77 94 Q82 109 ${79 - step} 117 Q84 116 ${86 - step} 119`); }
    // Two adjoining curves reproduce the reference's curved two-tone shading.
    add("path", { d: "M60 10 C35 10 22 28 22 55 C22 83 35 97 60 97 C85 97 98 83 98 55 C98 28 85 10 60 10Z", fill: "#ff455f" });
    add("path", { d: "M60 10 C85 10 98 28 98 55 C98 83 85 97 60 97 C53 97 47 96 43 94 C64 75 68 39 60 10Z", fill: "#e83357" });
    const dx = (o.lookX || 0) * 1.4, dy = (o.lookY || 0) * 1.4;
    for (const x of [44, 76]) {
      if (o.blink || pose === "celebrate") line(`M${x - 5} ${39 + dy} Q${x} ${pose === "celebrate" ? 31 : 42} ${x + 5} ${39 + dy}`);
      else {
        add("ellipse", { cx: x + dx, cy: 38 + dy, rx: 5.8, ry: 6.5, fill: "#050505" });
        add("circle", { cx: x + dx + (x < 60 ? 1.5 : -1.5), cy: 38 + dy + 1, r: 2.1, fill: "white" });
      }
    }
    if (pose === "sad") line("M54 54 Q60 48 66 54");
    else if ((o.talking || pose === "talk") && frame % 3 !== 0) add("ellipse", { cx: 60, cy: 52, rx: 4, ry: beat ? 4 : 2.5, fill: "#111" });
    else line("M53 49 Q60 55 67 49");
    if (pose === "scan") { line("M109 49 L116 37"); add("circle", { cx: 116, cy: 30, r: 9, fill: "#bfe6ff", "fill-opacity": .7, stroke: "#333", "stroke-width": 2 }); }
    if (pose === "stop") { line("M110 54 L110 14"); add("path", { d: "M104 5 H116 L122 11 V23 L116 29 H104 L98 23 V11Z", fill: "#e0393e", stroke: "white", "stroke-width": 1.5 }); line("M104 17 H116", svg, "white"); }
    if (pose === "carry") { add("rect", { x: 30, y: -5 + beat, width: 60, height: 25, rx: 2, fill: "#c8955e", stroke: "#92623c" }); add("rect", { x: 56, y: -5 + beat, width: 8, height: 25, fill: "#ecc993" }); }
    if (pose === "think") { add("ellipse", { cx: 104, cy: 0, rx: 20, ry: 12, fill: "white", stroke: "#ddd" }); add("circle", { cx: 88, cy: 17, r: 3, fill: "white" }); for (let i = 0; i <= (frame >> 1) % 3; i++) add("circle", { cx: 94 + i * 10, cy: 0, r: 2, fill: "#333" }); }
    if (pose === "type") { add("rect", { x: 26, y: 95, width: 68, height: 12, rx: 3, fill: "#4a4a52" }); for (let i = 0; i < 10; i++) add("rect", { x: 30 + i * 6, y: 99, width: 4, height: 3, rx: .5, fill: i % 2 === beat ? "white" : "#aaa" }); }
    return svg;
  }
  window.BuddySprite = {
    size: { w: 120, h: 120 }, anchor: { x: 60, y: 120 }, fps: 8, headY: -110,
    tips: { side: { x: 60, y: -62 }, up: { x: 54, y: -98 }, down: { x: 54, y: -16 } },
    bounds: (pose) => ({ left: -58, right: ["scan", "think", "stop", "point"].includes(pose) ? 66 : 60, top: pose === "think" ? -134 : pose === "carry" ? -126 : -112 }),
    render,
  };
})();
