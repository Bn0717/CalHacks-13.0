// The lesson screen's thinking, with no drawing: what each screen says, which buttons it has, which keys do what,
// the progress strip and where the card sits. Pure functions, so tests can load this file in Node too.
// Loaded as a plain script before lesson.js; it puts everything on window.StrideLessonModel.
(function (root) {
  "use strict";

  // ---------------- Small text helpers ----------------

  /** "About 25 min", "About 1 hour", "About 1 hour 20 min". */
  function minutesText(minutes) {
    const m = Math.max(1, Math.round(Number(minutes) || 0));
    if (m < 60) return "About " + m + " min";
    const h = Math.floor(m / 60);
    const rest = Math.round((m - h * 60) / 5) * 5;
    const hours = h + (h === 1 ? " hour" : " hours");
    return "About " + hours + (rest > 0 && rest < 60 ? " " + rest + " min" : "");
  }

  const plural = (n, one, many) => n + " " + (n === 1 ? one : many);

  /** "25 lines to type · 6 steps" */
  function sizeText(estimate) {
    return plural(estimate.linesToType, "line", "lines") + " to type · " + plural(estimate.steps, "step", "steps");
  }

  /** Does a hint look like code (so it's shown in a code box)? */
  function isCode(text) {
    const t = String(text).trim();
    if (/\n/.test(t)) return true; // several lines
    if (/^<[^>]+>.*<\/?[^>]+>$/.test(t) || /^<[a-z!][^>]*>$/i.test(t)) return true; // starts and ends with a tag
    return /^[a-z0-9.#\s,-]+\{.*\}?$/i.test(t) || /;\s*}?$/.test(t); // a CSS rule
  }

  /** A "read more" link's words: "MDN: The ul element" → "Read more: The ul element". */
  function linkLabel(title) {
    const t = String(title || "").replace(/^\s*(MDN( Web Docs)?|W3Schools|web\.dev)\s*[:·–-]\s*/i, "").trim();
    return /^read more\b/i.test(t) ? t : "Read more: " + (t || "this idea");
  }

  /** A "You'll learn" chip starts with a capital letter, like every other chip ("the parts of a page" → "The parts…"). */
  function chipText(text) {
    const t = String(text || "").trim();
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  /** "0:42" */
  function clock(seconds) {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }

  // Words a 14-year-old who has never coded shouldn't have to know. Tests scan every screen's text for these.
  const JARGON = ["dom", "selector", "parse", "parses", "parsing", "runner", "anchor", "check", "checks", "checker", "json", "api", "schema", "validate", "render", "renderer", "payload", "null", "undefined", "error code", "stack"];

  /** The jargon words found in some text (whole words, any case). */
  function findJargon(text) {
    const found = [];
    for (const word of JARGON) {
      const re = new RegExp("(^|[^a-z])" + word.replace(/ /g, "\\s+") + "([^a-z]|$)", "i");
      if (re.test(text)) found.push(word);
    }
    return found;
  }

  // ---------------- The progress strip ----------------

  /** The steps grouped by chapter, for the strip: [{ id, title, current, steps: [{ mark, current, number }] }]. */
  function segments(progress) {
    const groups = progress.chapters.map((c) => ({ id: c.id, title: c.title, current: false, steps: [] }));
    const byId = new Map(groups.map((g) => [g.id, g]));
    progress.steps.forEach((s, i) => {
      let g = byId.get(s.chapter);
      if (!g) { g = { id: s.chapter, title: "", current: false, steps: [] }; groups.push(g); byId.set(s.chapter, g); }
      const current = i === progress.index;
      if (current) g.current = true;
      g.steps.push({ mark: s.mark, current, number: i + 1 });
    });
    return groups.filter((g) => g.steps.length > 0);
  }

  /** "Step 3 of 6, Write the page. 2 done." for screen readers. */
  function progressText(progress) {
    const total = progress.steps.length;
    const done = progress.steps.filter((s) => s.mark !== "todo").length;
    const step = progress.steps[progress.index];
    const chapter = step ? (progress.chapters.find((c) => c.id === step.chapter) || {}).title : "";
    if (!step) return "All " + total + " steps done.";
    return "Step " + (progress.index + 1) + " of " + total + (chapter ? ", " + chapter : "") + ". " + done + " done.";
  }

  // ---------------- What each screen says ----------------

  /** The badge on a step card. While Stride types it for them (Show me, Do this one for me) it's their turn to watch. */
  function whoBadge(who, status) {
    if (status === "showing") return { text: "Watch me", icon: "eye", tone: "watch" };
    if (who === "stride") return { text: "Stride's turn", icon: "bot", tone: "stride" };
    if (who === "watch") return { text: "Watch", icon: "eye", tone: "watch" };
    return { text: "Your turn", icon: "hand", tone: "you" };
  }

  /** A note without its opening words ("Still typing? The <ul>…" → "The <ul>…"), since the title already says them. */
  function dropLead(note, lead) {
    if (!note) return "";
    const t = String(note).trim();
    return t.startsWith(lead) ? t.slice(lead.length).trim() : t;
  }

  /** How many parts of the step are right so far, when some are: { done, total, text } or undefined. */
  function partsOf(view) {
    const p = view.parts;
    if (!p || !(p.total > 1) || !(p.done > 0) || p.done >= p.total) return undefined;
    return { done: p.done, total: p.total, text: p.done + " of " + p.total + " parts right" };
  }

  /** The status row on a step card: { title, line, tone, pose, busy, parts? }. */
  function stepStatus(view) {
    const s = view.step;
    const note = view.note;
    switch (view.status) {
      case "typing":
        return { title: "Keep going", line: "I'm watching. Take your time.", tone: "calm", pose: "watch" };
      case "checking":
        return { title: "Let me look…", line: "Looking at what you typed.", tone: "busy", pose: "think", busy: true };
      case "passed": {
        const mark = view.progress.steps[view.progress.index];
        const shown = mark && mark.mark === "shown";
        return { title: shown ? "Done!" : "Nice, that works!", line: shown ? "I typed that one for you. Next step coming up." : "Next step coming up.", tone: "good", pose: "celebrate" };
      }
      case "partial":
        // Half-typed code is never judged; a try that's closer than before gets a quiet "getting closer".
        if (view.partial === "closer") return { title: "Getting closer", line: dropLead(note, "Almost there.") || "More of it is right now. Keep going.", tone: "calm", pose: "talk", parts: partsOf(view) };
        return { title: "Still typing?", line: dropLead(note, "Still typing?") || "Finish the line you're on. I'll look again when you stop.", tone: "calm", pose: "watch" };
      case "stuck": {
        // Wrong, even if some parts are right: say what to fix. "Almost there" only when at least half is right.
        const parts = partsOf(view);
        const line = dropLead(note, "Almost there.");
        if (view.hintOffered) return { title: "Want a hint?", line: line || "No rush. A hint can get you moving again.", tone: "warn", pose: "point", parts };
        const almost = parts && parts.done > 0 && parts.done * 2 >= parts.total;
        return { title: almost ? "Almost there" : "Not quite yet", line: line || "Something's a little off. Have another look, or tap Hint.", tone: "warn", pose: "point", parts };
      }
      case "showing":
        return { title: "Watch me type it", line: (s.file ? "Watch it appear in " + s.file : "Watch it appear in your file") + ". Next time, you try.", tone: "busy", pose: "type", busy: true };
      case "stride-working":
        return { title: "I'm doing this one", line: "It's setup, so you can sit back.", tone: "busy", pose: "carry", busy: true };
      case "stride-failed":
        return { title: "That didn't work", line: note || "You can try again, or skip this step.", tone: "warn", pose: "sad" };
      case "watch":
        return { title: "Watch this part", line: "Then tap Done watching.", tone: "calm", pose: "idle" };
      default:
        if (view.hintOffered) return { title: "Want a hint?", line: "No rush. A hint can get you moving again.", tone: "warn", pose: "point" };
        return { title: s.file ? "Type it in " + s.file : "Type it in your file", line: "I'll spot it when it's right. No button to press.", tone: "calm", pose: s.line ? "point" : "idle" };
    }
  }

  /** What the buddy does on each screen: { pose, aim, look }. look: -1/1 eyes toward the code, 0 straight. */
  function buddyFor(view) {
    switch (view.screen) {
      case "building": return { pose: "type" };
      case "question": return { pose: view.number === 1 ? "wave" : "talk" };
      case "picture": return { pose: "scan" };
      case "estimate": return { pose: "idle" };
      case "setup": return { pose: view.ask ? "talk" : "carry" };
      case "quiz": return { pose: view.picked === undefined ? "think" : view.picked === view.answer ? "celebrate" : "talk" };
      case "paused": return { pose: view.reason === "welcome-back" ? "wave" : "idle" };
      case "error": return { pose: "sad" };
      case "finished": return { pose: "celebrate" };
      case "step": {
        const p = stepStatus(view).pose;
        if (p === "watch") return { pose: "idle", look: 1 }; // eyes on the code while they type
        if (p === "point") return { pose: "point", aim: "side", look: 1 };
        return { pose: p };
      }
      default: return { pose: "idle" };
    }
  }

  /** Words for each error kind: { title, line, actions }. */
  function errorCopy(view) {
    const saved = view.saved ? " Your progress is saved." : "";
    switch (view.kind) {
      case "no-key":
        return {
          title: "I can't build lessons yet",
          line: "I need my AI key first. Whoever set up Stride adds it once in Settings." + saved,
          actions: [
            { id: "settings", label: "Open Settings", channel: "lesson-open-settings", kind: "primary" },
            { id: "retry", label: "Try again", channel: "lesson-retry", kind: "secondary" },
          ],
        };
      case "no-internet":
        return {
          title: "You're offline",
          line: "I need the internet to build lessons and find new hints. Make sure Wi-Fi is on, then tap Try again." + saved,
          actions: [
            { id: "retry", label: "Try again", channel: "lesson-retry", kind: "primary" },
            { id: "close", label: "Close", channel: "lesson-close", kind: "secondary" },
          ],
        };
      case "video-unreadable":
        return {
          title: "I couldn't watch that video",
          line: "It may be private, age-limited or very long. Try another video, or tell me your idea instead.",
          actions: [
            { id: "video", label: "Try another video", channel: "lesson-other-video", kind: "primary" },
            { id: "idea", label: "Use my idea instead", channel: "lesson-use-idea", kind: "secondary" },
          ],
        };
      default:
        return {
          title: "Something went wrong",
          line: (view.message || "That one's on me, not you. Tap Try again.") + saved,
          actions: [
            { id: "retry", label: "Try again", channel: "lesson-retry", kind: "primary" },
            { id: "close", label: "Close", channel: "lesson-close", kind: "secondary" },
          ],
        };
    }
  }

  // ---------------- Plain words ----------------

  // Words a beginner meets on screen that need a few plain words the first time. Lessons come from the AI, so the
  // screen adds the explanation itself: [what to look for, what to add after it].
  const PLAIN = [
    [/\b(the |a )?doctype\b(?! \()/i, " (the first line, which tells the browser it's a web page)"],
    [/<!DOCTYPE html>(?! \()/i, " (the line that tells the browser it's a web page)"],
    [/\b(a |the )?hidden browser\b(?! \()/i, " (a web browser you can't see, so I can try the site out)"],
  ];

  /** Adds a short plain explanation after the first tricky word in some text ("the doctype (the first line, …)"). */
  function explainTerms(text) {
    let out = String(text);
    for (const [re, plain] of PLAIN) {
      const m = re.exec(out);
      if (!m || out.includes(plain.trim().slice(-20))) continue; // missing, or already explained
      // Not inside a <tag> or `code`: those are shown as code.
      const before = out.slice(0, m.index);
      if ((before.match(/</g) || []).length > (before.match(/>/g) || []).length) continue;
      if ((before.match(/`/g) || []).length % 2 === 1) continue;
      out = out.slice(0, m.index + m[0].length) + plain + out.slice(m.index + m[0].length);
    }
    return out;
  }

  /** The building screen's stages: as sent, or made from the stage labels and the one running now. */
  function buildingStages(view) {
    if (Array.isArray(view.stages) && view.stages.length) return view.stages;
    const labels = Array.isArray(view.labels) ? view.labels : [];
    const at = Number.isInteger(view.stage) ? view.stage : 0;
    return labels.map((label, i) => ({ label: String(label), status: i < at ? "done" : i === at ? "running" : "todo" }));
  }

  // ---------------- Buttons and keys ----------------

  /**
   * The step card's buttons, in Tab order: [{ id, label, channel, data?, key?, kind }].
   * kind: primary (the one clear next action) | secondary | quiet. key: the shortcut shown on the button.
   */
  function stepActions(view) {
    const a = [];
    const s = view.step;
    const video = s.video ? { id: "watch", label: "Watch this part", channel: "lesson-watch", data: { start: s.video.start, end: s.video.end }, key: "W", icon: "play" } : null;
    if (s.who === "watch") {
      if (video) a.push({ ...video, kind: "primary" });
      a.push({ id: "continue", label: "Done watching", channel: "lesson-continue", key: "C", kind: video ? "secondary" : "primary" });
      return a;
    }
    if (s.who === "stride") {
      if (view.status === "stride-failed") {
        a.push({ id: "retry", label: "Try again", channel: "lesson-retry", key: "R", kind: "primary" });
        a.push({ id: "skip", label: "Skip", channel: "lesson-skip", key: "N", kind: "quiet" });
      }
      return a;
    }
    if (view.status === "passed") return a;
    if (view.status === "showing") {
      if (view.doneForMe) a.push({ id: "let-me-try", label: "Let me try", channel: "lesson-let-me-try", key: "L", kind: "secondary" });
      return a;
    }
    const hints = view.hints.length;
    if (view.doneForMe) a.push({ id: "let-me-try", label: "Let me try", channel: "lesson-let-me-try", key: "L", kind: "primary" });
    if (hints < 3) {
      const offered = view.hintOffered && hints === 0;
      a.push({
        id: "hint",
        label: offered ? "Yes, give me a hint" : hints === 0 ? "Hint" : "Another hint",
        channel: "lesson-hint",
        key: "H",
        icon: "bulb",
        kind: offered || view.status === "stuck" ? "primary" : "secondary",
      });
    }
    if (view.canShowMe && !view.doneForMe) a.push({ id: "show-me", label: "Show me", channel: "lesson-show-me", key: "S", icon: "type", kind: hints >= 3 ? "primary" : "secondary" });
    // (On typing steps, "Watch this part" is a chip on the card, see videoChip, so this row stays short.)
    a.push({ id: "skip", label: "Skip", channel: "lesson-skip", key: "N", kind: "quiet" });
    // Never two primaries: the first one wins.
    let seen = false;
    for (const b of a) {
      if (b.kind !== "primary") continue;
      if (seen) b.kind = "secondary";
      seen = true;
    }
    return a;
  }

  /** The "Watch this part" chip on a typing step with a video part, or null. */
  function videoChip(view) {
    const s = view.step;
    if (!s.video || s.who !== "learner" || view.status === "passed") return null;
    return { id: "watch", label: "Watch this part", channel: "lesson-watch", data: { start: s.video.start, end: s.video.end }, key: "W", icon: "play", kind: "chip" };
  }

  /** The keys list shown on the expanded card: [{ key, label }], one per key, plus Esc. */
  function keyList(actions) {
    const keys = [];
    for (const b of actions) {
      if (!b.key || b.key.length !== 1 || keys.some((k) => k.key === b.key)) continue;
      keys.push({ key: b.key, label: b.keyLabel || b.label });
    }
    keys.push({ key: "Esc", label: "Close this panel" });
    return keys;
  }

  /** Which action a key press means, or null. Letters only, no modifiers, never while typing in a text box. */
  function actionForKey(event, actions) {
    if (!event || event.metaKey || event.ctrlKey || event.altKey) return null;
    const tag = event.target && event.target.tagName ? String(event.target.tagName).toLowerCase() : "";
    if (tag === "textarea" || tag === "input" || (event.target && event.target.isContentEditable)) return null;
    const k = String(event.key || "");
    if (k.length !== 1) return null;
    const up = k.toUpperCase();
    return actions.find((b) => b.key === up && !b.disabled) || null;
  }

  // ---------------- Where the card sits ----------------

  const LAYOUT_KEY = "stride.lesson.layout";
  const DEFAULT_LAYOUT = { dock: "right", expanded: false };

  function cleanLayout(value) {
    const v = value && typeof value === "object" ? value : {};
    return { dock: v.dock === "left" ? "left" : "right", expanded: v.expanded === true };
  }

  /** actions: { type: "toggle" } | { type: "close" } | { type: "open" } | { type: "swap" } | { type: "dock", side } | { type: "set", layout } */
  function layoutReduce(layout, action) {
    const l = cleanLayout(layout);
    switch (action && action.type) {
      case "toggle": return { ...l, expanded: !l.expanded };
      case "close": return { ...l, expanded: false };
      case "open": return { ...l, expanded: true };
      case "swap": return { ...l, dock: l.dock === "left" ? "right" : "left" };
      case "dock": return { ...l, dock: action.side === "left" ? "left" : "right" };
      case "set": return cleanLayout(action.layout);
      default: return l;
    }
  }

  /** Reads the remembered layout. Storage can be missing or throw (private window, blocked): then the default. */
  function readLayout(storage) {
    try {
      const raw = storage && storage.getItem(LAYOUT_KEY);
      return raw ? cleanLayout(JSON.parse(raw)) : { ...DEFAULT_LAYOUT };
    } catch {
      return { ...DEFAULT_LAYOUT };
    }
  }

  function writeLayout(storage, layout) {
    try {
      if (storage) storage.setItem(LAYOUT_KEY, JSON.stringify(cleanLayout(layout)));
      return true;
    } catch {
      return false;
    }
  }

  /** Should a new view open the expanded card by itself? Only once per step, when the app asks. */
  function autoOpen(prevStepId, view) {
    return !!(view && view.screen === "step" && view.open && view.step.id !== prevStepId);
  }

  /** Joins sentences with ". ", without doubling up punctuation ("Nice!" stays "Nice!"). */
  function sentences(...parts) {
    return parts.filter((p) => p && String(p).trim()).map((p) => { const t = String(p).trim(); return /[.!?…]$/.test(t) ? t : t + "."; }).join(" ");
  }

  /** A short line for screen readers when the view changes, or "" when nothing worth saying changed. */
  function announce(prev, view) {
    if (!view || view.screen === "hidden") return "";
    if (view.screen === "step") {
      const st = stepStatus(view);
      const sameStep = prev && prev.screen === "step" && prev.step.id === view.step.id;
      if (sameStep && prev.status === view.status && prev.hints.length === view.hints.length && prev.hintOffered === view.hintOffered) return "";
      if (sameStep && view.hints.length > prev.hints.length) return "Hint " + view.hints.length + ": " + view.hints[view.hints.length - 1];
      const head = sameStep ? [] : ["Step " + view.step.number + " of " + view.step.total, whoBadge(view.step.who, view.status).text, view.step.title];
      if (!sameStep && (view.status === "your-turn" || view.status === "watch")) return sentences(...head, view.step.instruction);
      return sentences(...head, st.title, st.line);
    }
    if (prev && prev.screen === view.screen && JSON.stringify(prev) === JSON.stringify(view)) return "";
    switch (view.screen) {
      case "building": {
        const running = buildingStages(view).find((s) => s.status === "running");
        return running ? running.label + "…" : "Building your lesson.";
      }
      case "question": return "Question " + view.number + " of " + view.total + ". " + view.question;
      case "picture": return "Here's what I see in your picture. " + view.summary;
      case "estimate": return view.simpler ? "Before we start. I recommend starting simple." : "Before we start.";
      case "setup": return view.ask ? view.ask.question : "Getting things ready.";
      case "quiz": return view.picked === undefined ? "Quick question. " + view.question : view.picked === view.answer ? "That's right! " + (view.explain || "") : "Not quite. " + (view.explain || "");
      case "paused": return view.reason === "welcome-back" ? "Welcome back!" : "Taking a break.";
      case "error": return sentences(errorCopy(view).title, errorCopy(view).line);
      case "finished": return "You made it! " + view.title + " is done.";
      default: return "";
    }
  }

  /** Every bit of text a view can show, for the jargon test. */
  function allText(view) {
    const parts = [];
    const add = (v) => { if (typeof v === "string") parts.push(v); };
    if (view.screen === "step") {
      const st = stepStatus(view);
      add(st.title); add(st.line); add(whoBadge(view.step.who, view.status).text);
      if (st.parts) add(st.parts.text);
      for (const b of stepActions(view)) add(b.label);
    }
    if (view.screen === "error") {
      const e = errorCopy(view);
      add(e.title); add(e.line);
      e.actions.forEach((b) => add(b.label));
    }
    add(announce(null, view));
    return parts.join("\n");
  }

  root.StrideLessonModel = {
    minutesText, sizeText, isCode, clock, findJargon, JARGON, linkLabel, chipText,

    segments, progressText,
    whoBadge, stepStatus, buddyFor, errorCopy, explainTerms, buildingStages,
    stepActions, videoChip, keyList, actionForKey,
    LAYOUT_KEY, DEFAULT_LAYOUT, layoutReduce, readLayout, writeLayout, autoOpen,
    announce, allText,
  };
})(typeof window !== "undefined" ? window : globalThis);
