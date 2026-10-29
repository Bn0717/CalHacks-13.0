// The lesson screen. It draws whatever LessonView the app sends on "lesson" (see src/app/protocol.ts) and sends the
// student's taps back. It sits in a narrow window docked beside VS Code, so it never covers the code.
// All text is inserted as plain text (never HTML). The thinking (words, buttons, keys) lives in lesson-model.js.
(() => {
  "use strict";

  const M = window.StrideLessonModel;
  const api = window.calhack || { send() {}, on() {} };
  const root = document.getElementById("lesson-root");
  if (!M || !root) { console.error("lesson: lesson-model.js and #lesson-root are needed"); return; }

  const reduceMotion = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false, addEventListener() {} };
  const store = (() => { try { return window.localStorage; } catch { return null; } })();

  let view = { screen: "hidden" };
  let prevView = null;
  let layout = M.readLayout(store);
  let tempOpen = false; // opened by the app for one step (a new idea), not by the student
  let local = freshLocal();
  let actionsNow = []; // every button with a key, for shortcuts

  function freshLocal() {
    return { picked: null, fixing: false, correction: "", hintOfferDismissed: false, recapOpen: false };
  }

  const send = (channel, data) => {
    try { api.send(channel, data); } catch { /* the app went away */ }
  };

  // ---------------- Small helpers ----------------

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  // Line icons (24 x 24), drawn as SVG paths.
  const PATHS = {
    check: ["M5 12.5l4.5 4.5L19 7.5"],
    cross: ["M7 7l10 10", "M17 7L7 17"],
    bulb: ["M9 18h6", "M10 21h4", "M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"],
    play: ["M8 5.5v13l10.5-6.5z"],
    hand: ["M8 12V6.5a1.5 1.5 0 0 1 3 0V11", "M11 10.5V5a1.5 1.5 0 0 1 3 0v5.5", "M14 10.5V7a1.5 1.5 0 0 1 3 0v7a6 6 0 0 1-6 6h-.5a5.5 5.5 0 0 1-4.6-2.5L4.3 15a1.5 1.5 0 0 1 2.4-1.8L8 14.5"],
    bot: ["M12 4v3", "M6 8h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z", "M9 13v.5", "M15 13v.5"],
    eye: ["M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"],
    swap: ["M7 7h13", "M16 3l4 4-4 4", "M17 17H4", "M8 13l-4 4 4 4"],
    pause: ["M9 5.5v13", "M15 5.5v13"],
    chevron: ["M6.5 9.5l5.5 5.5 5.5-5.5"],
    arrowL: ["M19 12H5", "M11 6l-6 6 6 6"],
    arrowR: ["M5 12h14", "M13 6l6 6-6 6"],
    link: ["M14 4h6v6", "M20 4l-9 9", "M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"],
    image: ["M4 5h16v14H4z", "M4 16l5-5 4 4 3-3 4 4", "M15.5 9.5v.1"],
    palette: ["M12 3a9 9 0 1 0 0 18c1 0 1.5-.7 1.5-1.5 0-.5-.3-.9-.3-1.4 0-.8.6-1.4 1.4-1.4H17a4 4 0 0 0 4-4C21 7 17 3 12 3z", "M7.5 11.5v.1", "M10.5 7.5v.1", "M15 8v.1"],
    type: ["M3 7h18v10H3z", "M7 11h.01", "M11 11h.01", "M15 11h.01", "M8 14.5h8"],
    clock: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 7.5V12l3 2"],
    code: ["M8 8l-4 4 4 4", "M16 8l4 4-4 4", "M14 5l-4 14"],
    list: ["M9 6h11", "M9 12h11", "M9 18h11", "M4.5 6v.1", "M4.5 12v.1", "M4.5 18v.1"],
    star: ["M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"],
    wifiOff: ["M3 3l18 18", "M8.5 16.5a5 5 0 0 1 7 0", "M5 12.5a10 10 0 0 1 4-2.3", "M15 10.2a10 10 0 0 1 4 2.3", "M1.5 8.5a15 15 0 0 1 5-3", "M12 4.5a15 15 0 0 1 10.5 4", "M12 20h.01"],
    key: ["M10.5 13.5L3 21", "M6 18l2.5 2.5", "M15 3.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11z"],
    videoOff: ["M3 6h12v12H3z", "M15 10l6-3.5v11L15 14", "M2 2l20 20"],
    alert: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 7.5v5.5", "M12 16.3v.2"],
    flag: ["M5 21V4", "M5 4h11l-2 4 2 4H5"],
    keyboard: ["M3 6.5h18v11H3z", "M6.5 10h1", "M10 10h1", "M13.5 10h1", "M17 10h.5", "M7.5 14h9"],
  };
  const SVG = "http://www.w3.org/2000/svg";
  function icon(name, cls = "") {
    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.setAttribute("class", ("ico " + cls).trim());
    for (const d of PATHS[name] || []) {
      const p = document.createElementNS(SVG, "path");
      p.setAttribute("d", d);
      svg.append(p);
    }
    return svg;
  }

  // Shows <tags> and `code` inside a sentence in a code font, as text.
  function rich(text) {
    const frag = document.createDocumentFragment();
    const parts = M.explainTerms(String(text)).split(/(<\/?[a-zA-Z!][^<>]*>|`[^`]+`)/g);
    for (const part of parts) {
      if (!part) continue;
      if (/^<\/?[a-zA-Z!][^<>]*>$/.test(part)) frag.append(el("code", { class: "inline" }, part));
      else if (/^`[^`]+`$/.test(part)) frag.append(el("code", { class: "inline" }, part.slice(1, -1)));
      else frag.append(document.createTextNode(part));
    }
    return frag;
  }

  /** A button from a model action: { id, label, channel, data, key, kind, icon, disabled, run }. */
  function button(spec) {
    const cls = "lbtn " + (spec.kind || "secondary") + (spec.wide ? " wide" : "") + (spec.cls ? " " + spec.cls : "");
    const b = el(
      "button",
      {
        type: "button",
        class: cls,
        "data-key": spec.id,
        "aria-keyshortcuts": spec.key && spec.key.length === 1 ? spec.key : null,
        "aria-label": spec.ariaLabel || null,
        "aria-pressed": spec.pressed === undefined ? null : String(!!spec.pressed),
        "aria-describedby": spec.describedby || null,
        disabled: spec.disabled || null,
      },
      spec.icon ? icon(spec.icon, "sm") : null,
      el("span", { class: "lbtn-label" }, spec.rich ? rich(spec.label) : spec.label),
      spec.key && spec.key.length === 1 ? el("kbd", { "aria-hidden": "true" }, spec.key) : null,
    );
    b.addEventListener("click", () => run(spec));
    return b;
  }

  function run(spec) {
    if (spec.disabled) return;
    if (spec.run) spec.run();
    else if (spec.channel) send(spec.channel, spec.data);
  }

  const mark = (status) => {
    const m = el("span", { class: "lmark " + status, "aria-hidden": "true" });
    if (status === "done") m.append(icon("check"));
    else if (status === "failed") m.append(icon("cross"));
    else if (status === "running") m.append(el("span", { class: "spin" }));
    return m;
  };
  const statusWord = { todo: "Not yet", running: "Doing it now", done: "Done", failed: "Didn't work" };

  // "Busy" on the status row: a spinner, or with Reduce Motion a still picture of what's happening.
  function busyIcon(status) {
    if (!reduceMotion.matches) return el("span", { class: "spin", "aria-hidden": "true" });
    return icon(status === "showing" ? "type" : status === "stride-working" ? "bot" : "eye", "sm busy");
  }

  // ---------------- The card (built once) ----------------

  const card = el("section", { class: "lcard is-hidden", id: "lesson-card", role: "region", "aria-labelledby": "l-title" });
  const strip = el("div", { class: "lstrip", id: "l-strip" });
  const buddyBox = el("div", { class: "lbuddy", "aria-hidden": "true" });
  const eyebrow = el("p", { class: "leyebrow", id: "l-eyebrow" });
  const title = el("h1", { class: "ltitle", id: "l-title", tabindex: "-1" });
  const tools = el("div", { class: "ltools" });
  // The badge and the header buttons share the top row, so the step title gets the whole width under them.
  const head = el("header", { class: "lhead" }, buddyBox, el("div", { class: "lhead-top" }, eyebrow, tools), title);
  // The text part scrolls at big text sizes; it's a stop for Tab then, so keyboard users can scroll it too.
  const body = el("div", { class: "lbody", id: "l-body", role: "region", "aria-label": "Lesson text" });
  const actions = el("div", { class: "lactions", id: "l-actions" });
  const live = el("div", { class: "sr-only", "aria-live": "polite", "aria-atomic": "true", id: "l-live" });
  const alertLive = el("div", { class: "sr-only", role: "alert", id: "l-alert" });
  card.append(strip, head, body, actions);
  root.append(card, live, alertLive);

  // ---------------- The buddy, on the card ----------------

  const buddy = { pose: "idle", look: 0, aim: "side", frame: 0, timer: 0 };
  function drawBuddy() {
    const S = window.BuddySprite;
    if (!S) return;
    const facingLeft = layout.dock === "right"; // the code is on the left
    const svg = S.render(buddy.pose, buddy.frame, { aim: buddy.aim, lookX: buddy.look, lookY: 0, blink: false });
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.setAttribute("class", "lbuddy-svg");
    buddyBox.classList.toggle("face-left", facingLeft);
    buddyBox.dataset.pose = buddy.pose;
    buddyBox.replaceChildren(svg);
  }
  function setBuddy(next) {
    const changed = next.pose !== buddy.pose || (next.look || 0) !== buddy.look;
    buddy.pose = next.pose || "idle";
    buddy.look = next.look || 0;
    buddy.aim = next.aim || "side";
    if (changed) buddy.frame = 0;
    drawBuddy();
    clearInterval(buddy.timer);
    buddy.timer = 0;
    if (!reduceMotion.matches && !document.documentElement.classList.contains("still")) {
      const fps = (window.BuddySprite && window.BuddySprite.fps) || 8;
      buddy.timer = setInterval(() => { buddy.frame += 1; drawBuddy(); }, 1000 / fps);
    }
  }

  // ---------------- Layout: where the card sits ----------------

  const isExpanded = () => layout.expanded || tempOpen;

  function applyLayout() {
    root.dataset.dock = layout.dock;
    card.classList.toggle("is-expanded", isExpanded());
  }

  function changeLayout(action, { persist = true } = {}) {
    if (action.type === "toggle" && tempOpen) { tempOpen = false; layout = M.layoutReduce(layout, { type: "close" }); }
    else {
      if (action.type === "close") tempOpen = false;
      layout = M.layoutReduce(layout, action);
    }
    if (persist) M.writeLayout(store, layout);
    send("lesson-layout", { ...layout });
    applyLayout();
    render();
  }

  // ---------------- Pieces shared by screens ----------------

  function drawStrip(progress, label) {
    if (!progress) { strip.hidden = true; strip.replaceChildren(); return; }
    strip.hidden = false;
    const groups = M.segments(progress);
    const total = progress.steps.length;
    const done = progress.steps.filter((s) => s.mark !== "todo").length;
    const bar = el("div", {
      class: "lstrip-bar",
      role: "progressbar",
      "aria-label": "Lesson progress",
      "aria-valuemin": "0",
      "aria-valuemax": String(total),
      "aria-valuenow": String(done),
      "aria-valuetext": M.progressText(progress),
    });
    for (const g of groups) {
      const chap = el("div", { class: "lchap" + (g.current ? " is-current" : ""), title: g.title });
      chap.style.flexGrow = String(g.steps.length); // CSSOM, allowed by the page's CSP
      for (const s of g.steps) chap.append(el("span", { class: "lseg " + s.mark + (s.current ? " is-current" : "") }));
      bar.append(chap);
    }
    // Under the strip: the chapter on the left, where they are on the right.
    const words = label ? el("p", { class: "lstrip-label", "aria-hidden": "true" }, el("span", { class: "lstrip-chapter" }, label.left || ""), el("span", { class: "lstrip-count" }, label.right || "")) : null;
    strip.replaceChildren(bar, words || "");
  }

  function hintBox(text, n, latest) {
    const code = M.isCode(text);
    return el(
      "div",
      { class: "lhint" + (latest ? " is-latest" : "") },
      el("p", { class: "lhint-label" }, icon("bulb", "xs"), el("span", { class: "nowrap" }, "Hint " + n + " of 3"), n === 3 ? el("span", { class: "lhint-sub nowrap" }, "· part of the code") : null),
      code ? el("pre", { class: "lcode" }, text) : el("p", { class: "lhint-text" }, rich(text)),
      n === 3 && code ? el("p", { class: "lhint-text small" }, "Fill in the dots with your own words.") : null,
    );
  }

  function section(titleText, iconName, ...children) {
    return el("section", { class: "lsec" }, el("h2", { class: "lsec-title" }, iconName ? icon(iconName, "xs") : null, titleText), ...children);
  }

  // ---------------- Screens ----------------
  // Each returns { eyebrow, title, body: [nodes], actions: [specs], tools: [specs], strip, more: [nodes] | null, tone }.

  function screenBuilding(v) {
    const stages = M.buildingStages(v); // the real stages: sent ticked, or as labels plus the one running now
    const doneCount = stages.filter((s) => s.status === "done").length;
    const runningIndex = stages.findIndex((s) => s.status === "running");
    const partNo = runningIndex >= 0 ? runningIndex + 1 : Math.min(doneCount + 1, stages.length);
    return {
      eyebrow: "Building your lesson · part " + partNo + " of " + stages.length,
      title: v.what,
      body: [
        el("p", { class: "lead" }, "I'm making the whole thing first, so every step works when you get to it."),
        el(
          "ol",
          { class: "lticks", "aria-label": "What I'm doing" },
          stages.map((s) => el("li", { class: "ltick " + s.status }, mark(s.status), el("span", { class: "ltick-label" }, rich(s.label), el("span", { class: "sr-only" }, ". " + statusWord[s.status])))),
        ),
        el("p", { class: "muted small" }, icon("clock", "xs"), v.note || "This usually takes under a minute. You can leave this open."),
      ],
      actions: [{ id: "stop", label: "Stop", channel: "lesson-close", kind: "quiet" }],
    };
  }

  function screenQuestion(v) {
    if (!local.picked || local.picked.id !== v.id) local.picked = { id: v.id, list: [...(v.picked || [])] };
    const picked = local.picked.list;
    const choices = el("div", { class: "lchoices", role: "group", "aria-labelledby": "l-title" });
    v.options.forEach((opt, i) => {
      const on = picked.includes(opt);
      choices.append(button({
        id: "opt-" + i,
        label: opt,
        kind: "choice",
        icon: v.multi ? (on ? "check" : null) : null,
        pressed: v.multi ? on : undefined,
        cls: on ? "is-on" : "",
        run: () => {
          if (!v.multi) { send("lesson-answer", { id: v.id, answers: [opt] }); return; }
          local.picked.list = on ? picked.filter((p) => p !== opt) : [...picked, opt];
          render();
        },
      }));
    });
    const extras = (v.extras || []).map((x) =>
      button(x === "addPicture"
        ? { id: "add-picture", label: "Add a picture", icon: "image", kind: "secondary", channel: "lesson-extra", data: { kind: "addPicture" } }
        : { id: "show-styles", label: "Show me styles", icon: "palette", kind: "secondary", channel: "lesson-extra", data: { kind: "showStyles" } }),
    );
    const acts = [];
    if (v.multi) acts.push({ id: "next", label: picked.length ? "Next" : "Pick at least one", kind: "primary", disabled: picked.length === 0, channel: "lesson-answer", data: { id: v.id, answers: [...picked] } });
    acts.push({ id: "skip-q", label: "Skip this question", kind: "quiet", channel: "lesson-answer", data: { id: v.id, answers: [] } });
    return {
      eyebrow: "Question " + v.number + " of " + v.total,
      title: v.question,
      body: [
        el("p", { class: "muted" }, v.multi ? "Tap all that fit, then Next." : "Tap one. There's no wrong answer."),
        choices,
        extras.length ? el("div", { class: "lextras" }, el("p", { class: "muted small" }, "Or:"), extras) : null,
      ],
      actions: acts,
    };
  }

  function screenPicture(v) {
    const list = el("ul", { class: "lparts" }, v.sections.map((s) => el("li", {}, el("strong", {}, s.name), el("span", { class: "muted" }, s.description))));
    const bodyNodes = [
      v.image ? el("img", { class: "lpicture", src: v.image, alt: "Your picture" }) : null,
      el("p", { class: "lead" }, rich(v.summary)),
      list,
    ];
    let acts;
    if (local.fixing) {
      const box = el("textarea", { class: "lfield", id: "l-fix", rows: "3", placeholder: "For example: there are 2 cards, not 3" });
      box.value = local.correction;
      box.addEventListener("input", () => { local.correction = box.value; syncSend(); });
      const syncSend = () => {
        const b = actions.querySelector('[data-key="send-fix"]');
        if (b) b.disabled = local.correction.trim() === "";
      };
      bodyNodes.push(el("label", { class: "lfield-label", for: "l-fix" }, "What should be different?"), box);
      acts = [
        { id: "send-fix", label: "Send", kind: "primary", disabled: local.correction.trim() === "", run: () => send("lesson-picture", { ok: false, correction: local.correction.trim() }) },
        { id: "cancel-fix", label: "Never mind", kind: "quiet", run: () => { local.fixing = false; render(); } },
      ];
    } else {
      bodyNodes.push(el("p", { class: "lask" }, "Did I get it right?"));
      acts = [
        { id: "pic-yes", label: "Yes, that's it", kind: "primary", icon: "check", channel: "lesson-picture", data: { ok: true } },
        { id: "pic-fix", label: "Change something", kind: "secondary", run: () => { local.fixing = true; render(); focusKey("l-fix"); } },
      ];
    }
    return { eyebrow: "Your picture", title: "Here's what I see", body: bodyNodes, actions: acts };
  }

  function stats(estimate) {
    return el(
      "ul",
      { class: "lstats" },
      el("li", {}, icon("clock", "xs"), el("span", {}, M.minutesText(estimate.minutes))),
      el("li", {}, icon("code", "xs"), el("span", {}, "~" + estimate.linesToType + " lines to type")),
      el("li", {}, icon("list", "xs"), el("span", {}, estimate.steps + " steps")),
    );
  }

  function learnsList(heading, list) {
    if (!list || !list.length) return null;
    return el("div", { class: "llearns" }, el("h2", { class: "lsec-title" }, heading), el("ul", { class: "lchips" }, list.map((l) => el("li", {}, l))));
  }

  // The time, lines and steps come first: they're what the student needs to decide, and stay on screen at big text sizes.
  function screenEstimate(v) {
    if (!v.simpler) {
      return {
        eyebrow: "Before we start",
        title: v.title,
        body: [stats(v.estimate), el("p", { class: "lead" }, rich(v.outcome)), learnsList("You'll learn", v.learns)],
        actions: [{ id: "start", label: "Let's start", kind: "primary", wide: true, channel: "lesson-choose", data: { version: "full" } }],
      };
    }
    const simple = el(
      "div",
      { class: "loffer is-recommended", id: "offer-simple" },
      el("p", { class: "loffer-tag" }, icon("star", "xs"), "Recommended: start small"),
      el("h2", { class: "loffer-title" }, v.simpler.title),
      stats(v.simpler.estimate),
      el("p", { class: "loffer-why" }, rich(v.simpler.why)),
      learnsList("You'll learn", v.simpler.learns), // what this simple version teaches, not the whole lesson
    );
    // The full version: there, honest, but clearly the second choice.
    const full = el(
      "div",
      { class: "loffer is-alt" },
      el("h2", { class: "loffer-title small" }, "Or the whole thing"),
      el("p", { class: "loffer-why" }, M.minutesText(v.estimate.minutes) + " · ~" + v.estimate.linesToType + " lines · " + v.estimate.steps + " steps"),
      button({ id: "full", label: "Do the full version", kind: "secondary", channel: "lesson-choose", data: { version: "full" } }),
    );
    return {
      eyebrow: "Before we start",
      title: v.title,
      body: [simple, full, el("p", { class: "muted small" }, "You can add the rest later in short lessons.")],
      // The obvious choice sits in the button row, so it's on screen at any text size.
      actions: [{ id: "simple", label: "Start simple (recommended)", kind: "primary", wide: true, channel: "lesson-choose", data: { version: "simple" } }],
    };
  }

  function screenSetup(v) {
    const nodes = [
      el("p", { class: "lead" }, v.ask ? "One quick question first." : "You don't need to do anything yet."),
      el("ul", { class: "lticks", "aria-label": "Getting ready" }, v.items.map((s) => el("li", { class: "ltick " + s.status }, mark(s.status), el("span", { class: "ltick-label" }, s.label, s.detail ? el("span", { class: "ltick-detail" }, s.detail) : null, el("span", { class: "sr-only" }, ". " + statusWord[s.status]))))),
    ];
    let acts = [];
    if (v.ask) {
      nodes.push(el("div", { class: "lask-box" }, el("p", { class: "lask" }, v.ask.question), el("p", { class: "muted" }, rich(v.ask.why))));
      acts = [
        { id: "setup-yes", label: v.ask.yes, kind: "primary", channel: "lesson-setup", data: { yes: true } },
        { id: "setup-no", label: v.ask.no, kind: "secondary", channel: "lesson-setup", data: { yes: false } },
      ];
    }
    return { eyebrow: "Getting ready", title: "I'll do the boring part", body: nodes, actions: acts };
  }

  function stepTools(v) {
    const t = [{ id: "swap", label: "Move to the other side", keyLabel: "Move the card", key: "D", icon: "swap", iconOnly: true, run: () => changeLayout({ type: "swap" }) }];
    if (v.screen === "step") t.push({ id: "pause", label: "Take a break", key: "P", icon: "pause", iconOnly: true, channel: "lesson-pause" });
    return t;
  }

  function screenStep(v) {
    const s = v.step;
    const st = M.stepStatus(v);
    const badge = M.whoBadge(s.who, v.status);
    const acts = M.stepActions(v);
    const nodes = [];

    // At big text sizes, once a hint is open the step's words fold away (one tap brings them back), so the hint fits.
    const fold = compact && v.hints.length > 0 && !isExpanded() && s.who === "learner";
    if (fold) {
      const recap = el("details", { class: "lrecap" }, el("summary", { "data-key": "recap" }, "See the step again"), el("p", { class: "linstr" }, rich(s.instruction)));
      if (local.recapOpen) recap.open = true;
      recap.addEventListener("toggle", () => { local.recapOpen = recap.open; });
      nodes.push(recap);
    } else nodes.push(el("p", { class: "linstr" }, rich(s.instruction)));

    // The status row: what Stride is doing / thinks right now.
    const statusIcon = st.busy ? busyIcon(v.status)
      : st.tone === "good" ? el("span", { class: "lcheer", "aria-hidden": "true" }, icon("check"))
      : st.tone === "warn" ? icon(v.hintOffered ? "bulb" : "alert", "sm")
      : icon(s.who === "watch" ? "eye" : "keyboard", "sm");
    nodes.push(el("div", { class: "lstatus tone-" + st.tone, "data-status": v.status }, statusIcon, el("div", { class: "lstatus-text" }, el("p", { class: "lstatus-title" }, st.title), el("p", { class: "lstatus-line" }, rich(st.line)))));

    // Where to type: points toward the code.
    if (s.line && s.who === "learner" && v.status !== "passed") {
      const towardCode = layout.dock === "right" ? "arrowL" : "arrowR";
      nodes.push(el("p", { class: "lwhere" }, layout.dock === "right" ? icon(towardCode, "xs") : null, el("span", {}, "Line " + s.line + (s.file ? " in " + s.file : "")), layout.dock === "left" ? icon(towardCode, "xs") : null));
    }

    // The newest hint stays on the compact card: it's what they need right now (at big text, not while Stride types it).
    const quietHint = compact && (v.status === "showing" || v.status === "passed");
    if (v.hints.length && !isExpanded() && !quietHint) nodes.push(hintBox(v.hints[v.hints.length - 1], v.hints.length, true));

    // Chips: a new idea (opens the concept card) and the matching part of the video.
    const vchip = M.videoChip(v);
    const keys = [];
    if (!isExpanded()) {
      const chips = [];
      if (s.concept) chips.push(button({ id: "concept-chip", label: "New idea: " + s.concept.title, icon: "bulb", kind: "chip", run: () => changeLayout({ type: "open" }) }));
      if (vchip) { chips.push(button(vchip)); keys.push(vchip); }
      if (chips.length) nodes.push(el("div", { class: "lchiprow" }, chips));
    }

    // Expanded: the mini video, the concept card, all hints, why, pace, keys.
    let more = null;
    if (isExpanded()) {
      more = [];
      if (s.video) {
        const play = { id: "watch", label: "Play " + M.clock(s.video.start) + " to " + M.clock(s.video.end), icon: "play", kind: "video", channel: "lesson-watch", data: { start: s.video.start, end: s.video.end } };
        if (vchip) keys.push({ ...play, key: "W", keyLabel: "Watch this part" });
        more.push(section("This part of the video", "play", el("div", { class: "lvideo" }, button(play))));
      }
      if (s.concept) {
        more.push(el(
          "section",
          { class: "lsec lconcept", "aria-labelledby": "l-concept-title" },
          el("p", { class: "lconcept-tag" }, "New idea"),
          el("h2", { class: "lconcept-title", id: "l-concept-title" }, s.concept.title),
          el("p", {}, rich(s.concept.explain)),
          s.concept.links.map((l) => button({ id: "link-" + l.url, label: l.title, icon: "link", kind: "link", ariaLabel: l.title + " (opens in your browser)", channel: "lesson-open-link", data: { url: l.url } })),
        ));
      }
      if (v.hints.length) more.push(section("Hints so far", "bulb", v.hints.map((h, i) => hintBox(h, i + 1, i === v.hints.length - 1))));
      more.push(section("Why this step", null, el("p", {}, rich(s.why))));
      if (s.who === "learner") {
        const pace = el(
          "div",
          { class: "lpace", role: "group", "aria-label": "Your pace" },
          button({ id: "pace-learn", label: "Learn more", kind: "seg", pressed: v.pace === "learn", channel: "lesson-pace", data: { pace: "learn" } }),
          button({ id: "pace-fast", label: "Go faster", kind: "seg", pressed: v.pace === "fast", channel: "lesson-pace", data: { pace: "fast" } }),
        );
        more.push(section(
          "Your pace",
          null,
          pace,
          el("p", { class: "muted small" }, v.pace === "learn" ? "You type almost everything. Show me comes after 3 hints." : "I do more of the typing, and Show me is always there."),
          !v.doneForMe && v.status !== "passed" && v.status !== "showing" ? button({ id: "do-for-me", label: "Do this one for me", kind: "secondary", channel: "lesson-do-for-me" }) : null,
        ));
      }
      const keyTools = stepTools(v);
      more.push(section(
        "Keys",
        "keyboard",
        el("ul", { class: "lkeys" }, M.keyList([...acts, ...keys, ...keyTools, { key: "M", label: "More or less" }]).map((k) => el("li", {}, el("kbd", {}, k.key), el("span", {}, k.label)))),
      ));
      more.push(button({ id: "wrong-step", label: "This step looks wrong", icon: "flag", kind: "quiet", channel: "lesson-wrong-step" }));
    }

    return {
      eyebrow: "",
      title: s.title,
      badge,
      body: nodes,
      more,
      actions: acts,
      keys,
      tools: stepTools(v),
      expandable: true,
      strip: v.progress,
      stripLabel: { left: s.chapterTitle, right: "Step " + s.number + " of " + s.total },
      tone: st.tone,
    };
  }

  function screenQuiz(v) {
    const answered = v.picked !== undefined;
    const right = answered && v.picked === v.answer;
    const choices = el("div", { class: "lchoices", role: "group", "aria-labelledby": "l-title" });
    v.options.forEach((opt, i) => {
      const isAnswer = answered && i === v.answer;
      const isPicked = answered && i === v.picked;
      choices.append(button({
        id: "quiz-" + i,
        label: opt,
        rich: true,
        kind: "choice",
        cls: (isAnswer ? "is-right" : "") + (isPicked && !isAnswer ? " is-wrong" : ""),
        icon: isAnswer ? "check" : isPicked ? "cross" : null,
        ariaLabel: answered ? opt + (isAnswer ? ", the right answer" : isPicked ? ", your answer" : "") : null,
        disabled: answered && !isAnswer && !isPicked ? true : null,
        run: () => { if (!answered) send("lesson-quiz", { picked: i }); },
      }));
    });
    const nodes = [el("p", { class: "muted" }, "Just for fun. It doesn't count."), choices];
    if (answered) nodes.push(el("div", { class: "lresult " + (right ? "tone-good" : "tone-calm") }, el("p", { class: "lstatus-title" }, right ? "Yes! That's right." : "Not quite, but close."), el("p", {}, rich(v.explain || ""))));
    return {
      eyebrow: "Quick question",
      title: v.question,
      body: nodes,
      actions: answered ? [{ id: "quiz-next", label: "Keep going", kind: "primary", channel: "lesson-quiz-next" }] : [{ id: "quiz-skip", label: "Skip question", kind: "quiet", channel: "lesson-quiz-next" }],
      strip: v.progress,
      stripLabel: { left: v.chapterTitle, right: "Chapter done!" },
    };
  }

  function screenPaused(v) {
    const back = v.reason === "welcome-back";
    const hints = v.hintsUsed > 0 ? "You've used " + (v.hintsUsed === 1 ? "1 hint" : v.hintsUsed + " hints") + " on this step. They're still here." : "No hints used on this step yet.";
    return {
      eyebrow: v.lessonTitle,
      title: back ? "Welcome back!" : "Taking a break",
      body: [
        el("p", { class: "lead" }, back ? "You were on step " + v.step.number + " of " + v.step.total + ": " : "Your spot is saved: step " + v.step.number + " of " + v.step.total + ", ", el("strong", {}, v.step.title), "."),
        el("p", { class: "muted" }, back ? hints : "Close the laptop if you like. I'll be right here."),
      ],
      actions: back
        ? [{ id: "resume", label: "Pick up where I left off", kind: "primary", wide: true, channel: "lesson-resume" }, { id: "later", label: "Not now", kind: "quiet", channel: "lesson-close" }]
        : [{ id: "resume", label: "Keep going", kind: "primary", wide: true, channel: "lesson-resume" }],
      tools: stepTools(v),
      strip: v.progress,
      stripLabel: { left: "", right: "Step " + v.step.number + " of " + v.step.total },
    };
  }

  function screenError(v) {
    const e = M.errorCopy(v);
    const ico = v.kind === "no-key" ? "key" : v.kind === "no-internet" ? "wifiOff" : v.kind === "video-unreadable" ? "videoOff" : "alert";
    return {
      eyebrow: "",
      title: e.title,
      body: [
        el("div", { class: "lerror" }, icon(ico), el("p", {}, e.line)),
        v.message && v.kind !== "other" ? el("p", { class: "muted small" }, v.message) : null,
      ],
      actions: e.actions.map((a) => ({ ...a, wide: true })), // the same layout on every error: the fix, then a way out
      tone: "warn",
    };
  }

  function screenFinished(v) {
    const tiles = [
      { n: v.alone, label: "on your own", cls: "alone" },
      { n: v.hinted, label: "with a hint", cls: "hinted" },
      { n: v.shown, label: "shown by Stride", cls: "shown" },
    ];
    if (v.skipped > 0) tiles.push({ n: v.skipped, label: "skipped", cls: "skipped" });
    const nodes = [
      el("p", { class: "lead" }, rich(v.outcome)),
      v.picture
        ? el("img", { class: "lpicture", src: v.picture, alt: "A picture of the page you built" })
        : el("div", { class: "lpicture placeholder", role: "img", "aria-label": "A picture of the page you built" }, icon("image")),
      el("h2", { class: "lsec-title" }, "The " + v.steps + " steps you typed"),
      el("ul", { class: "ltiles" }, tiles.map((t) => el("li", { class: "ltile " + t.cls }, el("span", { class: "ltile-n" }, String(t.n)), el("span", { class: "ltile-label" }, t.label)))),
      v.allSteps > v.steps ? el("p", { class: "muted small" }, icon("bot", "xs"), "Plus " + (v.allSteps - v.steps === 1 ? "1 setup step" : v.allSteps - v.steps + " setup steps") + " I did for you, " + v.allSteps + " in all.") : null,
      v.minutes > 0 ? el("p", { class: "muted small" }, icon("clock", "xs"), "It took you about " + v.minutes + " min.") : null,
      el("h2", { class: "lsec-title" }, "What you learned"),
      el("ul", { class: "lchips" }, v.learned.map((l) => el("li", {}, l))),
      el(
        "div",
        { class: "lnext" },
        el("p", { class: "lnext-tag" }, "Try next"),
        el("p", { class: "lnext-title" }, v.next.title),
        el("p", { class: "muted" }, rich(v.next.why + (v.next.minutes ? " About " + v.next.minutes + " min." : ""))),
      ),
    ];
    return {
      eyebrow: v.title,
      title: "You made it!",
      body: nodes,
      actions: [
        { id: "next-lesson", label: "Start the next lesson", kind: "primary", channel: "lesson-next-lesson" },
        { id: "close", label: "Close", kind: "secondary", channel: "lesson-close" },
      ],
      tone: "good",
    };
  }

  const SCREENS = {
    building: screenBuilding,
    question: screenQuestion,
    picture: screenPicture,
    estimate: screenEstimate,
    setup: screenSetup,
    step: screenStep,
    quiz: screenQuiz,
    paused: screenPaused,
    error: screenError,
    finished: screenFinished,
  };

  // ---------------- Drawing ----------------

  function focusKey(key) {
    requestAnimationFrame(() => {
      const target = key === "l-fix" ? document.getElementById("l-fix") : card.querySelector('[data-key="' + CSS.escape(key) + '"]');
      if (target) target.focus();
    });
  }

  function render() {
    applyLayout();
    if (!view || view.screen === "hidden" || !SCREENS[view.screen]) {
      card.classList.add("is-hidden");
      card.setAttribute("aria-hidden", "true");
      clearInterval(buddy.timer);
      prevRendered = { screen: "hidden" }; // whatever comes next is new
      return;
    }
    compact = isCompact();
    card.classList.toggle("is-compact", compact);
    card.classList.remove("is-hidden");
    card.removeAttribute("aria-hidden");

    // Keep focus on the same control across updates.
    const active = document.activeElement;
    const hadFocus = active && card.contains(active);
    const focusedKey = hadFocus && active.dataset ? active.dataset.key : null;

    const parts = SCREENS[view.screen](view);
    const isNew = !prevRendered || prevRendered.screen !== view.screen || (view.screen === "step" && prevRendered.step.id !== view.step.id) || (view.screen === "question" && prevRendered.id !== view.id);

    card.dataset.screen = view.screen;
    card.dataset.tone = parts.tone || "";
    card.dataset.status = view.screen === "step" ? view.status : "";
    drawStrip(parts.strip || null, parts.stripLabel);

    eyebrow.replaceChildren();
    if (parts.badge) eyebrow.append(el("span", { class: "lbadge " + parts.badge.tone }, icon(parts.badge.icon, "xs"), parts.badge.text));
    if (parts.eyebrow) eyebrow.append(el("span", { class: "leyebrow-text" }, parts.eyebrow));
    eyebrow.hidden = !parts.badge && !parts.eyebrow;
    title.textContent = parts.title || "";

    // Header tools: move the card, take a break, more/less.
    const toolSpecs = [...(parts.tools || [{ id: "swap", label: "Move to the other side", key: "D", icon: "swap", iconOnly: true, run: () => changeLayout({ type: "swap" }) }])];
    tools.replaceChildren(...toolSpecs.map((t) => {
      const b = el("button", { type: "button", class: "ltool", "data-key": t.id, "aria-label": t.label, "aria-keyshortcuts": t.key, title: t.label + " (" + t.key + ")" }, icon(t.icon));
      b.addEventListener("click", () => run(t));
      return b;
    }));

    const content = el("div", { class: "lcontent" + (isNew ? " enter" : "") }, parts.body);
    const nodes = [content];
    if (parts.more) nodes.push(el("div", { class: "lmore" + (isNew ? "" : " enter"), id: "l-more" }, parts.more));
    const keepScroll = body.scrollTop;
    body.replaceChildren(...nodes);
    body.scrollTop = isNew ? 0 : keepScroll;
    const reveal = whatToReveal(prevRendered, view, isNew);

    // The buttons row; the expand toggle sits at its end.
    const specs = [...(parts.actions || [])];
    const row = specs.map(button);
    if (parts.expandable) {
      const open = isExpanded();
      const t = el(
        "button",
        { type: "button", class: "lbtn quiet lmore-toggle", "data-key": "more", "aria-expanded": String(open), "aria-controls": "l-body", "aria-keyshortcuts": "M" },
        el("span", { class: "lbtn-label" }, open ? "Less" : "More"),
        icon("chevron", "sm"),
      );
      t.title = (open ? "Show less" : "Show more: new ideas, hints, your pace") + " (M)";
      t.addEventListener("click", () => changeLayout({ type: "toggle" }));
      row.push(t);
    }
    actions.replaceChildren(...row);
    actions.hidden = row.length === 0;

    // Shortcuts: the buttons, the tools and More.
    actionsNow = [...specs.filter((s) => s.key), ...(parts.keys || []), ...toolSpecs];
    if (parts.expandable) actionsNow.push({ id: "more", key: "M", run: () => changeLayout({ type: "toggle" }) });

    // The ✅ moment: a quick glow on the card, once.
    const passedNow = view.screen === "step" && view.status === "passed";
    const passedBefore = passedNow && prevRendered && prevRendered.screen === "step" && prevRendered.status === "passed" && prevRendered.step.id === view.step.id;
    if (passedNow && !passedBefore) {
      card.classList.remove("cheer");
      void card.offsetWidth; // restart the animation
      card.classList.add("cheer");
    } else if (!passedNow) card.classList.remove("cheer");

    setBuddy(M.buddyFor(view));

    // Screen reader news.
    const news = M.announce(prevRendered, view);
    if (news) {
      if (view.screen === "error") { alertLive.textContent = ""; alertLive.textContent = news; }
      else { live.textContent = ""; live.textContent = news; }
    }

    if (focusedKey) {
      const again = card.querySelector('[data-key="' + CSS.escape(focusedKey) + '"]');
      if (again && !again.disabled) again.focus();
      else if (hadFocus) title.focus();
    } else if (hadFocus && !card.contains(document.activeElement)) title.focus();

    prevRendered = JSON.parse(JSON.stringify(view));
    markScroll();
    if (reveal) revealInBody(reveal);
    reportRect();
  }

  // At big text sizes (the card is under 20 text-widths wide) some parts fold away so what matters fits.
  let compact = false;
  function isCompact() {
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const width = card.getBoundingClientRect().width || root.getBoundingClientRect().width;
    return width > 0 && width / rem < 20;
  }

  // What the student needs to see after an update: a new hint, or the status when it changes (✅, not quite yet).
  function whatToReveal(prev, v, isNew) {
    if (v.screen !== "step") return null;
    const hintNew = v.hints.length > 0 && (isNew || !prev || prev.screen !== "step" || v.hints.length > prev.hints.length);
    // While Stride types it, or at the ✅, the status is the news, not the hint.
    if (v.status === "showing" || v.status === "passed") return isNew ? null : body.querySelector(".lstatus");
    if (hintNew) return body.querySelector(".lhint.is-latest");
    if (!isNew && prev && prev.screen === "step" && prev.status !== v.status) return body.querySelector(".lstatus");
    return null;
  }

  // Scrolls the text part just enough to show a node (like scrollIntoView with block "nearest"), clear of the fade.
  function revealInBody(node) {
    const b = body.getBoundingClientRect();
    const r = node.getBoundingClientRect();
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const fade = body.scrollHeight > body.clientHeight + 4 ? 2 * rem : 0;
    const room = b.height - fade;
    let delta = 0;
    if (r.height > room || r.top < b.top) delta = r.top - b.top; // too tall to fit: show its start
    else if (r.bottom > b.bottom - fade) delta = r.bottom - (b.bottom - fade);
    if (delta) body.scrollTop += delta;
    markScroll();
  }

  // A soft fade at the bottom when there's more to scroll (at big text sizes). Then the text part is a Tab stop.
  function markScroll() {
    const more = body.scrollHeight - body.clientHeight - body.scrollTop > 4;
    body.classList.toggle("can-scroll", more);
    if (body.scrollHeight > body.clientHeight + 4) body.setAttribute("tabindex", "0");
    else body.removeAttribute("tabindex");
  }
  body.addEventListener("scroll", markScroll, { passive: true });
  let prevRendered = null;

  // Tell the app where the card is (so clicks around it go through to the code).
  let rectQueued = false;
  function reportRect() {
    if (rectQueued) return;
    rectQueued = true;
    requestAnimationFrame(() => {
      rectQueued = false;
      const r = card.getBoundingClientRect();
      send("lesson-rect", { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) });
    });
  }
  if (window.ResizeObserver) {
    new ResizeObserver(reportRect).observe(card);
    // The text size or window width changed: fold or unfold the big-text layout.
    new ResizeObserver(() => { if (view.screen !== "hidden" && isCompact() !== compact) render(); }).observe(root);
  }

  // ---------------- Keys ----------------

  document.addEventListener("keydown", (e) => {
    if (view.screen === "hidden") return;
    if (e.key === "Escape") {
      if (local.fixing) { local.fixing = false; render(); focusKey("pic-fix"); e.preventDefault(); return; }
      if (isExpanded()) { changeLayout({ type: "close" }); focusKey("more"); e.preventDefault(); }
      return;
    }
    const hit = M.actionForKey(e, actionsNow);
    if (!hit) return;
    e.preventDefault();
    const b = card.querySelector('[data-key="' + CSS.escape(hit.id) + '"]');
    if (b) b.classList.add("is-pressed"), setTimeout(() => b.classList.remove("is-pressed"), 160);
    run(hit);
  });

  reduceMotion.addEventListener && reduceMotion.addEventListener("change", () => setBuddy(buddy));

  // ---------------- Messages from the app ----------------

  function show(next) {
    if (!next || typeof next !== "object" || !next.screen) return;
    if (next.screen === "step" && (!view || view.screen !== "step" || view.step.id !== next.step.id)) {
      tempOpen = M.autoOpen(view && view.screen === "step" ? view.step.id : null, next) && !layout.expanded;
    }
    if (next.screen !== view.screen || (next.screen === "question" && view.id !== next.id)) local = freshLocal();
    else if (next.screen === "step" && view.step.id !== next.step.id) local.recapOpen = false;
    prevView = view;
    view = next;
    render();
  }

  api.on("lesson", show);
  api.on("lesson-layout", (l) => {
    layout = M.layoutReduce(layout, { type: "set", layout: l });
    M.writeLayout(store, layout);
    applyLayout();
    render();
  });

  // For the preview page and tests.
  window.StrideLesson = { show, get view() { return view; }, get layout() { return { ...layout, expanded: isExpanded() }; }, get previous() { return prevView; } };

  applyLayout();
  render();
})();
