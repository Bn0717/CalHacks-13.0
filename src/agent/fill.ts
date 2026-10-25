// Filling in a form for the person, with details they were given (for example a clinic's email: name, appointment number).
// The agent passes those details in; the screen pilots may type only those exact values, and our code checks every one.
//  - Secrets never go in: passwords, codes, card numbers, social security and insurance numbers are dropped here,
//    whatever the AI passed, and stay the person's to type.
//  - On a page we can vouch for a little (an https address, or this Mac's own demo server, that isn't a link shortener,
//    file share or raw IP address) it just goes ahead. Any other page: the person is asked once per site and decides.
//  - The final Submit (or Send, Confirm, Check in…) stays the person's, so they see what goes out.
import { isSuspiciousHost } from "../core/trusted.js";
import type { ToolContext } from "./tools.js";

export interface Fact {
  /** What the detail is, e.g. "Name" or "Appointment number". */
  label: string;
  /** The exact value to type, e.g. "Linda" or "BV-48213". */
  value: string;
}

export const SECRET_LABEL = /pass(word|code|phrase)?\b|\bpin\b|one.?time|verification code|security (code|question)|\bcvv\b|\bcvc\b|card|credit|debit|bank|account number|routing|\bssn\b|social security|insurance|member id|policy number|medicare|medicaid|driver'?s? licen[cs]e|passport|tax id/i;

/** Values that look like a secret whatever their label says: card numbers, SSNs. */
function secretValue(v: string): boolean {
  const digits = v.replace(/[\s-]/g, "");
  if (/^\d{13,19}$/.test(digits)) return true; // card number
  if (/^\d{3}-?\d{2}-?\d{4}$/.test(v.trim())) return true; // social security number
  return false;
}

/** The details CalHack may type, cleaned: no secrets, no control characters, short, at most 12. */
export function safeFacts(raw: unknown): Fact[] {
  if (!Array.isArray(raw)) return [];
  const out: Fact[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const label = typeof (x as Fact).label === "string" ? (x as Fact).label.trim().slice(0, 60) : "";
    const value = typeof (x as Fact).value === "string" ? (x as Fact).value.trim() : "";
    if (!label || !value || value.length > 100 || /[\u0000-\u001f\u007f]/.test(value)) continue;
    if (SECRET_LABEL.test(label) || secretValue(value)) continue;
    if (!out.some((f) => f.value === value)) out.push({ label, value });
  }
  return out.slice(0, 12);
}

/** The detail this text is, or null. Only an exact value (ignoring case and outer spaces) counts. */
export function matchFact(text: string | undefined, facts: Fact[]): Fact | null {
  const t = (text ?? "").trim().toLowerCase();
  if (!t) return null;
  return facts.find((f) => f.value.toLowerCase() === t) ?? null;
}

/** The details as lines for the AI. */
export function describeFacts(facts: Fact[]): string {
  return facts.map((f) => `- ${f.label}: ${f.value}`).join("\n");
}

/** Why CalHack won't type the person's details on this page, or null when it may. */
export function formPageProblem(url: string | null | undefined): string | null {
  if (!url) return "I can't tell which website this form is on";
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "I can't tell which website this form is on";
  }
  const host = u.hostname.toLowerCase();
  const local = host === "localhost" || host === "127.0.0.1";
  if (u.protocol !== "https:" && !(local && u.protocol === "http:")) return "This page isn't a secure (https) page";
  if (!local && isSuspiciousHost(host)) return `This page is on ${host}, a kind of address often used to hide scams`;
  return null;
}

/**
 * May CalHack type the person's details on this page? Fine pages: yes. A doubtful page (not https, a scam-prone address,
 * or one we can't read): the person is asked, once per site, and decides. Returns null when it may, or why not.
 */
export async function fillConsent(ctx: ToolContext, url: string | null | undefined): Promise<string | null> {
  const problem = formPageProblem(url);
  if (!problem) return null;
  let site = "this page";
  try {
    if (url) site = new URL(url).hostname;
  } catch {
    // keep "this page"
  }
  ctx.formOkSites ??= new Set();
  if (ctx.formOkSites.has(site)) return null;
  const yes = await ctx.ui.confirm({
    title: "Fill in this form anyway?",
    message: `${problem}${site !== "this page" ? ` (${site})` : ""}. If you trust it, I'll type in the details from your message. I never type passwords or card numbers, and you press the final button yourself.`,
    yes: "Yes, fill it in",
    no: "No, I'll do it",
    tone: "danger",
  });
  if (!yes) return `${problem}, and you chose to fill it in yourself`;
  ctx.formOkSites.add(site);
  return null;
}

/** A button that sends the form off. Pressing it stays the person's once details were typed. */
export const SUBMIT_LIKE = /submit|send|check.?in|confirm|continue|next|done|finish|book|save|sign|register|complete|agree|pay|place/i;
