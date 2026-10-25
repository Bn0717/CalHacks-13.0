// Scam messages: CalHack refuses to act on them, and keeps refusing even if the person asks again.
// The AI reads the message, but the decision doesn't rest on it alone: code checks the steps for signs no real clinic,
// bank or company ever asks for, and once a message is a scam every action is blocked for the rest of the run.

import { loadEnv } from "../ai/client.js";

export interface ScamVerdict {
  /** Plain reasons, e.g. "It asks you to pay with a gift card". */
  reasons: string[];
}

/** Signs that on their own make a message a scam. */
const STRONG: { re: RegExp; reason: string }[] = [
  { re: /gift ?cards?/i, reason: "It asks you to pay with a gift card. Real offices never take gift cards." },
  { re: /\b(turn|switch|shut)\s+off\s+(your\s+|the\s+)?(anti-?virus|virus protection|firewall|security)|disable\s+(your\s+|the\s+)?(anti-?virus|firewall|security)/i, reason: "It tells you to turn off your antivirus, so harmful software isn't blocked." },
  { re: /remote\s+(control|access|desktop)/i, reason: "It asks you to let someone control your computer remotely." },
  { re: /\.(exe|msi|scr|bat|cmd|apk|pkg\.exe)\b/i, reason: "It asks you to download and run a program from a website that isn't the maker's." },
  { re: /\b(wire transfer|western union|moneygram|bitcoin|crypto(currency)?|zelle|venmo)\b/i, reason: "It asks for payment in a way that can't be undone." },
  { re: /reply\s+with\s+(the\s+)?(gift\s+card\s+)?(code|number|pin)/i, reason: "It asks you to send a payment code by email." },
  { re: /\b(social security|ssn)\b.{0,40}\b(verify|confirm|enter)\b|\b(verify|confirm|enter)\b.{0,40}\b(social security|ssn)\b/i, reason: "It asks for your Social Security number." },
];

/** Signs that count only together (two or more). */
const WEAK: { re: RegExp; reason: string }[] = [
  { re: /cancel+ed\s+automatically|will\s+be\s+(cancel+ed|suspended|closed)\s+unless|within\s+\d+\s+(hours?|minutes?)/i, reason: "It threatens to cancel unless you act within hours." },
  { re: /do\s+not\s+call\s+(the\s+|our\s+)?(main\s+)?office|don'?t\s+call\s+(the\s+|our\s+)?(main\s+)?office/i, reason: "It tells you not to call the office, so you can't check with them." },
  { re: /verify\s+your\s+identity/i, reason: "It asks you to \"verify your identity\" through a link." },
  { re: /(date of birth|insurance (id|number)).{0,60}(required|verify)|(required|verify).{0,60}(date of birth|insurance (id|number))/i, reason: "It asks for your date of birth and insurance ID through a link." },
  { re: /you\s+(also\s+)?owe\s+\$?\d+/i, reason: "It says you owe money and asks you to pay through the message." },
];

/** The scam signs in a message's text (the steps the AI read from it), or null when there are none that count. */
export function scamSigns(text: string): ScamVerdict | null {
  const strong = STRONG.filter((s) => s.re.test(text)).map((s) => s.reason);
  const weak = WEAK.filter((s) => s.re.test(text)).map((s) => s.reason);
  if (strong.length || weak.length >= 2) return { reasons: [...strong, ...weak] };
  return null;
}

/** Addresses the person set up as trusted (CALHACK_TRUSTED_SENDERS, comma-separated): their sender is never questioned. */
export function trustedSenders(): string[] {
  loadEnv();
  return (process.env.CALHACK_TRUSTED_SENDERS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
}

/** A warning that's only about who sent the message, when that sender is trusted: dropped. Content warnings stay. */
export function keepWarning(warning: string): boolean {
  if (!warning) return false;
  const trusted = trustedSenders();
  if (!trusted.some((t) => warning.toLowerCase().includes(t))) return true;
  return !!scamSigns(warning);
}

/** What the person sees when CalHack refuses. Same words every time, however they ask. */
export function refusal(reasons: string[]): { title: string; paragraphs: string[]; steps: string[] } {
  return {
    title: "This is a scam. I can't do these steps.",
    paragraphs: ["This message has signs of a scam, so I won't do anything it asks, even if you ask me to.", ...reasons.slice(0, 5)],
    steps: [
      "Don't click its links, download anything, or pay.",
      "If you're worried about your appointment, call your clinic on the number from their official website or your appointment card, not the number in this message.",
      "You can delete the message.",
    ],
  };
}
