// Preview only: a fake window.calhack so buddy.js runs in a normal browser.
// Buttons send BuddyCommand messages through the same "buddy" channel the app uses.
(function () {
  "use strict";

  const listeners = {};
  window.calhack = {
    send() {},
    on(channel, cb) { (listeners[channel] = listeners[channel] || []).push(cb); },
  };

  function emit(cmd) {
    const log = document.getElementById("log");
    if (log) {
      log.textContent = JSON.stringify(cmd) + "\n" + log.textContent.split("\n").slice(0, 30).join("\n");
    }
    (listeners.buddy || []).forEach((cb) => cb(cmd));
  }

  const $ = (id) => document.getElementById(id);
  const rect = (id) => $(id).getBoundingClientRect();
  const center = (id) => { const r = rect(id); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  const topOf = (id) => { const r = rect(id); return { x: r.left + r.width / 2, y: r.top }; };
  const area = (id) => { const r = rect(id); return { x: r.left, y: r.top, width: r.width, height: r.height }; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const POSES = ["idle", "wave", "scan", "think", "type", "carry", "stop", "point", "celebrate", "sad", "talk"];
  let talking = false;
  let reduced = false;

  const groups = {
    basic: [
      ["Show (center)", () => emit({ type: "show", x: innerWidth / 2, y: innerHeight / 2 })],
      ["Show on helper bar", () => { const p = topOf("helper"); emit({ type: "show", x: p.x + 160, y: p.y, pose: "idle" }); }],
      ["Hide", () => emit({ type: "hide" })],
    ],
    hop: [
      ["→ helper bar", () => { const p = topOf("helper"); emit({ type: "hop", x: p.x + 160, y: p.y }); }],
      ["→ browser", () => { const p = topOf("win"); emit({ type: "hop", x: p.x, y: p.y, pose: "wave" }); }],
      ["→ Download button", () => { const p = topOf("dl"); emit({ type: "hop", x: p.x, y: p.y, pose: "idle", label: "This one!" }); }],
      ["→ far corner (2-3 hops)", () => emit({ type: "hop", x: innerWidth - 40, y: 60 })],
      ["→ random", () => emit({ type: "hop", x: Math.random() * innerWidth, y: 100 + Math.random() * (innerHeight - 120) })],
      ["Queue 3 hops", () => {
        const a = topOf("helper"), b = topOf("win"), c = topOf("settings");
        emit({ type: "hop", x: a.x, y: a.y });
        emit({ type: "hop", x: b.x + 200, y: b.y, pose: "carry" });
        emit({ type: "hop", x: c.x, y: c.y, pose: "celebrate" });
      }],
      ["Hop off-screen (clamps)", () => emit({ type: "hop", x: -300, y: innerHeight + 300 })],
    ],
    point: [
      ["Download button", () => { const p = center("dl"); emit({ type: "point", x: p.x, y: p.y, label: "Click “Download”" }); }],
      ["Wi‑Fi (top edge → aims up)", () => { const p = center("wifi"); emit({ type: "point", x: p.x, y: p.y, label: "Wi‑Fi lives up here" }); }],
      ["Dock icon (bottom → aims down)", () => { const p = center("dock2"); emit({ type: "point", x: p.x, y: p.y, label: "Open Finder" }); }],
      ["Settings (right edge)", () => { const p = center("settings"); emit({ type: "point", x: p.x, y: p.y, label: "Click Settings" }); }],
      ["Far left", () => emit({ type: "point", x: 6, y: innerHeight / 2, label: "Over here" })],
      ["Long label (cuts at 40)", () => { const p = center("dl"); emit({ type: "point", x: p.x, y: p.y, label: "This label is far too long to fit in the little bubble so it gets cut" }); }],
      ["HTML label (shown as text)", () => { const p = center("dl"); emit({ type: "point", x: p.x, y: p.y, label: "<img src=x onerror=alert(1)> <b>hi</b>" }); }],
    ],
    scan: [
      ["Scan article", () => emit({ type: "scan", rect: area("article") })],
      ["Scan whole browser", () => emit({ type: "scan", rect: area("win") })],
      ["Scan whole screen", () => emit({ type: "scan", rect: { x: 0, y: 0, width: innerWidth, height: innerHeight } })],
    ],
    pose: POSES.map((p) => [p, () => emit({ type: "pose", pose: p })]),
    other: [
      ["Talking on/off", () => { talking = !talking; emit({ type: "talking", on: talking }); }],
      ["Reduced motion on/off", () => { reduced = !reduced; window.buddy.setReducedMotion(reduced); }],
      ["Light/dark background", () => document.body.classList.toggle("dark")],
      ["Bad commands (ignored)", () => {
        emit(null); emit({ type: "nope" }); emit({ type: "hop", x: "a", y: 3 }); emit({ type: "pose", pose: "dance" });
      }],
    ],
  };

  async function tour() {
    emit({ type: "hide" });
    await sleep(400);
    const h = topOf("helper");
    emit({ type: "show", x: h.x + 170, y: h.y });
    await sleep(1900);
    emit({ type: "talking", on: true });
    await sleep(1400);
    emit({ type: "talking", on: false });
    emit({ type: "scan", rect: area("article") });
    await sleep(4200);
    emit({ type: "pose", pose: "think" });
    await sleep(1800);
    const d = center("dl");
    emit({ type: "point", x: d.x, y: d.y, label: "Click “Download”" });
    await sleep(2600);
    const w = topOf("win");
    emit({ type: "hop", x: w.x + 260, y: w.y, pose: "carry" });
    await sleep(2200);
    emit({ type: "hop", x: h.x - 140, y: h.y, pose: "type" });
    await sleep(2000);
    emit({ type: "pose", pose: "stop" });
    await sleep(1800);
    emit({ type: "pose", pose: "sad" });
    await sleep(1800);
    emit({ type: "hop", x: h.x + 170, y: h.y, pose: "celebrate", label: "All done!" });
    await sleep(2600);
    emit({ type: "pose", pose: "idle" });
  }

  document.addEventListener("DOMContentLoaded", () => {
    for (const [name, items] of Object.entries(groups)) {
      const box = document.querySelector(`[data-group="${name}"]`);
      for (const [text, fn] of items) {
        const b = document.createElement("button");
        b.textContent = text;
        b.addEventListener("click", fn);
        box.appendChild(b);
      }
    }
    document.querySelector('[data-act="tour"]').addEventListener("click", tour);
    // Say hello on load.
    setTimeout(() => { const h = topOf("helper"); emit({ type: "show", x: h.x + 170, y: h.y }); }, 300);
  });
})();
