// The helper bar. It draws whatever BarState the app sends on "bar", and speaks + captions "say".
// All text is inserted as plain text (never HTML), because some of it comes from web pages.
(() => {
  "use strict";

  const api = window.calhack || { send() {}, on() {} };
  const mic = window.CalhackMic && typeof window.CalhackMic.start === "function" ? window.CalhackMic : null;
  const $ = (id) => document.getElementById(id);

  const card = $("card");
  const head = $("head");
  const eyebrow = $("eyebrow");
  const title = $("title");
  const body = $("body");
  const details = $("details");
  const now = $("now");
  const nowText = $("now-text");
  const detailsToggle = $("details-toggle");
  const actions = $("actions");
  const caption = $("caption");
  const captionIcon = $("caption-icon");
  const captionText = $("caption-text");
  const muteBtn = $("mute");
  const closeBtn = $("close");
  const sizeBtn = $("size");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  let state = { phase: "hidden" };
  let lastPhase = "hidden";
  let run = freshRun();

  /** Things we remember while one run lasts (from the hotkey until the bar hides). */
  function freshRun() {
    return { detailsOpen: false, howOpen: {}, copied: false, checks: {}, steps: {} };
  }

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

  // Line icons, drawn as SVG paths (no HTML strings).
  const PATHS = {
    speaker: ["M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z", "M15.5 9a4 4 0 0 1 0 6", "M18 6.5a7.5 7.5 0 0 1 0 11"],
    muted: ["M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z", "M16 9.5l5 5", "M21 9.5l-5 5"],
    mic: ["M12 3.5a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0v-5a3 3 0 0 0-3-3z", "M6 11a6 6 0 0 0 12 0", "M12 17v3.5"],
    send: ["M12 19V5", "M6 11l6-6 6 6"],
    check: ["M5 12.5l4.5 4.5L19 7.5"],
    cross: ["M7 7l10 10", "M17 7L7 17"],
    question: ["M9.3 9.2a2.8 2.8 0 1 1 3.9 2.6c-.8.4-1.2 1-1.2 1.8v.6", "M12 17.3v.2"],
    chevron: ["M6.5 9.5l5.5 5.5 5.5-5.5"],
    info: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 11v5.5", "M12 7.6v.2"],
    warn: ["M12 3.8L2.8 19.5h18.4z", "M12 10v4.5", "M12 17.2v.2"],
    blocked: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M5.7 5.7l12.6 12.6"],
    shield: ["M12 3l7.5 3v5.5c0 4.5-3.2 8-7.5 9.5-4.3-1.5-7.5-5-7.5-9.5V6z", "M8.8 12.2l2.3 2.3 4.3-4.6"],
    page: ["M7 3.5h7l4 4v13H7z", "M14 3.5v4h4"],
    hand: ["M8 12V6.5a1.5 1.5 0 0 1 3 0V11", "M11 10.5V5a1.5 1.5 0 0 1 3 0v5.5", "M14 10.5V7a1.5 1.5 0 0 1 3 0v7a6 6 0 0 1-6 6h-.5a5.5 5.5 0 0 1-4.6-2.5L4.3 15a1.5 1.5 0 0 1 2.4-1.8L8 14.5"],
    dash: ["M7 12h10"],
    alert: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 7.5v5.5", "M12 16.3v.2"],
    expand: ["M14 4h6v6", "M20 4l-6 6", "M10 20H4v-6", "M4 20l6-6"],
    collapse: ["M4 14h6v6", "M10 14l-6 6", "M20 10h-6V4", "M14 10l6-6"],
  };
  const SVG = "http://www.w3.org/2000/svg";
  function icon(name, cls = "") {
    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", ("ico " + cls).trim());
    for (const d of PATHS[name] || []) {
      const p = document.createElementNS(SVG, "path");
      p.setAttribute("d", d);
      svg.append(p);
    }
    return svg;
  }

  // Buttons keep their element between updates (see render), so a press is never lost to a re-draw.
  // Stop buttons act on the press itself, not on the release, so they work at once even mid-update.
  function button(label, onClick, cls = "", extra = {}) {
    const b = el("button", { type: "button", class: ("btn " + cls).trim(), ...extra }, label);
    b.dataset.key = label + "|" + cls;
    b._act = onClick;
    let pressed = false;
    if (/\bstop\b/.test(cls)) {
      b.addEventListener("pointerdown", (e) => {
        if (e.button !== 0 || b.disabled) return;
        pressed = true;
        b._act();
      });
    }
    b.addEventListener("click", () => {
      if (pressed) { pressed = false; return; } // already handled on the press
      if (!b.disabled) b._act();
    });
    return b;
  }

  const send = (channel, data) => {
    try { api.send(channel, data); } catch { /* app went away */ }
  };

  function sameChildren(parent, nodes) {
    if (parent.children.length !== nodes.length) return false;
    return nodes.every((n, i) => parent.children[i] === n);
  }

  // ---------------- The ask box (kept alive so typing and holding the mic survive updates) ----------------

  const input = el("input", {
    type: "text",
    class: "ask-input",
    placeholder: "Type it here…",
    "aria-label": "Type your answer",
    autocomplete: "off",
    enterkeyhint: "send",
  });
  const sendBtn = el("button", { type: "button", class: "send", "aria-label": "Send", title: "Send", disabled: true }, icon("send"));
  const micBtn = el("button", { type: "button", class: "mic talk", "aria-label": "Hold to talk", title: "Hold this button while you talk" }, icon("mic"), el("span", { class: "talk-label" }, "Hold to talk"));
  const heard = el("div", { class: "heard", hidden: true });
  const hint = el("div", { class: "hint" });
  const chips = el("div", { class: "chips" });
  const askRow = el("div", { class: "ask-row" }, el("div", { class: "ask-field" }, input, sendBtn), mic ? micBtn : null);
  // On every other screen the same box sits at the bottom, so the person can ask a follow-up any time.
  const followRow = el("div", { class: "follow", hidden: true });
  const askBox = el("div", { class: "ask" },
    heard,
    askRow,
    hint,
    chips,
  );
  let micProblem = "";

  function submitText(text) {
    const t = String(text ?? input.value).trim();
    if (!t) return;
    send("bar-answer", { text: t });
    input.value = "";
    sendBtn.disabled = true;
  }
  input.addEventListener("input", () => { sendBtn.disabled = !input.value.trim(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      submitText();
    }
  });
  sendBtn.addEventListener("click", () => submitText());

  // ---------------- Hold to talk ----------------
  // Hold the mic (or Space) and talk. A quick tap also works: tap to start, tap again to finish.

  let micMode = "idle"; // idle | holding | latched
  let micBy = "pointer"; // pointer | key
  let micStarted = null; // promise from CalhackMic.start()
  let micDownAt = 0;

  function setMicLook() {
    const s = state.phase === "ask" ? state : {};
    const listening = micMode !== "idle" || !!s.listening;
    micBtn.classList.toggle("is-listening", listening);
    micBtn.classList.toggle("is-transcribing", !listening && !!s.transcribing);
    micBtn.setAttribute("aria-label", "Hold to talk");
    const label = micBtn.querySelector(".talk-label");
    if (label) label.textContent = listening ? "Listening… let go when done" : s.transcribing ? "Writing it down…" : "Hold to talk";
    micBtn.setAttribute("aria-pressed", listening ? "true" : "false");
    if (!listening) micBtn.style.setProperty("--level", "0");
  }

  function micStart(by) {
    if (!mic || micMode !== "idle" || state.phase === "hidden") return;
    micMode = "holding";
    micBy = by;
    micDownAt = Date.now();
    micProblem = "";
    try {
      micStarted = Promise.resolve(mic.start());
    } catch (err) {
      micStarted = Promise.reject(err);
    }
    send("bar-mic-start");
    micStarted.catch((err) => {
      if (micMode === "idle") return;
      micMode = "idle";
      micProblem = (err && err.message) || "I couldn't hear the microphone. You can type instead.";
      send("bar-mic-cancel");
      render();
    });
    render();
  }

  async function micFinish() {
    if (micMode === "idle") return;
    micMode = "idle";
    render();
    try {
      await micStarted;
      const wav = await mic.stop();
      if (wav && wav.byteLength) send("bar-mic-audio", { wav });
      else send("bar-mic-cancel");
    } catch {
      send("bar-mic-cancel");
    }
  }

  function micCancel() {
    if (micMode === "idle") return;
    micMode = "idle";
    Promise.resolve(micStarted).catch(() => {}).then(() => {
      try { mic.cancel(); } catch { /* nothing to stop */ }
    });
    send("bar-mic-cancel");
    render();
  }

  if (mic) {
    // Hold to talk: talking starts when the button is pressed and stops when it's let go.
    // The pointer is captured, so a finger drifting off the button doesn't cut the person off.
    micBtn.addEventListener("pointerdown", (e) => {
      if (e.button > 0) return;
      e.preventDefault();
      try { micBtn.setPointerCapture(e.pointerId); } catch { /* fine */ }
      micStart("pointer");
    });
    const release = () => {
      if (micMode !== "holding" || micBy !== "pointer") return;
      if (Date.now() - micDownAt < 400) {
        // Too short to be speech: explain instead of sending silence.
        micCancel();
        micProblem = "Keep holding the button while you talk, then let go.";
        render();
        return;
      }
      micFinish();
    };
    micBtn.addEventListener("pointerup", release);
    micBtn.addEventListener("lostpointercapture", release);
    micBtn.addEventListener("pointercancel", () => { if (micMode === "holding" && micBy === "pointer") micCancel(); });
    micBtn.addEventListener("contextmenu", (e) => e.preventDefault());
    // Keyboard users: Enter/Space on the focused mic toggles it.
    micBtn.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      if (e.repeat) return;
      if (micMode === "idle") { micStart("key"); micMode = "latched"; render(); }
      else micFinish();
    });
    if (typeof mic.onLevel === "function") {
      try {
        mic.onLevel((level) => {
          const v = Math.max(0, Math.min(1, Number(level) || 0));
          micBtn.style.setProperty("--level", v.toFixed(3));
        });
      } catch { /* no levels, the ring just pulses */ }
    }
  }

  const isTyping = (node) => !!node && (node.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(node.tagName));

  document.addEventListener("keydown", (e) => {
    const active = document.activeElement;
    if (e.key === " " && state.phase === "ask" && mic && !input.value && !isTyping(active)) {
      e.preventDefault();
      if (!e.repeat && micMode === "idle") micStart("key");
      return;
    }
    if (e.key === "Escape") {
      if (micMode !== "idle") { micCancel(); return; }
      if (["looking", "ask", "checking", "plan", "done", "error"].includes(state.phase)) send("bar-cancel");
      else if (["working", "needs-you"].includes(state.phase)) send("bar-stop");
      return;
    }
    // In "ask", just start typing: the first letter goes into the box.
    if (state.phase === "ask" && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping(active)) {
      input.focus();
    }
  });
  document.addEventListener("keyup", (e) => {
    if (e.key === " " && micMode === "holding" && micBy === "key") micFinish();
  });
  window.addEventListener("blur", () => { if (micMode === "holding") micCancel(); });

  // ---------------- Views: one per phase ----------------
  // Each returns { eyebrow, title, body: Node[], now, live, detail, buttons }.

  const VIEWS = {
    looking(s) {
      return {
        eyebrow: "",
        title: [el("span", { class: "spinner", role: "img", "aria-label": "Working" }), s.message || "Let me take a look…"],
        body: [],
        now: "Reading what's on your screen",
        live: true,
        buttons: [button("Cancel", () => send("bar-cancel"))],
      };
    },

    ask(s) {
      const listening = micMode !== "idle" || s.listening;
      heard.hidden = !s.heard && !s.transcribing;
      heard.textContent = s.heard ? "“" + s.heard + "”" : "Writing down what you said…";
      heard.classList.toggle("pending", !s.heard);

      hint.classList.toggle("problem", !!micProblem);
      if (micProblem) hint.replaceChildren(micProblem);
      else if (!mic) hint.replaceChildren("Type your answer and press Return.");
      else if (micMode === "latched") hint.replaceChildren("I'm listening. Tap the mic again when you're done.");
      else if (listening) hint.replaceChildren("I'm listening. Let go when you're done.");
      else hint.replaceChildren("Type, or hold the mic and talk. You can also hold ", el("span", { class: "kbd" }, "Space"), ".");

      const list = (s.suggestions || []).filter(Boolean);
      const key = JSON.stringify(list);
      if (chips.dataset.key !== key) {
        chips.dataset.key = key;
        chips.replaceChildren(...list.map((t) => el("button", { type: "button", class: "chip", onclick: () => submitText(t) }, t)));
      }
      chips.hidden = !list.length;
      setMicLook();

      let line = null;
      if (listening) line = "Listening…";
      else if (s.transcribing) line = "Writing down what you said…";
      return {
        eyebrow: "",
        title: [s.question || "Hi! What's going on?"],
        body: s.note ? [el("p", { class: "confirm-msg ask-note" }, s.note), askBox] : [askBox],
        now: line,
        live: !!line,
        buttons: [], // the ✕ in the corner closes it
      };
    },

    checking(s) {
      const checks = s.checks || [];
      const running = checks.find((c) => c.status === "running");
      const rows = checks.map((c, i) => {
        const k = i + ":" + c.label;
        const changed = run.checks[k] !== undefined && run.checks[k] !== c.status;
        run.checks[k] = c.status;
        return el("li", { class: "check " + c.status + (changed ? " just-changed" : "") },
          checkMark(c.status),
          el("div", {},
            el("div", { class: "check-label" }, c.label),
            c.detail ? el("div", { class: "check-detail" }, c.detail) : null,
          ),
        );
      });
      const done = checks.length && checks.every((c) => c.status !== "pending" && c.status !== "running");
      return {
        eyebrow: "Checking",
        title: [s.title || "Let me check a few things"],
        body: [el("ul", { class: "checks", "aria-label": "Checks" }, rows)],
        now: running ? "Checking: " + running.label : done ? "Finished checking" : "Getting ready to check",
        live: !done,
        buttons: [button("Cancel", () => send("bar-cancel"))],
      };
    },

    plan(s) {
      const parts = [];
      if (s.problem) parts.push(el("div", { class: "problem-box" }, icon("alert"), el("div", {}, s.problem)));
      parts.push(stepList(s.steps || []));
      for (const n of s.notes || []) {
        const ic = n.tone === "blocked" ? "blocked" : n.tone === "warn" ? "warn" : "info";
        parts.push(el("div", { class: "note " + (n.tone || "info"), role: n.tone === "blocked" ? "alert" : null }, icon(ic), el("div", {}, n.text)));
      }
      if (s.source) parts.push(el("div", { class: "source" }, icon("page", "sm"), s.source));
      return {
        eyebrow: s.okLabel === "" ? "Careful" : s.problem ? "Here's what I found" : "Here's my plan",
        title: [s.goal],
        body: parts,
        now: null, // the buttons say it
        // An empty okLabel means there's nothing safe to do (e.g. a scam page): only the close button.
        buttons: [
          s.okLabel === "" ? null : button(s.okLabel || "OK, do it", () => send("bar-ok"), "primary grow"),
          button(s.cancelLabel || "Not now", () => send("bar-cancel"), s.okLabel === "" ? "grow" : ""),
        ].filter(Boolean),
      };
    },

    working(s) {
      const steps = s.steps || [];
      const total = s.total || steps.length || 1;
      const openEnded = !!s.openEnded;
      const current = Math.max(1, Math.min(total, s.current || 1));
      const step = steps.find((x) => x.status === "running") || steps[current - 1];
      let progress;
      if (steps.length && steps.length <= 12) {
        progress = el("div", { class: "dots", role: "img", "aria-label": `Step ${current} of ${total}` },
          steps.map((x) => el("span", { class: "dot " + x.status })));
      } else {
        const fill = el("div", { class: "bar-fill" });
        fill.style.width = Math.round(((current - 1) / total) * 100) + "%";
        progress = el("div", { class: "bar-track", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(total), "aria-valuenow": String(current - 1) }, fill);
      }
      return {
        eyebrow: "Working on it",
        title: [s.goal],
        body: [
          el("div", { class: "progress-row" }, el("div", { class: "progress-label" }, openEnded ? `Step ${current}` : `Step ${current} of ${total}`), progress),
          step ? el("div", { class: "current-step" }, step.text) : null,
        ].filter(Boolean),
        now: s.line,
        live: true,
        detail: s.detail || [],
        buttons: [button("Stop", () => send("bar-stop"), "stop")],
      };
    },

    "needs-you"(s) {
      const parts = [];
      parts.push(el("div", { class: "pill-you" }, icon(s.kind === "manual" ? "hand" : "question", "sm"), s.kind === "manual" ? "Your turn" : "I need your OK"));
      const why = (s.why || []).filter(Boolean);
      if (why.length) {
        parts.push(el("div", { class: "why" },
          el("div", { class: "why-title" }, s.kind === "manual" ? "Why you" : "Why I'm asking"),
          el("ul", {}, why.map((w) => el("li", {}, w)))));
      }
      const btns = s.kind === "approve"
        ? [
            button("Yes, go ahead", () => send("bar-approve", { stepId: s.stepId, yes: true }), "primary grow"),
            button("No", () => send("bar-approve", { stepId: s.stepId, yes: false })),
          ]
        : [
            button("Done", () => send("bar-manual", { stepId: s.stepId, answer: "done" }), "primary grow"),
            // Stops the whole task, leaving everything on screen as it is. "Continue" picks it up again.
            button("Stop here", () => send("bar-stop"), "stop"),
          ];
      return {
        eyebrow: s.goal,
        title: [s.question],
        body: parts,
        now: null,
        detail: s.command ? [{ text: s.command, mono: true }] : null,
        buttons: btns,
      };
    },

    confirm(s) {
      const parts = [];
      if (s.message) parts.push(el("p", { class: "confirm-msg" }, s.message));
      const details = (s.details || []).filter(Boolean);
      if (details.length) parts.push(el("ul", { class: "confirm-details" }, details.map((d) => el("li", {}, d))));
      let typed = null;
      const yes = button(s.yes || "Yes", () => send("bar-confirm", { yes: true, typed: typed ? typed.value : undefined }), (s.tone === "danger" ? "danger" : "primary") + " grow");
      if (s.typeToConfirm) {
        typed = el("input", { type: "text", class: "ask-input confirm-type", placeholder: `Type ${s.typeToConfirm}`, "aria-label": `Type ${s.typeToConfirm} to confirm`, autocomplete: "off" });
        const check = () => { yes.disabled = typed.value.trim().toLowerCase() !== String(s.typeToConfirm).toLowerCase(); };
        typed.addEventListener("input", check);
        typed.addEventListener("keydown", (e) => { if (e.key === "Enter" && !yes.disabled) yes.click(); });
        check();
        parts.push(typed);
        setTimeout(() => typed && typed.focus(), 50);
      }
      return {
        eyebrow: s.tone === "danger" ? "Please read carefully" : "Before I go on",
        title: [s.title],
        body: parts,
        now: null,
        buttons: [yes, button(s.no || "No", () => send("bar-confirm", { yes: false }))],
      };
    },

    explain(s) {
      const parts = (s.paragraphs || []).map((p) => el("p", { class: "confirm-msg" }, p));
      const steps = (s.steps || []).filter(Boolean);
      if (steps.length) parts.push(el("ol", { class: "teach-steps" }, steps.map((x) => el("li", {}, x))));
      return {
        eyebrow: "Learn how",
        title: [s.title],
        body: parts,
        now: null,
        buttons: [button("Got it", () => send("bar-explain-ok"), "primary grow")],
      };
    },

    done(s) {
      const r = s.receipt || { verdict: "couldnt-verify", headline: "Finished.", beforeAfter: [], proofs: [], problems: [], reviewedBy: "rules" };
      const VERDICT = {
        done: ["check", "All done"],
        answered: ["check", "Here's what I found"],
        "not-done": ["cross", "Not finished"],
        "cant-do": ["shield", "I won't do this one"],
        "couldnt-verify": ["question", "I couldn't check this"],
      };
      const [vIcon, vWord] = VERDICT[r.verdict] || VERDICT["couldnt-verify"];
      const parts = [];

      // The answer, in plain lines (from the agent).
      if (r.lines && r.lines.length) parts.push(el("ul", { class: "lines" }, r.lines.map((l) => el("li", {}, l))));

      if (r.beforeAfter && r.beforeAfter.length) {
        parts.push(el("table", { class: "ba" + (r.verdict === "done" ? " good" : "") },
          el("thead", {}, el("tr", {}, el("th", { scope: "col" }), el("th", { scope: "col" }, "Before"), el("th", { scope: "col" }, "After"))),
          el("tbody", {}, r.beforeAfter.map((row) => el("tr", {},
            el("td", { class: "label" }, row.label),
            el("td", { class: "before" }, row.before),
            el("td", { class: "after" }, row.after))))));
      }

      if (r.proofs && r.proofs.length) {
        parts.push(el("div", { class: "section-title" }, "What I checked"));
        parts.push(el("ul", { class: "proofs" }, r.proofs.map((p, i) => {
          const open = !!run.howOpen[i];
          const checks = (p.checks || []).filter(Boolean);
          const listId = "how-" + i;
          return el("li", { class: "proof" },
            el("div", { class: "proof-head" },
              icon("check"),
              el("span", { class: "proof-claim" }, p.claim),
              checks.length ? el("button", {
                type: "button",
                class: "how",
                "aria-expanded": open ? "true" : "false",
                "aria-controls": listId,
                onclick: () => { run.howOpen[i] = !open; render(); },
              }, "How I know", icon("chevron", "sm")) : null,
            ),
            open && checks.length ? el("ul", { class: "how-list", id: listId }, checks.map((c) => el("li", {}, c))) : null,
          );
        })));
      }

      if (r.problems && r.problems.length) {
        parts.push(el("div", { class: "section-title" }, "What still isn't right"));
        parts.push(el("ul", { class: "problems" }, r.problems.map((p) => el("li", {}, icon("cross", "sm"), el("span", {}, p)))));
      }

      parts.push(el("div", { class: "reviewed" }, icon("shield", "sm"),
        r.reviewedBy === "claude" ? "Checked by a separate Claude review" : r.reviewedBy === "agent" ? "Every ✓ is a check that really ran on your Mac" : "Checked by CalHack's rules"));

      const btns = [];
      const good = r.verdict === "done" || r.verdict === "answered";
      btns.push(button("Close", () => send("bar-cancel"), (good || !s.canRetry) && !s.canContinue ? "primary" : ""));
      if (s.canContinue) btns.push(button("Continue", () => send("bar-retry"), "primary"));
      else if (s.canRetry) btns.push(button("Try again", () => send("bar-retry"), good ? "" : "primary"));
      if (s.canSendSummary) {
        if (run.copied) {
          btns.push(el("span", { class: "copied", role: "status" }, icon("check", "sm"), "Copied! Paste it in a message."));
        } else {
          btns.push(button("Send this to my son / IT", () => {
            send("bar-send-summary");
            run.copied = true;
            render();
          }));
        }
      }

      return {
        eyebrow: vWord,
        title: [el("span", { class: "verdict " + r.verdict }, icon(vIcon, "lg")), r.headline],
        body: parts,
        now: null,
        detail: s.detail && s.detail.length ? s.detail : null,
        buttons: btns,
      };
    },

    error(s) {
      return {
        eyebrow: "Hmm",
        title: ["Something went wrong"],
        body: [el("div", { class: "error-box", role: "alert" }, icon("alert"), el("div", { class: "lead" }, s.message || "Sorry, that didn't work."))],
        now: null,
        buttons: [
          button("Try again", () => send("bar-retry"), "primary"),
          button("Close", () => send("bar-cancel")),
        ],
      };
    },
  };

  function checkMark(status) {
    if (status === "running") return el("span", { class: "mark running" }, el("span", { class: "spinner sm", role: "img", "aria-label": "Checking" }));
    if (status === "ok") return el("span", { class: "mark ok", role: "img", "aria-label": "OK" }, icon("check"));
    if (status === "problem") return el("span", { class: "mark problem", role: "img", "aria-label": "Problem" }, icon("cross"));
    if (status === "unknown") return el("span", { class: "mark unknown", role: "img", "aria-label": "Not sure" }, icon("question"));
    return el("span", { class: "mark pending", role: "img", "aria-label": "Not checked yet" });
  }

  const STEP_TAG = { skipped: ["Skipped", ""], blocked: ["Won't do", "bad"], failed: ["Didn't work", "bad"], unverified: ["Ran, not verified", ""], done: ["Done", ""] };
  function stepList(steps) {
    return el("ol", { class: "steps" }, steps.map((st, i) => {
      const off = st.status === "skipped" || st.status === "blocked";
      const bad = st.status === "blocked" || st.status === "failed";
      const tag = STEP_TAG[st.status];
      return el("li", { class: "step" + (off ? " is-off" : "") + (bad ? " is-bad" : "") },
        st.status === "done" ? el("span", { class: "mark ok", "aria-label": "Done" }, icon("check")) : st.status === "unverified" ? el("span", { class: "mark unknown", role: "img", "aria-label": "Ran, not verified" }, icon("question")) : el("span", { class: "step-num", "aria-hidden": "true" }, String(i + 1)),
        el("div", { class: "step-text" },
          st.text,
          tag && st.status !== "done" ? el("span", { class: "tag " + tag[1] }, tag[0]) : null,
          st.note && st.note !== tag?.[0] ? el("span", { class: "step-note" }, st.note) : null,
        ),
      );
    }));
  }

  // ---------------- Details ("show what's happening") ----------------

  function renderDetails(lines) {
    const has = Array.isArray(lines);
    detailsToggle.hidden = !has;
    if (!has) {
      details.hidden = true;
      return;
    }
    detailsToggle.replaceChildren(run.detailsOpen ? "Hide details" : "Show what's happening", icon("chevron", "sm"));
    detailsToggle.setAttribute("aria-expanded", run.detailsOpen ? "true" : "false");
    details.hidden = !run.detailsOpen;
    if (!run.detailsOpen) return;
    const atBottom = details.scrollHeight - details.scrollTop - details.clientHeight < 8;
    details.replaceChildren(...(lines.length
      ? lines.map((l) => el("div", { class: "line" + (l.mono ? " mono" : "") }, l.text))
      : [el("div", { class: "empty" }, "Nothing yet.")]));
    if (atBottom) details.scrollTop = details.scrollHeight;
  }
  detailsToggle.addEventListener("click", () => {
    run.detailsOpen = !run.detailsOpen;
    render();
  });

  // ---------------- Render ----------------

  const CLOSABLE = new Set(["looking", "ask", "checking", "plan", "done", "error"]);
  closeBtn.append(icon("cross"));
  closeBtn.addEventListener("click", () => {
    micCancel();
    send("bar-cancel");
  });

  function render() {
    const phase = state.phase;
    const wasHidden = card.classList.contains("is-hidden");
    const fromHeight = wasHidden ? 0 : card.offsetHeight;
    const focusWasInside = card.contains(document.activeElement);
    card.dataset.phase = phase;

    if (phase === "hidden" || !VIEWS[phase]) {
      card.classList.add("is-hidden");
      card.setAttribute("aria-hidden", "true");
      lastPhase = "hidden";
      lastRect = "";
      return;
    }
    card.classList.remove("is-hidden");
    card.removeAttribute("aria-hidden");

    const view = VIEWS[phase](state);
    const changedPhase = phase !== lastPhase;
    lastPhase = phase;
    // A new screen (a question, a confirmation, the result) always opens up again, so nothing is missed.
    if (changedPhase && compact) setCompact(false, false);

    eyebrow.textContent = view.eyebrow || "";
    eyebrow.hidden = !view.eyebrow;
    title.replaceChildren(...view.title.filter((x) => x != null && x !== ""));

    const nodes = view.body || [];
    if (!sameChildren(body, nodes)) body.replaceChildren(...nodes);
    body.hidden = !nodes.length;

    renderDetails(view.detail ?? null);
    const line = view.now || "";
    if (nowText.textContent !== line) nowText.textContent = line;
    now.hidden = !line && detailsToggle.hidden;
    now.classList.toggle("is-live", !!view.live);
    now.classList.toggle("only-toggle", !line);

    // Same buttons as before (same labels): keep the elements and only swap what they do, so a press that's
    // half done (down, not yet up) isn't lost when an update arrives every few hundred milliseconds.
    const next = (view.buttons || []).filter(Boolean);
    const cur = [...actions.children];
    const keyOf = (n) => (n.dataset && n.dataset.key) || null;
    const same = cur.length === next.length && next.every((n, i) => keyOf(n) && keyOf(n) === keyOf(cur[i]));
    if (same) next.forEach((n, i) => { cur[i]._act = n._act; cur[i].disabled = n.disabled; });
    else actions.replaceChildren(...next);
    // The ask box: in the body on the "ask" screen, at the bottom on every other screen (except confirmations).
    if (!followRow.isConnected) actions.after(followRow);
    const followHere = !["ask", "confirm", "explain", "hidden"].includes(phase);
    if (followHere) {
      if (askRow.parentNode !== followRow) followRow.replaceChildren(askRow);
      input.placeholder = phase === "working" ? "Add something, or ask a question…" : "Ask me something else…";
    } else if (phase === "ask") {
      if (askRow.parentNode !== askBox) askBox.insertBefore(askRow, hint);
      input.placeholder = "Type it here…";
    }
    followRow.hidden = !followHere;
    if (followHere) {
      const note = micProblem || (state.heard ? `You said: “${state.heard}”` : "");
      let n = followRow.querySelector(".follow-note");
      if (note) {
        if (!n) { n = el("div", { class: "follow-note" }); followRow.append(n); }
        n.textContent = note;
      } else if (n) n.remove();
      setMicLook();
    }
    // The ✕ only where leaving is always safe (not mid-run).
    closeBtn.hidden = !CLOSABLE.has(phase);

    if (changedPhase) {
      for (const node of [head, body]) {
        node.classList.remove("enter");
        void node.offsetWidth;
        node.classList.add("enter");
      }
      body.scrollTop = 0;
    }
    // Keep keyboard focus in the card if the focused button was replaced.
    if (focusWasInside && !card.contains(document.activeElement)) card.focus({ preventScroll: true });

    animateHeight(fromHeight);
    scheduleRect();
    requestAnimationFrame(updateScrollFade);
  }

  function updateScrollFade() {
    const more = body.scrollHeight - body.scrollTop - body.clientHeight > 4;
    body.classList.toggle("can-scroll", more);
  }
  body.addEventListener("scroll", updateScrollFade, { passive: true });

  // Grow or shrink smoothly to the new content height.
  let heightTimer = 0;
  function animateHeight(from) {
    card.style.height = "";
    if (!from || reduceMotion.matches) return;
    const to = card.offsetHeight;
    if (Math.abs(to - from) < 2) return;
    card.style.height = from + "px";
    void card.offsetHeight;
    card.style.height = to + "px";
    clearTimeout(heightTimer);
    heightTimer = setTimeout(() => {
      card.style.height = "";
      scheduleRect();
      updateScrollFade();
    }, 280);
  }

  // ---------------- Smaller / bigger, and moving the card ----------------
  // Smaller shows just the title, the "now" line and the buttons (so Stop, Done and Skip stay in reach).

  let compact = false;
  function setCompact(on, animate = true) {
    const from = card.classList.contains("is-hidden") ? 0 : card.offsetHeight;
    compact = on;
    card.classList.toggle("is-compact", on);
    const label = on ? "Make bigger" : "Make smaller";
    sizeBtn.replaceChildren(icon(on ? "expand" : "collapse"));
    sizeBtn.setAttribute("aria-label", label);
    sizeBtn.title = label;
    sizeBtn.setAttribute("aria-expanded", on ? "false" : "true");
    if (animate) animateHeight(from);
    scheduleRect();
  }
  sizeBtn.addEventListener("click", () => setCompact(!compact));
  sizeBtn.replaceChildren(icon("collapse"));

  // Drag by the top of the card. The app moves the window to follow the mouse until it's let go.
  let dragging = null;
  head.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target.closest("button, input, a, textarea")) return;
    dragging = e.pointerId;
    try { head.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    card.classList.add("is-dragging");
    send("bar-drag", { on: true });
  });
  function endDrag() {
    if (dragging === null) return;
    try { head.releasePointerCapture(dragging); } catch { /* already released */ }
    dragging = null;
    card.classList.remove("is-dragging");
    send("bar-drag", { on: false });
  }
  head.addEventListener("pointerup", endDrag);
  head.addEventListener("pointercancel", endDrag);
  head.addEventListener("lostpointercapture", endDrag);
  window.addEventListener("blur", endDrag);
  head.addEventListener("dblclick", (e) => {
    if (e.target.closest("button, input, a, textarea")) return;
    send("bar-move-reset");
  });

  // ---------------- Tell the app where the card is (so clicks around it pass through) ----------------

  let lastRect = "";
  let rectFrame = 0;
  function scheduleRect() {
    if (rectFrame) return;
    rectFrame = requestAnimationFrame(() => {
      rectFrame = 0;
      if (state.phase === "hidden") return;
      const r = card.getBoundingClientRect();
      const data = { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
      const key = data.x + "," + data.y + "," + data.width + "," + data.height;
      if (key === lastRect) return;
      lastRect = key;
      send("bar-rect", data);
    });
  }
  if (typeof ResizeObserver === "function") new ResizeObserver(scheduleRect).observe(card);
  window.addEventListener("resize", scheduleRect);
  card.addEventListener("transitionend", scheduleRect);

  // ---------------- Voice out + captions ----------------

  const synth = window.speechSynthesis || null;
  const speech = { queue: [], current: null, timer: 0, speaking: false, voice: null, muted: false };
  let heartAudio = null;
  let heartUrl = null;
  function stopHeart() {
    if (heartAudio) {
      heartAudio.onended = null;
      heartAudio.onerror = null;
      heartAudio.pause();
      heartAudio.removeAttribute("src");
      heartAudio = null;
    }
    if (heartUrl) URL.revokeObjectURL(heartUrl);
    heartUrl = null;
  }
  try { speech.muted = localStorage.getItem("calhack.muted") === "1"; } catch { /* no storage */ }

  // Silly or robotic macOS voices we never want.
  const NOVELTY = /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley|fred|junior|ralph|kathy)\b/i;
  function pickVoice() {
    if (!synth) return null;
    const voices = synth.getVoices().filter((v) => /^en([-_]|$)/i.test(v.lang));
    if (!voices.length) return null;
    // Electron's default can differ from the voice selected in macOS settings.
    // Only voices exposed by speechSynthesis are usable here.
    const systemVoice = voices.find((v) => v.default && !NOVELTY.test(v.name));
    if (systemVoice) return systemVoice;
    const score = (v) => {
      let s = 0;
      if (/premium/i.test(v.name)) s += 100;
      else if (/enhanced/i.test(v.name)) s += 60;
      if (/\b(ava|zoe|samantha)\b/i.test(v.name)) s += 30;
      if (/^en[-_]US/i.test(v.lang)) s += 12;
      if (v.localService) s += 5;
      if (v.default) s += 2;
      if (NOVELTY.test(v.name)) s -= 200;
      return s;
    };
    return voices.slice().sort((a, b) => score(b) - score(a))[0];
  }
  if (synth) {
    speech.voice = pickVoice();
    synth.addEventListener?.("voiceschanged", () => { speech.voice = pickVoice(); });
  }

  function setSpeaking(on) {
    caption.classList.toggle("is-speaking", on);
    if (speech.speaking === on) return;
    speech.speaking = on;
    window.calhack?.send("bar-speaking", { on }); // the buddy moves its mouth while the voice talks
  }

  function showCaption(text) {
    captionText.textContent = text;
    caption.hidden = !text;
    caption.classList.remove("is-old");
    scheduleRect();
  }

  function say(msg) {
    const text = String(msg && msg.text ? msg.text : "").trim();
    if (!text) return;
    const item = { text };
    if (msg.mode === "now") {
      speech.queue.length = 0;
      const wasTalking = !!speech.current;
      speech.current = null;
      stopHeart();
      clearTimeout(speech.timer);
      if (synth && wasTalking) {
        try { synth.cancel(); } catch { /* ignore */ }
      }
      speech.queue.push(item);
      // Chrome can drop a speak() that comes right after cancel(), so wait a moment.
      speech.timer = setTimeout(next, wasTalking ? 60 : 0);
      showCaption(text);
      return;
    }
    speech.queue.push(item);
    if (!speech.current) next();
  }

  async function next() {
    stopHeart();
    clearTimeout(speech.timer);
    const item = speech.queue.shift();
    speech.current = item || null;
    if (!item) {
      setSpeaking(false);
      caption.classList.add("is-old");
      return;
    }
    showCaption(item.text);
    const finish = () => { if (!item.cancelled && speech.current === item) next(); };

    if (speech.muted) {
      // Captions only: give people time to read before the next one.
      setSpeaking(false);
      speech.timer = setTimeout(finish, Math.max(1800, item.text.length * 65));
      return;
    }
    if (typeof api.synthesize === "function") {
      try {
        const base64 = await api.synthesize(item.text);
        if (speech.current !== item || item.cancelled || speech.muted) return;
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        heartUrl = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
        const audio = new Audio(heartUrl);
        heartAudio = audio;
        audio.onended = finish;
        audio.onerror = finish;
        await audio.play();
        if (speech.current === item && !item.cancelled) setSpeaking(true);
        return;
      } catch (error) {
        if (speech.current !== item || item.cancelled || speech.muted) return;
        stopHeart();
        console.warn("Kokoro unavailable; using system speech:", error);
      }
    }
    if (!synth || typeof SpeechSynthesisUtterance !== "function") {
      setSpeaking(false);
      speech.timer = setTimeout(finish, Math.max(1800, item.text.length * 65));
      return;
    }
    const u = new SpeechSynthesisUtterance(item.text);
    if (speech.voice) u.voice = speech.voice;
    u.lang = speech.voice ? speech.voice.lang : "en-US";
    u.rate = 0.96;
    u.pitch = 1;
    u.volume = 1;
    u.onstart = () => { if (speech.current === item) setSpeaking(true); };
    u.onend = finish;
    u.onerror = finish;
    // In case "end" never comes (it sometimes doesn't).
    speech.timer = setTimeout(finish, item.text.length * 110 + 5000);
    try {
      synth.speak(u);
    } catch {
      clearTimeout(speech.timer);
      speech.timer = setTimeout(finish, Math.max(1800, item.text.length * 65));
    }
  }

  function stopSpeech(clear) {
    stopHeart();
    speech.queue.length = 0;
    speech.current = null;
    clearTimeout(speech.timer);
    if (synth) {
      try { synth.cancel(); } catch { /* ignore */ }
    }
    setSpeaking(false);
    if (clear) {
      captionText.textContent = "";
      caption.hidden = true;
    }
  }

  function drawMute() {
    muteBtn.replaceChildren(icon(speech.muted ? "muted" : "speaker"));
    const label = speech.muted ? "Turn voice on" : "Turn voice off";
    muteBtn.setAttribute("aria-label", label);
    muteBtn.title = label;
    muteBtn.setAttribute("aria-pressed", speech.muted ? "true" : "false");
    captionIcon.replaceChildren(icon(speech.muted ? "muted" : "speaker", "sm"));
  }
  muteBtn.addEventListener("click", () => {
    speech.muted = !speech.muted;
    try { localStorage.setItem("calhack.muted", speech.muted ? "1" : "0"); } catch { /* no storage */ }
    if (speech.muted && speech.current) {
      // Stop the voice, keep the caption on screen.
      const keep = speech.current;
      keep.cancelled = true; // ignore the "end" that cancel() fires
      stopHeart();
      clearTimeout(speech.timer);
      try { synth && synth.cancel(); } catch { /* ignore */ }
      setSpeaking(false);
      speech.timer = setTimeout(() => { if (speech.current === keep) next(); }, 1800);
    }
    drawMute();
  });
  drawMute();

  // ---------------- Messages from the app ----------------

  api.on("bar", (next) => {
    if (!next || typeof next.phase !== "string") return;
    const prev = state.phase;
    // A new run starts at "looking" (or straight at "ask"), after being hidden.
    if (next.phase === "hidden" || (prev === "hidden" && next.phase !== "hidden")) {
      run = freshRun();
      input.value = "";
      sendBtn.disabled = true;
      micProblem = "";
    }
    if (next.phase !== "ask" && micMode !== "idle") micCancel();
    if (next.phase === "hidden") stopSpeech(true);
    state = next;
    render();
  });

  api.on("say", (msg) => say(msg));

  render();
})();
