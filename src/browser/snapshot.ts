// What CalHack sees on a web page: its visible text, and every field, button and link it can act on, by name.
// Runs inside the page (as plain JavaScript, so it needs no DOM types here). Each item gets a data-calhack-ref
// attribute, so the next action finds exactly that element.

export interface PageItem {
  /** "r7": stays on the element while the page lives. */
  ref: string;
  /** input type, or select / textarea / button / link / checkbox / radio / editable. */
  kind: string;
  /** The words a person would use for it: its label, aria-label, placeholder or nearby text. */
  label: string;
  name?: string;
  value?: string;
  checked?: boolean;
  required?: boolean;
  disabled?: boolean;
  /** For selects and radio groups: the choices. */
  options?: string[];
  /** The browser's own message when the field is invalid (only after something was typed or the form was sent). */
  invalid?: string;
  /** A field only the person fills: passwords, codes, card and bank numbers, ID numbers. Code decides this. */
  private?: string;
  /** A button that pays or buys. Only the person presses it. */
  payment?: boolean;
  /** Sends a form (a submit button, or the form's only button). */
  submit?: boolean;
  autocomplete?: string;
}

export interface PageSnapshot {
  url: string;
  title: string;
  /** Visible text, trimmed. */
  text: string;
  items: PageItem[];
  /** Error or alert messages visible on the page. */
  alerts: string[];
}

/** Words that mark a field as private, in its label, name, id or autocomplete. Checked in code, whatever the AI says. */
export const PRIVATE_FIELD =
  /pass(word|code|phrase)|\bpin\b|one.?time|verification code|security code|\bcvc\b|\bcvv\b|card.?(number|no)|credit.?card|debit.?card|expir|\biban\b|routing|account.?(number|no)|sort.?code|\bssn\b|social security|passport|driver'?s? licen[cs]e|tax.?id/i;
/** Buttons that spend money. */
export const PAYMENT_BUTTON = /\b(pay|buy|purchase|place (your )?order|checkout|check out|subscribe|donate|complete (purchase|payment))\b/i;

export const SNAPSHOT_JS = `(() => {
  const PRIVATE = ${PRIVATE_FIELD.toString()};
  const PAY = ${PAYMENT_BUTTON.toString()};
  const clean = (s) => (s || "").replace(/\\s+/g, " ").trim();
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none" && !el.closest("[hidden],[aria-hidden=true]");
  };
  const textOf = (id) => { const n = document.getElementById(id); return n ? clean(n.innerText || n.textContent) : ""; };
  const labelOf = (el) => {
    const parts = [];
    const al = el.getAttribute("aria-labelledby");
    if (al) parts.push(al.split(/\\s+/).map(textOf).join(" "));
    if (el.getAttribute("aria-label")) parts.push(el.getAttribute("aria-label"));
    if (el.labels && el.labels.length) parts.push([...el.labels].map((l) => clean(l.innerText)).join(" "));
    if (!parts.join("").trim()) {
      const wrap = el.closest("label");
      if (wrap) parts.push(clean(wrap.innerText));
    }
    if (el.placeholder) parts.push("(" + el.placeholder + ")");
    if (!parts.join("").trim() && (el.tagName === "BUTTON" || el.tagName === "A" || el.getAttribute("role"))) parts.push(clean(el.innerText || el.value));
    if (!parts.join("").trim() && el.type === "submit") parts.push(el.value || "Submit");
    if (!parts.join("").trim() && el.title) parts.push(el.title);
    if (!parts.join("").trim()) {
      // Text just before the field (a heading or a bare text node).
      let p = el.previousElementSibling;
      if (p) parts.push(clean(p.innerText));
    }
    return clean(parts.join(" ")).slice(0, 120);
  };
  const sel = "input, textarea, select, button, a[href], [role=button], [role=link], [role=checkbox], [role=radio], [role=switch], [role=combobox], [role=textbox], [contenteditable=true]";
  const items = [];
  for (const el of document.querySelectorAll(sel)) {
    if (el.type === "hidden" || !visible(el)) continue;
    const ref = el.getAttribute("data-calhack-ref") || "r" + (window.__calhackN = (window.__calhackN || 0) + 1);
    el.setAttribute("data-calhack-ref", ref);
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute("role");
    let kind = tag === "input" ? (el.type || "text") : tag === "a" ? "link" : el.isContentEditable && tag !== "textarea" ? "editable" : tag;
    if (role && tag !== "input" && tag !== "select" && tag !== "textarea") kind = role;
    const item = { ref, kind, label: labelOf(el) };
    if (el.name) item.name = el.name;
    const ac = el.getAttribute("autocomplete");
    if (ac) item.autocomplete = ac;
    if (el.required || el.getAttribute("aria-required") === "true") item.required = true;
    if (el.disabled || el.getAttribute("aria-disabled") === "true") item.disabled = true;
    if (kind === "checkbox" || kind === "radio" || kind === "switch") item.checked = el.checked === true || el.getAttribute("aria-checked") === "true";
    else if (tag === "select") {
      item.options = [...el.options].map((o) => clean(o.text)).slice(0, 60);
      item.value = el.selectedIndex >= 0 ? clean(el.options[el.selectedIndex].text) : "";
    } else if (tag === "input" || tag === "textarea") item.value = el.type === "password" ? (el.value ? "(filled)" : "") : String(el.value || "").slice(0, 200);
    else if (kind === "editable" || kind === "textbox") item.value = clean(el.innerText).slice(0, 200);
    if ((tag === "input" || tag === "textarea" || tag === "select") && el.willValidate && !el.validity.valid && (el.value || el.form && el.form.dataset.calhackSent)) item.invalid = el.validationMessage;
    if (el.getAttribute("aria-invalid") === "true") item.invalid = item.invalid || (el.getAttribute("aria-errormessage") && textOf(el.getAttribute("aria-errormessage"))) || "marked invalid";
    const words = [item.label, el.name, el.id, ac].filter(Boolean).join(" ");
    if (el.type === "password") item.private = "a password";
    else if (/^(cc-|current-password|new-password|one-time-code)/.test(ac || "")) item.private = "card or sign-in details";
    else if ((tag === "input" || tag === "textarea" || kind === "editable") && PRIVATE.test(words)) item.private = "private details";
    const isButton = tag === "button" || kind === "submit" || kind === "button" || role === "button";
    if (isButton && PAY.test(item.label)) item.payment = true;
    if (isButton && el.form && (el.type === "submit" || (tag === "button" && !el.getAttribute("type")))) item.submit = true;
    // Radios: list the group's choices on each one.
    if (kind === "radio" && el.name) item.options = [...document.querySelectorAll('input[type=radio][name="' + CSS.escape(el.name) + '"]')].map(labelOf);
    items.push(item);
    if (items.length >= 150) break;
  }
  const alerts = [...document.querySelectorAll("[role=alert], [aria-live=assertive], .error, .errors, .alert, .invalid-feedback, .field-error")]
    .filter(visible).map((e) => clean(e.innerText)).filter(Boolean).slice(0, 10);
  return { url: location.href, title: document.title, text: clean(document.body ? document.body.innerText : "").slice(0, 6000), items, alerts };
})()`;

/** The page as numbered lines for the AI. */
export function describePage(p: PageSnapshot): string {
  const lines = p.items.map((i) => {
    const bits = [`${i.ref} ${i.kind} "${i.label || "(no label)"}"`];
    if (i.name) bits.push(`name=${i.name}`);
    if (i.value !== undefined && i.value !== "") bits.push(`value="${i.value}"`);
    if (i.checked !== undefined) bits.push(i.checked ? "checked" : "unchecked");
    if (i.options?.length) bits.push(`choices: ${i.options.map((o) => `"${o}"`).join(", ")}`);
    if (i.required) bits.push("required");
    if (i.disabled) bits.push("disabled");
    if (i.invalid) bits.push(`INVALID: ${i.invalid}`);
    if (i.private) bits.push(`PRIVATE (${i.private}): the person fills this`);
    if (i.payment) bits.push("PAYMENT: only the person presses this");
    if (i.submit) bits.push("sends the form");
    return bits.join(" · ");
  });
  return [
    `Address: ${p.url}`,
    `Title: ${p.title}`,
    p.alerts.length ? `Messages on the page: ${p.alerts.join(" | ")}` : "",
    `<page_text>\n${p.text}\n</page_text>`,
    `Things you can act on:\n${lines.join("\n") || "(none)"}`,
  ].filter(Boolean).join("\n\n");
}
