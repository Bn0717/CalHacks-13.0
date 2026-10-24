// The buddy: a little mascot that hops around the screen to where the work is.
// Listens on channel "buddy" for BuddyCommand messages (see src/app/protocol.ts).
// Looks come from buddy-sprite.js; this file only does motion, timing and bubbles.
(function () {
  "use strict";

  const S = window.BuddySprite;
  if (!S) { console.error("buddy: buddy-sprite.js must load first"); return; }

  const POSES = ["idle", "wave", "scan", "think", "type", "carry", "stop", "point", "celebrate", "sad", "talk"];
  const MARGIN = 8;
  const LABEL_MAX = 40;

  // ---------- DOM ----------
  const el = (cls, parent) => {
    const d = document.createElement("div");
    d.className = cls;
    if (parent) parent.appendChild(d);
    return d;
  };

  let layer = document.getElementById("buddy-layer");
  if (!layer) { layer = el(""); layer.id = "buddy-layer"; document.body.appendChild(layer); }

  const scanbox = el("buddy-scanbox", layer);
  const ring = el("buddy-ring", layer);
  const root = el("buddy is-hidden", layer);
  const shadow = el("buddy-shadow", root);
  const flip = el("buddy-flip", root);
  const squash = el("buddy-squash", flip);
  const motion = el("buddy-motion", squash);
  const pop = el("buddy-pop", motion);
  const spriteBox = el("buddy-sprite", pop);
  spriteBox.style.left = -S.anchor.x + "px";
  spriteBox.style.top = -S.anchor.y + "px";
  spriteBox.style.width = S.size.w + "px";
  spriteBox.style.height = S.size.h + "px";
  const shadowW = Math.round(S.size.w * 0.62);
  shadow.style.width = shadowW + "px";
  shadow.style.height = Math.round(shadowW / 4.5) + "px";
  shadow.style.left = -shadowW / 2 + "px";
  shadow.style.top = -Math.round(shadowW / 9) + "px";
  const label = el("buddy-label", layer);
  const labelText = el("buddy-label-text", label);

  // ---------- State ----------
  const st = {
    x: window.innerWidth / 2,
    y: window.innerHeight - 60,
    visible: false,
    pose: "idle",
    aim: "side",
    facing: 1,
    talking: false,
    air: false,
    walking: false,
    frame: 0,
    blinkUntil: 0,
    nextBlink: 0,
    glanceX: 0,
    glanceUntil: 0,
    nextGlance: 0,
    reduced: false,
    gen: 0, // bumps on hide, so running jobs stop
  };

  const mq = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  const setReduced = (v) => { st.reduced = !!v; layer.classList.toggle("reduced", st.reduced); };
  setReduced(mq && mq.matches);
  if (mq && mq.addEventListener) mq.addEventListener("change", (e) => setReduced(e.matches));

  const vw = () => window.innerWidth;
  const vh = () => window.innerHeight;
  const clamp = (v, a, b) => (a > b ? (a + b) / 2 : Math.min(b, Math.max(a, v)));
  const num = (v) => typeof v === "number" && Number.isFinite(v);

  // Keep the whole drawing (props too) on screen.
  function clampFeet(x, y, pose, facing) {
    const b = S.bounds(pose || st.pose);
    const f = facing || st.facing;
    const l = f > 0 ? b.left : -b.right;
    const r = f > 0 ? b.right : -b.left;
    return {
      x: clamp(x, MARGIN - l, vw() - MARGIN - r),
      y: clamp(y, MARGIN - b.top, vh() - MARGIN - 4),
    };
  }

  function place(x, y) {
    st.x = x; st.y = y;
    root.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }

  // ---------- Sprite frames ----------
  function draw() {
    if (!st.visible) return;
    const now = performance.now();
    let lookX = 0;
    let lookY = 0;
    if (st.pose === "scan" && !st.walking) {
      lookX = [0, -1, -1, 0, 1, 1][Math.floor(st.frame / 4) % 6];
    } else if (st.pose === "idle" || st.pose === "talk") {
      if (now > st.nextGlance) {
        st.glanceX = Math.random() < 0.5 ? -1 : 1;
        st.glanceUntil = now + 700 + Math.random() * 700;
        st.nextGlance = now + 4000 + Math.random() * 5000;
      }
      if (now < st.glanceUntil) lookX = st.glanceX;
    }
    if (st.air) lookX = 1;
    if (now > st.nextBlink) {
      st.blinkUntil = now + (Math.random() < 0.2 ? 330 : 130); // sometimes a slow blink
      st.nextBlink = now + 2200 + Math.random() * 3500;
    }
    const svg = S.render(st.pose, st.frame, {
      blink: now < st.blinkUntil,
      lookX,
      lookY,
      talking: st.talking,
      walk: st.walking,
      air: st.air,
      aim: st.aim,
    });
    spriteBox.replaceChildren(svg);
  }
  setInterval(() => { st.frame++; draw(); }, 1000 / (S.fps || 8));

  function setClasses() {
    root.className = "buddy pose-" + st.pose +
      (st.visible ? "" : " is-hidden") +
      (st.talking ? " talking" : "") +
      (st.air ? " in-air" : "") +
      (st.walking ? " walking" : "");
  }

  let tempPoseTimer = 0;
  function setPose(pose, aim) {
    clearTimeout(tempPoseTimer);
    const p = POSES.includes(pose) ? pose : "idle";
    const was = st.pose;
    st.pose = p;
    st.aim = aim || "side";
    setClasses();
    draw();
    if (p === "celebrate" && was !== "celebrate") {
      celebrateBurst();
      tempPoseTimer = setTimeout(() => { if (st.pose === "celebrate") celebrateBurst(); }, 1100);
    }
  }

  function face(dir, animate) {
    if (!dir || dir === st.facing) return;
    const from = st.facing;
    st.facing = dir;
    flip.style.transform = `scaleX(${dir})`;
    if (animate && !st.reduced) {
      track(flip.animate([{ transform: `scaleX(${from})` }, { transform: `scaleX(${dir})` }], { duration: 160, easing: "ease-in-out" }));
    }
  }

  // ---------- Animation helpers ----------
  const live = new Set();
  function track(anim) {
    live.add(anim);
    anim.finished.catch(() => {}).then(() => live.delete(anim));
    return anim;
  }
  const done = (anim) => anim.finished.catch(() => {});

  function wait(ms) {
    const g = st.gen;
    return new Promise((res) => setTimeout(() => res(g === st.gen), ms));
  }

  // ---------- Particles ----------
  function particle(cls, x, y) {
    const d = el("buddy-particle " + cls, layer);
    d.style.left = x + "px";
    d.style.top = y + "px";
    return d;
  }

  function dust(x, y, n, spread) {
    if (st.reduced) return;
    for (let i = 0; i < n; i++) {
      const d = particle("buddy-dust", x, y - 3);
      const side = i % 2 ? 1 : -1;
      const dx = side * (8 + Math.random() * spread);
      const dy = -(3 + Math.random() * 9);
      const s = 0.6 + Math.random() * 0.7;
      d.animate(
        [
          { transform: `translate(-50%, -50%) scale(${s})`, opacity: 0.9 },
          { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(${s * 0.4})`, opacity: 0 },
        ],
        { duration: 380 + Math.random() * 200, easing: "cubic-bezier(.2,.7,.3,1)" }
      ).finished.catch(() => {}).then(() => d.remove());
    }
  }

  const CONFETTI = ["#D77757", "#f6c445", "#5fc7a8", "#6ea8ff", "#ff7aa8", "#ffffff"];
  function celebrateBurst() {
    if (!st.visible) return;
    const cx = st.x;
    const cy = st.y + S.headY;
    const n = st.reduced ? 6 : 18;
    for (let i = 0; i < n; i++) {
      const d = particle("buddy-confetti", cx, cy);
      d.style.background = CONFETTI[i % CONFETTI.length];
      if (i % 3 === 0) d.classList.add("spark");
      if (st.reduced) {
        const a = (i / n) * Math.PI * 2;
        d.style.left = cx + Math.cos(a) * 46 + "px";
        d.style.top = cy + Math.sin(a) * 30 + "px";
        d.animate([{ opacity: 0 }, { opacity: 1 }, { opacity: 0 }], { duration: 900 }).finished.then(() => d.remove());
        continue;
      }
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
      const v = 60 + Math.random() * 80;
      const dx = Math.cos(a) * v;
      const dy = Math.sin(a) * v;
      const spin = (Math.random() < 0.5 ? -1 : 1) * (180 + Math.random() * 360);
      d.animate(
        [
          { transform: "translate(-50%, -50%) rotate(0deg) scale(0.4)", opacity: 1 },
          { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${spin / 2}deg) scale(1)`, opacity: 1, offset: 0.4 },
          { transform: `translate(calc(-50% + ${dx * 1.4}px), calc(-50% + ${dy + 90}px)) rotate(${spin}deg) scale(0.8)`, opacity: 0 },
        ],
        { duration: 1000 + Math.random() * 500, easing: "cubic-bezier(.15,.6,.4,1)" }
      ).finished.catch(() => {}).then(() => d.remove());
    }
  }

  // ---------- Label bubble ----------
  function cleanText(t) {
    let s = String(t == null ? "" : t).replace(/\s+/g, " ").trim();
    if (s.length > LABEL_MAX) s = s.slice(0, LABEL_MAX - 1).trimEnd() + "…";
    return s;
  }

  function showLabel(text, awayFrom) {
    const s = cleanText(text);
    if (!s) { hideLabel(); return; }
    labelText.textContent = s; // text only, never HTML
    label.classList.add("on");
    label.classList.remove("below");
    const w = label.offsetWidth;
    const h = label.offsetHeight;
    const b = S.bounds(st.pose);
    // Above the head; lean away from the point target so it stays visible.
    let left = st.x - w / 2;
    if (awayFrom === 1) left = st.x + 30 - w;
    else if (awayFrom === -1) left = st.x - 30;
    let top = st.y + b.top - 14 - h;
    if (top < MARGIN) { top = st.y + 14; label.classList.add("below"); }
    left = clamp(left, MARGIN, vw() - MARGIN - w);
    top = clamp(top, MARGIN, vh() - MARGIN - h);
    label.style.left = left + "px";
    label.style.top = top + "px";
    label.style.setProperty("--tail-x", clamp(st.x - left, 14, w - 14) + "px");
    if (!st.reduced) {
      label.animate(
        [{ transform: "scale(0.6)", opacity: 0 }, { transform: "scale(1.06)", opacity: 1, offset: 0.6 }, { transform: "scale(1)", opacity: 1 }],
        { duration: 260, easing: "cubic-bezier(.2,.8,.3,1.2)" }
      );
    }
  }
  function hideLabel() { label.classList.remove("on"); }

  function showRing(x, y) {
    ring.style.left = x + "px";
    ring.style.top = y + "px";
    ring.classList.add("on");
  }
  function hideRing() { ring.classList.remove("on"); }

  function showScanbox(r) {
    scanbox.style.left = r.x + "px";
    scanbox.style.top = r.y + "px";
    scanbox.style.width = r.width + "px";
    scanbox.style.height = r.height + "px";
    scanbox.classList.add("on");
  }
  function hideScanbox() { scanbox.classList.remove("on"); }

  function clearExtras() { hideLabel(); hideRing(); hideScanbox(); }

  // ---------- Moves ----------
  let outAnim = null;
  async function popIn(x, y, pose, facing) {
    if (outAnim) { outAnim.cancel(); outAnim = null; }
    const p = clampFeet(x, y, pose, facing);
    place(p.x, p.y);
    st.visible = true;
    setPose(pose);
    if (st.reduced) {
      await done(track(pop.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 })));
      return;
    }
    dust(p.x, p.y, 6, 18);
    await done(track(pop.animate(
      [
        { transform: "scale(0)", opacity: 0 },
        { transform: "scale(1.18, 0.9)", opacity: 1, offset: 0.55 },
        { transform: "scale(0.94, 1.06)", offset: 0.8 },
        { transform: "scale(1)", opacity: 1 },
      ],
      { duration: 460, easing: "cubic-bezier(.2,.7,.3,1)" }
    )));
  }

  async function popOut() {
    if (!st.visible) return;
    st.visible = false;
    const a = st.reduced
      ? pop.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, fill: "forwards" })
      : pop.animate(
        [{ transform: "scale(1)", opacity: 1 }, { transform: "scale(1.12, 0.9)", opacity: 1, offset: 0.35 }, { transform: "scale(0)", opacity: 0 }],
        { duration: 280, easing: "cubic-bezier(.5,0,.8,.4)", fill: "forwards" }
      );
    outAnim = a;
    await done(a);
    if (outAnim !== a) return; // shown again meanwhile
    outAnim = null;
    a.cancel();
    setClasses();
    spriteBox.replaceChildren();
  }

  // Reduced motion: fade out, move, fade in.
  async function fadeMove(x, y) {
    const g = st.gen;
    const out = track(root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, fill: "forwards" }));
    await done(out);
    if (g !== st.gen) return;
    place(x, y);
    const back = track(root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160 }));
    out.cancel();
    await done(back);
  }

  // One jump along an arc, with squash and stretch.
  async function oneHop(x1, y1, speed) {
    const g = st.gen;
    const x0 = st.x;
    const y0 = st.y;
    const d = Math.hypot(x1 - x0, y1 - y0);
    const dur = clamp(320 + d * 0.55, 350, 900) * speed;
    const b = S.bounds("idle");
    let h = clamp(36 + d * 0.22, 46, 170);
    h = Math.max(10, Math.min(h, Math.min(y0, y1) + b.top - MARGIN)); // don't fly off the top

    // Anticipation: crouch.
    const crouch = track(squash.animate(
      [{ transform: "scale(1, 1)" }, { transform: "scale(1.2, 0.76)" }],
      { duration: 120 * speed, easing: "cubic-bezier(.3,0,.6,1)", fill: "forwards" }
    ));
    await done(crouch);
    if (g !== st.gen) return false;

    st.air = true;
    setClasses();
    draw();
    dust(x0, y0, 3, 10);

    // The arc: x moves steadily, y follows a parabola. Shadow stays on the ground line.
    const N = 24;
    const path = [];
    const shade = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const arc = 4 * h * t * (1 - t);
      path.push({ transform: `translate3d(${x0 + (x1 - x0) * t}px, ${y0 + (y1 - y0) * t - arc}px, 0)` });
      const k = 1 - 0.55 * (arc / 170);
      shade.push({ transform: `translate(0, ${arc}px) scale(${k})`, opacity: 0.35 + 0.65 * k });
    }
    const opt = { duration: dur, easing: "linear" };
    const move = track(root.animate(path, opt));
    track(shadow.animate(shade, opt));
    track(squash.animate(
      [
        { transform: "scale(0.84, 1.2) rotate(6deg)" },
        { transform: "scale(1, 1) rotate(2deg)", offset: 0.45 },
        { transform: "scale(1, 1) rotate(-2deg)", offset: 0.6 },
        { transform: "scale(0.9, 1.12) rotate(-5deg)" },
      ],
      opt
    ));
    crouch.cancel();
    place(x1, y1); // final spot sits under the running animation, so no flicker at the end
    await done(move);
    if (g !== st.gen) return false;

    st.air = false;
    setClasses();
    draw();
    dust(x1, y1, 6, 18);
    await done(track(squash.animate(
      [
        { transform: "scale(1.3, 0.7)" },
        { transform: "scale(0.93, 1.09)", offset: 0.45 },
        { transform: "scale(1.03, 0.97)", offset: 0.75 },
        { transform: "scale(1, 1)" },
      ],
      { duration: 300 * Math.max(0.7, speed), easing: "cubic-bezier(.2,.7,.3,1)" }
    )));
    return g === st.gen;
  }

  // Hop to a point. Long trips become 2-3 hops. Faces the way it travels.
  async function hopTo(x, y, landPose, landFacing) {
    const p = clampFeet(x, y, landPose, landFacing);
    if (!st.visible) {
      if (landFacing) face(landFacing, false);
      await popIn(p.x, p.y, landPose, landFacing);
      return true;
    }
    const dx = p.x - st.x;
    const d = Math.hypot(dx, p.y - st.y);
    if (d < 4) return true;
    if (Math.abs(dx) > 6) face(dx > 0 ? 1 : -1, true);
    if (["point", "stop", "sad", "think", "type"].includes(st.pose)) setPose("idle"); // drop props before jumping
    if (st.reduced) { await fadeMove(p.x, p.y); return true; }
    const n = d > 1300 ? 3 : d > 650 ? 2 : 1;
    const speed = queue.length ? 0.72 : 1; // hurry if more is waiting
    const sx = st.x;
    const sy = st.y;
    for (let i = 1; i <= n; i++) {
      const ok = await oneHop(sx + (p.x - sx) * (i / n), sy + (p.y - sy) * (i / n), speed);
      if (!ok) return false;
      if (i < n && !(await wait(60))) return false;
    }
    return true;
  }

  // Crab scuttle along a line (used while scanning).
  async function scuttle(x1, y1) {
    const p = clampFeet(x1, y1, "scan");
    const d = Math.hypot(p.x - st.x, p.y - st.y);
    if (d < 4) return true;
    if (st.reduced) { await fadeMove(p.x, p.y); return true; }
    const g = st.gen;
    st.walking = true;
    setClasses();
    const a = track(root.animate(
      [{ transform: `translate3d(${st.x}px, ${st.y}px, 0)` }, { transform: `translate3d(${p.x}px, ${p.y}px, 0)` }],
      { duration: clamp(d * 3.2, 250, 1100), easing: "cubic-bezier(.45,0,.55,1)" }
    ));
    place(p.x, p.y);
    await done(a);
    if (g !== st.gen) return false;
    st.walking = false;
    setClasses();
    return true;
  }

  // ---------- Commands ----------
  async function doShow(c) {
    clearExtras();
    const pose = POSES.includes(c.pose) ? c.pose : null;
    if (st.visible) { await hopTo(c.x, c.y, pose || st.pose); setPose(pose || st.pose); return; }
    await popIn(c.x, c.y, pose || "wave");
    if (!pose) tempPoseTimer = setTimeout(() => { if (st.pose === "wave") setPose("idle"); }, 1800);
  }

  async function doHop(c) {
    clearExtras();
    const pose = POSES.includes(c.pose) ? c.pose : "idle";
    if (!(await hopTo(c.x, c.y, pose))) return;
    setPose(pose);
    if (c.label) showLabel(c.label);
  }

  // Pick a side and aim so the claw tip lands right next to the target.
  function pointSpot(tx, ty) {
    const GAP = 26; // claw tip stops just outside the ring
    const need = S.tips.side.x + GAP + S.size.w / 2 + MARGIN;
    const roomR = vw() - tx;
    const roomL = tx;
    // Stand on the side the buddy is already on, if there's room there.
    let facing = st.x <= tx ? 1 : -1; // facing right = standing left of the target
    const here = facing === 1 ? roomL : roomR;
    const there = facing === 1 ? roomR : roomL;
    if (here < need && there > here) facing = -facing;

    let best = null;
    for (const aim of ["side", "up", "down"]) {
      const tip = S.tips[aim];
      const gx = aim === "side" ? GAP : GAP * 0.7;
      const gy = aim === "up" ? -GAP * 0.7 : aim === "down" ? GAP * 0.7 : 0;
      const want = { x: tx - facing * (tip.x + gx), y: ty - tip.y - gy };
      const p = clampFeet(want.x, want.y, "point", facing);
      const err = Math.hypot(p.x - want.x, p.y - want.y);
      if (!best || err < best.err - 6) best = { x: p.x, y: p.y, aim, err };
    }
    return { x: best.x, y: best.y, aim: best.aim, facing };
  }

  async function doPoint(c) {
    clearExtras();
    const tx = clamp(c.x, 0, vw());
    const ty = clamp(c.y, 0, vh());
    const spot = pointSpot(tx, ty);
    if (!(await hopTo(spot.x, spot.y, "point", spot.facing))) return;
    face(spot.facing, true);
    setPose("point", spot.aim);
    showRing(tx, ty);
    showLabel(c.label, spot.facing);
  }

  async function doScan(c) {
    clearExtras();
    const r = c.rect || {};
    if (![r.x, r.y, r.width, r.height].every(num)) return;
    const x0 = clamp(r.x, 0, vw());
    const y0 = clamp(r.y, 0, vh());
    const rect = { x: x0, y: y0, width: clamp(r.width, 0, vw() - x0), height: clamp(r.height, 0, vh() - y0) };
    showScanbox(rect);
    const left = rect.x + 36;
    const right = Math.max(left, rect.x + rect.width - 36);
    if (!(await hopTo(left, rect.y, "scan"))) return;
    setPose("scan");
    face(1, true);
    const stops = clamp(Math.round(rect.width / 260) + 1, 2, 5);
    for (let i = 1; i <= stops; i++) {
      if (!(await wait(i === 1 ? 900 : 750))) return;
      if (queue.length) break; // something new to do: stop looking
      if (!(await scuttle(left + ((right - left) * i) / stops, rect.y))) return;
    }
    if (!queue.length && !(await wait(600))) return;
    hideScanbox();
  }

  // Runs commands one at a time, in order.
  const queue = [];
  let running = false;
  async function pump() {
    if (running) return;
    running = true;
    while (queue.length) {
      const c = queue.shift();
      try {
        if (c.type === "show") await doShow(c);
        else if (c.type === "hop") await doHop(c);
        else if (c.type === "point") await doPoint(c);
        else if (c.type === "scan") await doScan(c);
        else if (c.type === "pose") {
          clearExtras();
          if (st.visible) setPose(c.pose);
          else st.pose = POSES.includes(c.pose) ? c.pose : "idle";
        }
      } catch (e) {
        console.error("buddy:", e);
      }
    }
    running = false;
  }

  // Stop everything right where it is (used by hide).
  function interrupt() {
    st.gen++;
    queue.length = 0;
    let x = st.x;
    let y = st.y;
    try {
      const m = new DOMMatrixReadOnly(getComputedStyle(root).transform);
      x = m.m41; y = m.m42;
    } catch (e) { /* keep last spot */ }
    for (const a of live) a.cancel();
    live.clear();
    squash.style.transform = "";
    st.air = false;
    st.walking = false;
    place(x, y);
    setClasses();
  }

  function handle(cmd) {
    if (!cmd || typeof cmd !== "object") return;
    switch (cmd.type) {
      case "talking":
        st.talking = !!cmd.on;
        setClasses();
        draw();
        return;
      case "hide":
        interrupt();
        clearExtras();
        popOut();
        return;
      case "show":
      case "hop":
        if (!num(cmd.x) || !num(cmd.y)) return;
        break;
      case "point":
        if (!num(cmd.x) || !num(cmd.y)) return;
        break;
      case "scan":
        if (!cmd.rect) return;
        break;
      case "pose":
        if (!POSES.includes(cmd.pose)) return;
        break;
      default:
        return;
    }
    if (queue.length > 12) queue.splice(0, queue.length - 12); // drop stale moves
    queue.push(cmd);
    pump();
  }

  window.addEventListener("resize", () => {
    const p = clampFeet(st.x, st.y);
    place(p.x, p.y);
  });

  place(st.x, st.y);
  setClasses();

  window.buddy = {
    handle,
    setReducedMotion: setReduced,
    state: () => ({ x: st.x, y: st.y, visible: st.visible, pose: st.pose, aim: st.aim, facing: st.facing, talking: st.talking, queued: queue.length }),
  };

  if (window.calhack && typeof window.calhack.on === "function") window.calhack.on("buddy", handle);
})();
