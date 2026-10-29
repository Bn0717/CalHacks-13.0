// Preview only: a fake app (window.calhack) and a fake VS Code, so lesson.js can be tried in a normal browser.
// The lesson comes from tests/learn/fixtures/about-me.lesson.json, read through a local server (npm run learn:preview).
// URL options: ?shot (no controls, for screenshots) · ?still (no motion) · ?theme=light|dark · ?text=2 · ?dock=left|right
// · #state-name to start on a state · ?play to play the whole lesson.
(() => {
  "use strict";

  const FIXTURE = "../../../tests/learn/fixtures/about-me.lesson.json";
  const listeners = {};
  const timers = [];
  const later = (ms, fn) => timers.push(setTimeout(fn, ms));
  const clearTimers = () => { while (timers.length) clearTimeout(timers.pop()); };
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);

  function emit(channel, data) {
    for (const cb of listeners[channel] || []) cb(JSON.parse(JSON.stringify(data)));
  }
  function log(text) {
    const box = $("lp-log");
    if (box) box.textContent = (text + "\n" + box.textContent).slice(0, 3000);
  }

  let lesson = null;
  let current = null; // the view on screen
  let demo = null; // the whole-lesson player, when it's playing

  // ---------------- The fake VS Code ----------------

  const editor = { files: {}, file: "index.html", target: null, caret: null };

  // Adds a step's code to the files at its anchor, like the real lesson would. Returns the first line (1-based).
  function insertAt(files, step, text) {
    const old = files[step.file] || "";
    const lines = old === "" ? [] : old.replace(/\n$/, "").split("\n");
    const add = text.replace(/\n$/, "").split("\n");
    const a = step.anchor || {};
    let at = lines.length;
    if (a.afterLine !== undefined) at = Math.min(a.afterLine, lines.length);
    else if (a.inside) { // at the end of the tag, just before its closing tag (like src/learn/anchor.ts)
      const close = lines.findIndex((l) => l.includes("</" + a.inside));
      const open = lines.findIndex((l) => l.includes("<" + a.inside));
      at = close >= 0 ? close : open >= 0 ? open + 1 : lines.length;
    }
    else if (a.after) { const i = lines.findIndex((l) => l.includes(a.after)); at = i >= 0 ? i + 1 : lines.length; }
    if (text !== "") lines.splice(at, 0, ...add);
    files[step.file] = lines.length ? lines.join("\n") + "\n" : "";
    return at + 1;
  }

  /** The editor for step `index`: everything before it typed, plus `typed` (some or all of this step's code). */
  function setEditor(index, typed, { caret = false } = {}) {
    const files = { "index.html": "" };
    lesson.steps.slice(0, index).forEach((s) => { if (s.file && s.expected) insertAt(files, s, s.expected); });
    const step = lesson.steps[index];
    let target = null;
    if (step && step.file) {
      if (!(step.file in files)) files[step.file] = "";
      const text = typed == null ? "" : typed;
      const line = insertAt(files, step, text);
      const n = text ? text.replace(/\n$/, "").split("\n").length : 1;
      target = { from: line, to: line + n - 1 };
      if (!text) { // nothing typed yet: show the empty line they'll type on
        const lines = files[step.file] === "" ? [] : files[step.file].replace(/\n$/, "").split("\n");
        lines.splice(line - 1, 0, "");
        files[step.file] = lines.join("\n") + "\n";
      }
      editor.file = step.file;
    }
    editor.files = files;
    editor.target = target;
    editor.caret = caret && target ? target.to : null;
    drawEditor();
    return target ? target.from : undefined;
  }

  function highlight(line, file) {
    const frag = document.createDocumentFragment();
    const span = (cls, text) => { const s = document.createElement("span"); if (cls) s.className = cls; s.textContent = text; return s; };
    if (/\.css$/.test(file)) {
      const m = line.match(/^(\s*)([\w-]+)(\s*:\s*)(.*)$/);
      if (m) { frag.append(m[1], span("t-prop", m[2]), m[3], span("t-str", m[4])); return frag; }
      const sel = line.match(/^(\s*)([^{]+)(\{.*)$/);
      if (sel) { frag.append(sel[1], span("t-sel", sel[2]), sel[3]); return frag; }
      frag.append(line);
      return frag;
    }
    for (const part of line.split(/(<[^>]*>)/g)) {
      if (!part) continue;
      if (!part.startsWith("<")) { frag.append(part); continue; }
      for (const bit of part.split(/("[^"]*")/g)) {
        if (!bit) continue;
        if (bit.startsWith('"')) frag.append(span("t-str", bit));
        else frag.append(span("t-tag", bit));
      }
    }
    return frag;
  }

  function drawEditor() {
    const tabs = $("lp-tabs");
    tabs.replaceChildren(...Object.keys(editor.files).map((f) => { const t = document.createElement("div"); t.className = "lp-tab" + (f === editor.file ? " on" : ""); t.textContent = f; return t; }));
    const text = editor.files[editor.file] || "";
    const lines = text.replace(/\n$/, "").split("\n");
    const box = $("lp-editor");
    box.replaceChildren(...lines.map((l, i) => {
      const n = i + 1;
      const row = document.createElement("div");
      const on = editor.target && n >= editor.target.from && n <= editor.target.to;
      row.className = "lp-line" + (on ? " target" : "");
      const num = document.createElement("span");
      num.className = "lp-num";
      num.textContent = String(n);
      const code = document.createElement("span");
      code.append(highlight(l, editor.file));
      if (editor.caret === n) { const c = document.createElement("span"); c.className = "lp-caret"; code.append(c); }
      row.append(num, code);
      return row;
    }));
    $("lp-wintitle").textContent = editor.file + " — about-me — Visual Studio Code";
    $("lp-pos").textContent = "Ln " + (editor.target ? editor.target.to : 1) + ", Col 1";
  }

  // ---------------- Views built from the fixture ----------------

  const learnerSteps = () => lesson.steps.filter((s) => s.who === "learner");

  function progress(index, marks = {}) {
    return {
      chapters: lesson.chapters.map((c) => ({ id: c.id, title: c.title })),
      steps: lesson.steps.map((s, i) => ({ chapter: s.chapter, mark: marks[s.id] || (i < index ? "done" : "todo") })),
      index,
    };
  }

  function stepView(index, extra = {}) {
    const s = lesson.steps[index];
    const chapter = lesson.chapters.find((c) => c.id === s.chapter);
    const hintLevel = extra.hintLevel || 0;
    const v = {
      screen: "step",
      lessonTitle: lesson.title,
      progress: progress(index, extra.marks),
      step: {
        id: s.id,
        number: index + 1,
        total: lesson.steps.length,
        title: s.title,
        instruction: s.instruction,
        why: s.why,
        who: s.who,
        chapterTitle: chapter ? chapter.title : "",
        ...(s.file ? { file: s.file } : {}),
        ...(extra.line ? { line: extra.line } : {}),
        ...(s.concept ? { concept: { title: s.concept.title, explain: s.concept.explain, links: s.concept.links } } : {}),
        ...(extra.video ? { video: extra.video } : {}),
      },
      status: extra.status || (s.who === "stride" ? "stride-working" : s.who === "watch" ? "watch" : "your-turn"),
      hints: s.hints.slice(0, hintLevel),
      hintOffered: !!extra.hintOffered,
      canShowMe: extra.canShowMe !== undefined ? extra.canShowMe : hintLevel >= 3,
      doneForMe: !!extra.doneForMe,
      pace: extra.pace || "learn",
      ...(extra.note ? { note: extra.note } : {}),
      ...(extra.open ? { open: extra.open } : {}),
    };
    if (extra.override) Object.assign(v.step, extra.override);
    return v;
  }

  const idx = (id) => lesson.steps.findIndex((s) => s.id === id);
  const half = (code) => { const l = code.replace(/\n$/, "").split("\n"); return l.slice(0, Math.max(1, Math.ceil(l.length / 2))).join("\n"); };
  const typo = (code) => code.replace("</h1>", "<h1>").replace("</li>", "<li>");

  // Each state: { view, editor: [stepIndex, typed, caret], layout }.
  function catalog() {
    const intro = idx("intro");
    const hobbies = idx("hobbies");
    const skeleton = idx("skeleton");
    const linkCss = idx("link-css");
    const style = idx("style");
    const I = lesson.steps[intro];
    const H = lesson.steps[hobbies];
    const fullEst = lesson.estimate;
    const simplerOffer = { title: "Just your name and a hello", why: "One heading and one sentence. You'll be done in a few minutes, then we can add the rest.", estimate: { minutes: 8, linesToType: 6, steps: 3 }, learns: ["The parts of an HTML page", "Headings and paragraphs"] };
    const sumLearner = learnerSteps().length;
    const S = {};
    const add = (name, def) => { S[name] = def; };

    // Like the app will send it from the lesson builder's stages: the labels and the one running now.
    add("building", { view: { screen: "building", what: lesson.title, labels: BUILD_STAGES, stage: 2, time: BUILD_TIME } });
    add("question", { view: { screen: "question", id: "purpose", number: 1, total: 3, question: "What's it for?", options: ["Just for me", "Show my work", "For job applications", "Share with friends"], multi: false, picked: [] } });
    add("question-multi", { view: { screen: "question", id: "contents", number: 2, total: 3, question: "What should it have?", options: ["My name and a short intro", "My hobbies", "My projects", "Photos", "How to contact me"], multi: true, picked: ["My name and a short intro", "My hobbies"] } });
    add("question-look", { view: { screen: "question", id: "look", number: 3, total: 3, question: "A look you like?", options: ["Clean and simple", "Warm and friendly", "Bold and colourful", "Dark and modern"], multi: false, picked: [], extras: ["addPicture", "showStyles"] } });
    add("picture", { view: { screen: "picture", summary: "A simple page with a big title at the top, a short hello, and a list of hobbies underneath.", image: pictureMock(), sections: [
      { name: "Big title", description: "Your name, large, at the top" },
      { name: "Short hello", description: "One or two sentences about you" },
      { name: "Hobbies list", description: "Three things you like, with dots" },
    ] } });
    add("estimate", { view: { screen: "estimate", title: lesson.title, outcome: lesson.outcome, learns: lesson.learns, estimate: { minutes: 95, linesToType: 150, steps: 32 }, simpler: simplerOffer } });
    add("estimate-short", { view: { screen: "estimate", title: lesson.title, outcome: lesson.outcome, learns: lesson.learns, estimate: fullEst } });
    add("setup", { view: { screen: "setup", items: [
      { label: "VS Code is installed", status: "done" },
      { label: "Made a folder called about-me", status: "done" },
      { label: "Opening it in VS Code with a live preview", status: "running" },
      { label: "Adding Stride's helper to VS Code", status: "todo" },
    ] } });
    add("setup-ask", { view: { screen: "setup", items: [
      { label: "VS Code is installed", status: "done" },
      { label: "Made a folder called about-me", status: "done" },
      { label: "Opened it with a live preview", status: "done" },
      { label: "Adding Stride's helper to VS Code", status: "todo" },
    ], ask: { question: "Can I add my helper to VS Code?", why: "It lets me see what you type and point at the right line. I only ask once.", yes: "Yes, add it", no: "Not now" } } });
    add("stride-step", { view: stepView(0, { status: "stride-working" }), editor: [0, ""] });
    add("your-turn", { view: stepView(intro, { line: 9 }), editor: [intro, "", true] });
    add("docked-left", { view: stepView(intro, { line: 9 }), editor: [intro, "", true], dock: "left" });
    add("typing", { view: stepView(intro, { status: "typing", line: 9 }), editor: [intro, half(I.expected) + "\n    <p>I'm learn", true] });
    add("checking", { view: stepView(intro, { status: "checking", line: 9 }), editor: [intro, I.expected] });
    add("passed", { view: stepView(intro, { status: "passed", line: 9, marks: { intro: "done" } }), editor: [intro, I.expected] });
    add("partial", { view: stepView(intro, { status: "partial", line: 9, note: "Your big heading is there. Now add a short paragraph under it." }), editor: [intro, half(I.expected), true] });
    add("stuck", { view: stepView(hobbies, { status: "stuck", line: 12, note: "One of the list items isn't closed yet. Look at the end of each line." }), editor: [hobbies, typo(H.expected)] });
    add("want-hint", { view: stepView(hobbies, { status: "stuck", line: 12, hintOffered: true }), editor: [hobbies, typo(H.expected)] });
    add("hint-1", { view: stepView(hobbies, { status: "stuck", line: 12, hintLevel: 1 }), editor: [hobbies, typo(H.expected)] });
    add("hint-2", { view: stepView(hobbies, { status: "stuck", line: 12, hintLevel: 2 }), editor: [hobbies, typo(H.expected)] });
    add("hint-3", { view: stepView(hobbies, { status: "stuck", line: 12, hintLevel: 3, canShowMe: true }), editor: [hobbies, typo(H.expected)] });
    add("hints-expanded", { view: stepView(hobbies, { status: "stuck", line: 12, hintLevel: 3, canShowMe: true }), editor: [hobbies, typo(H.expected)], layout: { expanded: true } });
    add("show-me", { view: stepView(hobbies, { status: "showing", line: 12, hintLevel: 3, canShowMe: true, marks: { hobbies: "shown" } }), editor: [hobbies, half(H.expected), true] });
    add("do-for-me", { view: stepView(linkCss, { status: "showing", line: 6, doneForMe: true, pace: "fast", canShowMe: true, marks: { "link-css": "shown" } }), editor: [linkCss, lesson.steps[linkCss].expected, true] });
    add("concept", { view: stepView(skeleton, { line: 1, open: "concept" }), editor: [skeleton, "", true], layout: { expanded: true } });
    add("video", { view: stepView(skeleton, { line: 1, video: { videoId: "UB1O30fR-EE", start: 42, end: 95 } }), editor: [skeleton, "", true], layout: { expanded: true } });
    add("watch-step", { view: stepView(skeleton, { status: "watch", override: { who: "watch", title: "See what you'll make", instruction: "Watch the start of the video to see the page you're about to build.", why: "It helps to know where you're going." }, video: { videoId: "UB1O30fR-EE", start: 0, end: 35 } }), editor: [skeleton, ""] });
    add("stride-failed", { view: stepView(0, { status: "stride-failed", note: "VS Code didn't open. You can open it yourself from Applications, then tap Try again." }), editor: [0, ""] });
    const quiz = lesson.steps[style].quiz;
    add("quiz", { view: { screen: "quiz", chapterTitle: "Make it look nice", question: quiz.question, options: quiz.options, progress: progress(style + 1) } });
    add("quiz-answered", { view: { screen: "quiz", chapterTitle: "Make it look nice", question: quiz.question, options: quiz.options, picked: 0, answer: quiz.answer, explain: quiz.explain, progress: progress(style + 1) } });
    // Behind the break screens: the student's code so far (the steps before this one, and what they'd typed of it).
    add("paused", { view: { screen: "paused", reason: "break", lessonTitle: lesson.title, step: { number: hobbies + 1, total: lesson.steps.length, title: H.title }, hintsUsed: 2, progress: progress(hobbies) }, editor: [hobbies, typo(H.expected)] });
    add("welcome-back", { view: { screen: "paused", reason: "welcome-back", lessonTitle: lesson.title, step: { number: hobbies + 1, total: lesson.steps.length, title: H.title }, hintsUsed: 2, progress: progress(hobbies, { intro: "hinted" }) }, editor: [hobbies, typo(H.expected)] });
    add("error-no-key", { view: { screen: "error", kind: "no-key", saved: true } });
    add("error-no-internet", { view: { screen: "error", kind: "no-internet", saved: true } });
    add("error-video", { view: { screen: "error", kind: "video-unreadable" } });
    add("error-other", { view: { screen: "error", kind: "other", message: "I couldn't save your progress just now.", saved: false } });
    add("finished", { view: { screen: "finished", title: lesson.title, outcome: lesson.outcome, picture: finishedMock(), learned: ["The parts of an HTML page", "Lists", "Linking CSS"], steps: sumLearner, allSteps: lesson.steps.length, alone: 3, hinted: 1, shown: 1, skipped: 0, minutes: 24, next: { title: "Add a photo of you", why: "Learn the <img> tag and make the page feel like yours.", minutes: 20 } } });
    return S;
  }

  // The idea builder's stages and build time, as in src/learn/stages.ts (tests/learn/view.test.ts keeps them the same).
  const BUILD_STAGES = ["Checking how big your idea is", "Writing the finished website", "Testing it in a hidden browser", "Cutting it into small steps", "Making sure every step can be checked", "Working out how long it takes"];
  const BUILD_TIME = "usually a minute or two";

  // A small drawing of a reference picture (SVG as a data: URL, so it works without files).
  function pictureMock() {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" rx="10" fill="#f4efe8"/><rect x="24" y="22" width="170" height="20" rx="4" fill="#333"/><rect x="24" y="54" width="250" height="9" rx="4" fill="#9a8f84"/><rect x="24" y="70" width="210" height="9" rx="4" fill="#9a8f84"/><rect x="24" y="98" width="110" height="13" rx="4" fill="#555"/><circle cx="32" cy="128" r="4" fill="#555"/><rect x="44" y="124" width="90" height="8" rx="4" fill="#9a8f84"/><circle cx="32" cy="145" r="4" fill="#555"/><rect x="44" y="141" width="76" height="8" rx="4" fill="#9a8f84"/><circle cx="32" cy="162" r="4" fill="#555"/><rect x="44" y="158" width="84" height="8" rx="4" fill="#9a8f84"/></svg>`;
    return "data:image/svg+xml," + encodeURIComponent(svg);
  }
  function finishedMock() {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 190"><rect width="320" height="190" fill="#ffffff"/><rect width="320" height="18" fill="#e9e9ee"/><circle cx="10" cy="9" r="3.5" fill="#ff5f57"/><circle cx="21" cy="9" r="3.5" fill="#febc2e"/><circle cx="32" cy="9" r="3.5" fill="#28c840"/><text x="24" y="54" font-family="Arial" font-size="22" font-weight="bold" fill="#ff6347">Hi, I'm Sam</text><text x="24" y="78" font-family="Arial" font-size="11" fill="#222">I'm learning to make websites.</text><text x="24" y="104" font-family="Arial" font-size="15" font-weight="bold" fill="#222">Things I like</text><text x="34" y="124" font-family="Arial" font-size="11" fill="#222">• Drawing</text><text x="34" y="141" font-family="Arial" font-size="11" fill="#222">• Basketball</text><text x="34" y="158" font-family="Arial" font-size="11" fill="#222">• Cooking</text></svg>`;
    return "data:image/svg+xml," + encodeURIComponent(svg);
  }

  // ---------------- Showing a state ----------------

  let S = {};

  function setLayout(l) { emit("lesson-layout", l); }

  function show(view) {
    current = JSON.parse(JSON.stringify(view));
    emit("lesson", current);
  }

  function showState(name) {
    const def = S[name];
    if (!def) return false;
    stopDemo();
    const dock = def.dock || $("lp-desktop").dataset.dock;
    $("lp-desktop").dataset.dock = dock;
    setLayout({ dock, expanded: !!(def.layout && def.layout.expanded) });
    let line;
    if (def.editor) line = setEditor(def.editor[0], def.editor[1], { caret: !!def.editor[2] });
    else if (def.view.screen === "finished" || def.view.screen === "quiz") setEditor(lesson.steps.length, null);
    else setEditor(0, null);
    const view = JSON.parse(JSON.stringify(def.view));
    if (view.screen === "step" && view.step.line !== undefined && line) view.step.line = line; // the line the fake editor highlights
    emit("lesson", { screen: "hidden" }); // each picked state arrives fresh, as if just sent (so a hint on it is "new")
    show(view);
    for (const b of document.querySelectorAll("#lp-states button")) b.setAttribute("aria-pressed", String(b.dataset.state === name));
    return true;
  }

  function setTheme(theme) {
    const t = theme === "dark" || theme === "light" ? theme : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    document.documentElement.dataset.theme = t;
  }
  function setText(scale) { document.documentElement.style.fontSize = scale && scale !== 1 ? scale * 100 + "%" : ""; }
  function setDock(side) {
    const d = side === "left" ? "left" : "right";
    $("lp-desktop").dataset.dock = d;
    if (window.StrideLesson && window.StrideLesson.layout.dock !== d) setLayout({ dock: d, expanded: window.StrideLesson.layout.expanded });
  }

  // ---------------- The fake app: how the real app might react ----------------

  function fakeApp(channel, data) {
    if (channel === "lesson-layout") { $("lp-desktop").dataset.dock = data.dock; return; }
    if (channel === "lesson-rect") return;
    if (demo) { demo.user(channel, data); return; }
    const v = current;
    if (!v) return;
    if (v.screen === "step") {
      const i = v.step.number - 1;
      if (channel === "lesson-hint") {
        const level = Math.min(3, v.hints.length + 1);
        show(stepView(i, { status: v.status === "your-turn" ? "your-turn" : "stuck", line: v.step.line, hintLevel: level, canShowMe: level >= 3 || v.pace === "fast", pace: v.pace }));
      } else if (channel === "lesson-show-me" || channel === "lesson-do-for-me") {
        const forMe = channel === "lesson-do-for-me";
        show(stepView(i, { status: "showing", line: v.step.line, hintLevel: v.hints.length, doneForMe: forMe, pace: v.pace, canShowMe: v.canShowMe, marks: { [v.step.id]: "shown" } }));
        if (!forMe) later(1400, () => show(stepView(i, { status: "passed", line: v.step.line, marks: { [v.step.id]: "shown" } })));
      } else if (channel === "lesson-let-me-try") show(stepView(i, { line: v.step.line, pace: v.pace }));
      else if (channel === "lesson-pace") show({ ...v, pace: data.pace, canShowMe: data.pace === "fast" || v.hints.length >= 3 });
      else if (channel === "lesson-skip" || channel === "lesson-continue") {
        const next = Math.min(i + 1, lesson.steps.length - 1);
        setEditor(next, "", { caret: true });
        show(stepView(next, { marks: { [v.step.id]: channel === "lesson-skip" ? "skipped" : "done" } }));
      } else if (channel === "lesson-pause") show(S.paused.view);
      else if (channel === "lesson-retry") show({ ...v, status: "stride-working" });
    } else if (v.screen === "paused" && channel === "lesson-resume") showState("hint-2");
    else if (v.screen === "quiz" && channel === "lesson-quiz") {
      const q = lesson.steps[idx("style")].quiz;
      show({ ...v, picked: data.picked, answer: q.answer, explain: q.explain });
    } else if (v.screen === "quiz" && channel === "lesson-quiz-next") showState("finished");
    else if (v.screen === "question" && channel === "lesson-answer") showState(v.id === "purpose" ? "question-multi" : v.id === "contents" ? "question-look" : "estimate");
    else if (v.screen === "estimate" && channel === "lesson-choose") showState("setup");
    else if (v.screen === "picture" && channel === "lesson-picture") showState("estimate");
    else if (v.screen === "setup" && channel === "lesson-setup") showState("your-turn");
    else if (v.screen === "error" && channel === "lesson-retry") showState("building");
  }

  window.calhack = {
    send(channel, data) {
      if (channel !== "lesson-rect") log("→ " + channel + (data !== undefined ? " " + JSON.stringify(data) : ""));
      setTimeout(() => fakeApp(channel, data), 0);
    },
    on(channel, cb) { (listeners[channel] = listeners[channel] || []).push(cb); },
  };

  // ---------------- Play a whole lesson ----------------

  function stopDemo() { clearTimers(); demo = null; }

  function playLesson() {
    stopDemo();
    const marks = {};
    const scenes = [];
    let waitFor = null; // { channels, then }
    let stepHandler = null; // taps during a step (hint, show me, skip)
    const d = {
      user(channel, data) {
        if (stepHandler) { stepHandler(channel, data); return; }
        if (!waitFor || !waitFor.channels.includes(channel)) return;
        const w = waitFor;
        waitFor = null;
        clearTimers();
        w.then(channel, data);
      },
    };
    demo = d;
    const at = (ms, fn) => later(ms, () => { if (demo === d) fn(); });
    const wait = (channels, autoMs, then) => {
      waitFor = { channels, then };
      at(autoMs, () => { if (waitFor) { const w = waitFor; waitFor = null; w.then(null); } });
    };
    const next = () => { stepHandler = null; const s = scenes.shift(); if (s && demo === d) s(); else if (!s) demo = null; };

    // Build
    scenes.push(() => {
      setEditor(0, null);
      const labels = BUILD_STAGES;
      const push = (stage) => show({ screen: "building", what: lesson.title, labels, stage, time: BUILD_TIME }); // as a builder's onStage would drive it
      labels.forEach((_, i) => at(i * 650, () => push(i)));
      at(labels.length * 650, next);
    });
    // Questions
    const qs = [S.question.view, S["question-multi"].view, S["question-look"].view];
    qs.forEach((q, qi) => scenes.push(() => {
      show({ ...q, picked: qi === 1 ? [] : [] });
      if (qi === 1) at(700, () => show({ ...q, picked: [q.options[0]] }));
      if (qi === 1) at(1300, () => show({ ...q, picked: [q.options[0], q.options[1]] }));
      wait(["lesson-answer"], 2200, next);
    }));
    // Estimate
    scenes.push(() => { show(S["estimate-short"].view); wait(["lesson-choose"], 2200, next); });
    // Setup with ticks
    scenes.push(() => {
      const items = S.setup.view.items.map((x) => ({ ...x, status: "todo" }));
      const push = (ask) => show({ screen: "setup", items: items.map((x) => ({ ...x })), ...(ask ? { ask: S["setup-ask"].view.ask } : {}) });
      [0, 1, 2].forEach((i) => {
        at(i * 700, () => { items[i].status = "running"; push(false); });
        at(i * 700 + 500, () => { items[i].status = "done"; push(false); });
      });
      at(2200, () => { push(true); wait(["lesson-setup"], 2000, () => { items[3].status = "done"; push(false); at(600, next); }); });
    });
    // Steps
    lesson.steps.forEach((step, i) => scenes.push(() => playStep(step, i)));
    // Quiz, then finish
    scenes.push(() => {
      const q = lesson.steps[idx("style")].quiz;
      const base = { screen: "quiz", chapterTitle: "Make it look nice", question: q.question, options: q.options, progress: progress(lesson.steps.length, marks) };
      setEditor(lesson.steps.length, null);
      show(base);
      wait(["lesson-quiz", "lesson-quiz-next"], 2000, (ch, data) => {
        if (ch === "lesson-quiz-next") return next();
        show({ ...base, picked: data ? data.picked : q.answer, answer: q.answer, explain: q.explain });
        wait(["lesson-quiz-next"], 2200, next);
      });
    });
    scenes.push(() => {
      const L = learnerSteps();
      const count = (m) => L.filter((s) => marks[s.id] === m).length;
      show({ ...S.finished.view, alone: count("done"), hinted: count("hinted"), shown: count("shown"), skipped: count("skipped"), minutes: 22 });
      demo = null;
    });

    // One step: type it (with a slip on some steps), the look, the cheer.
    function playStep(step, i) {
      const mk = () => ({ ...marks });
      if (step.who === "stride") {
        show(stepView(i, { status: "stride-working", marks: mk() }));
        at(1200, () => { marks[step.id] = "done"; show(stepView(i, { status: "passed", marks: mk() })); at(1300, next); });
        return;
      }
      const line = setEditor(i, "", { caret: true });
      const base = { line, marks: mk() };
      show(stepView(i, base));
      const code = step.expected;
      const slip = step.id === "hobbies";
      const typed = slip ? typo(code) : code;
      const typeOut = (text, from, ms, done) => {
        const stepsN = 8;
        for (let k = 1; k <= stepsN; k++) {
          at(from + (ms / stepsN) * k, () => {
            setEditor(i, text.slice(0, Math.round((text.length * k) / stepsN)), { caret: true });
            if (k === 1) show(stepView(i, { ...base, status: "typing", hintLevel: hintLevel }));
          });
        }
        at(from + ms + 50, done);
      };
      let hintLevel = 0;
      const pass = () => {
        show(stepView(i, { ...base, status: "checking", hintLevel }));
        at(600, () => {
          marks[step.id] = marks[step.id] === "shown" ? "shown" : hintLevel > 0 ? "hinted" : "done";
          show(stepView(i, { ...base, status: "passed", hintLevel, marks: mk() }));
          at(1500, next);
        });
      };
      // The demo waits for the student on hints and Show me, like the real thing.
      stepHandler = (channel) => {
        if (channel === "lesson-hint" && hintLevel < 3) { hintLevel += 1; show(stepView(i, { ...base, status: "stuck", hintLevel, canShowMe: hintLevel >= 3 })); }
        else if (channel === "lesson-show-me") { clearTimers(); marks[step.id] = "shown"; show(stepView(i, { ...base, status: "showing", hintLevel, marks: mk() })); typeOut(code, 0, 900, pass); }
        else if (channel === "lesson-skip") { clearTimers(); marks[step.id] = "skipped"; next(); }
      };
      if (step.id === "intro") {
        // Typed half: on the right track, then the rest.
        typeOut(half(code), 600, 900, () => {
          show(stepView(i, { ...base, status: "checking" }));
          at(500, () => {
            show(stepView(i, { ...base, status: "partial", note: "Your big heading is there. Now add a short paragraph under it." }));
            at(1200, () => typeOut(code, 0, 800, pass));
          });
        });
      } else if (slip) {
        typeOut(typed, 600, 1400, () => {
          show(stepView(i, { ...base, status: "checking" }));
          at(600, () => {
            show(stepView(i, { ...base, status: "stuck", note: "One of the list items isn't closed yet." }));
            at(1400, () => { hintLevel = 1; show(stepView(i, { ...base, status: "stuck", hintLevel })); });
            at(3000, () => typeOut(code, 0, 600, pass));
          });
        });
      } else {
        typeOut(typed, 600, 1200, pass);
      }
    }

    next();
  }

  // ---------------- Controls ----------------

  function controls() {
    const btn = (label, fn, attrs = {}) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v);
      b.addEventListener("click", fn);
      return b;
    };
    const states = $("lp-states");
    for (const name of Object.keys(S)) states.append(btn(name, () => { showState(name); location.hash = name; }, { "data-state": name, "aria-pressed": "false" }));
    const row = $("lp-view");
    // A row of buttons where one is on at a time.
    const group = (labels, fn) => {
      const bs = labels.map(([label, value]) => btn(label, () => fn(value), { "aria-pressed": "false" }));
      bs.forEach((b) => b.addEventListener("click", () => bs.forEach((x) => x.setAttribute("aria-pressed", String(x === b)))));
      return bs;
    };
    row.append(btn("▶ Play a whole lesson", playLesson, { class: "play" }), btn("■ Stop", stopDemo));
    row.append(...group([["Auto", "auto"], ["Light", "light"], ["Dark", "dark"]], setTheme));
    row.append(...group([["Text 1x", 1], ["Text 1.5x", 1.5], ["Text 2x", 2]], (v) => setText(Number(v))));
    row.append(...group([["Card right", "right"], ["Card left", "left"]], setDock));
    row.append(btn("Reduce motion: use your system setting", () => {}, { disabled: "true" }));
  }

  // ---------------- Start ----------------

  const ready = (async () => {
    try {
      const res = await fetch(FIXTURE);
      if (!res.ok) throw new Error("HTTP " + res.status);
      lesson = await res.json();
    } catch (e) {
      const msg = $("lp-msg");
      if (msg) msg.textContent = "Couldn't read the lesson fixture. Open this page through npm run learn:preview (" + (e && e.message) + ").";
      throw e;
    }
    S = catalog();
    if (document.readyState === "loading") await new Promise((r) => document.addEventListener("DOMContentLoaded", r, { once: true }));
    if (params.has("shot")) document.documentElement.classList.add("shot");
    if (params.has("still")) document.documentElement.classList.add("still");
    setTheme(params.get("theme") || "auto");
    setText(Number(params.get("text")) || 1);
    // The side the student last put the card on (lesson.js remembers it), unless the address says otherwise.
    setDock(params.get("dock") || (window.StrideLesson ? window.StrideLesson.layout.dock : "right"));
    controls();
    const start = decodeURIComponent(location.hash.slice(1));
    if (params.has("play")) playLesson();
    else showState(S[start] ? start : "your-turn");
    return true;
  })();

  window.lessonPreview = {
    ready,
    get states() { return Object.keys(S); },
    state(name) { return S[name]; },
    show: showState,
    setTheme,
    setText,
    setDock,
    play: playLesson,
    stop: stopDemo,
  };
})();
