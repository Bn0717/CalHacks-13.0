// The person's own contact card ("My Card" in Contacts): their name, phone, email, birthday and address, so CalHack can
// fill in a form for them without asking. macOS asks once to let CalHack use Contacts. Read-only; a fixed script.
import { execFile } from "node:child_process";
import type { Fact } from "../agent/fill.js";

/** Prints one "key=value" line per field of My Card, or nothing when there's no card. */
const SCRIPT = `
on clean(v)
  if v is missing value then return ""
  return v as text
end clean
tell application "Contacts"
  set c to my card
  if c is missing value then return ""
  set out to "first=" & my clean(first name of c) & linefeed & "last=" & my clean(last name of c) & linefeed
  try
    set out to out & "phone=" & my clean(value of first phone of c) & linefeed
  end try
  try
    set out to out & "email=" & my clean(value of first email of c) & linefeed
  end try
  try
    set b to birth date of c
    if b is not missing value then set out to out & "birthday=" & (year of b as integer) & "-" & text -2 thru -1 of ("0" & ((month of b) as integer)) & "-" & text -2 thru -1 of ("0" & (day of b)) & linefeed
  end try
  try
    set a to first address of c
    set out to out & "street=" & my clean(street of a) & linefeed & "city=" & my clean(city of a) & linefeed & "state=" & my clean(state of a) & linefeed & "zip=" & my clean(zip of a) & linefeed
  end try
  return out
end tell`;

/** The card's fields as details a form can use. Empty values are dropped. */
export function parseCard(output: string): Fact[] {
  const v: Record<string, string> = {};
  for (const line of output.split("\n")) {
    const m = /^(\w+)=(.*)$/.exec(line.trim());
    if (m && m[2].trim() && m[2].trim() !== "missing value") v[m[1]] = m[2].replace(/\s+/g, " ").trim();
  }
  const facts: Fact[] = [];
  const add = (label: string, value?: string) => value && facts.push({ label, value });
  add("First name", v.first);
  add("Last name", v.last);
  add("Full name", [v.first, v.last].filter(Boolean).join(" "));
  add("Phone", v.phone);
  add("Email", v.email);
  add("Date of birth", /^\d{4}-\d{2}-\d{2}$/.test(v.birthday ?? "") ? v.birthday : undefined);
  add("Street address", v.street);
  add("City", v.city);
  add("State", v.state);
  add("ZIP code", v.zip);
  return facts;
}

export function myCard(timeoutMs = 8000): Promise<Fact[]> {
  return new Promise((resolve) => {
    execFile("/usr/bin/osascript", ["-e", SCRIPT], { timeout: timeoutMs }, (err, stdout) => resolve(err ? [] : parseCard(stdout.toString())));
  });
}

/**
 * Is this card the person the message is about? Yes when the message gives no name, or when a name it gives matches the
 * card's first or full name. A forwarded email addressed to someone else ("Hi Linda") must not get the reader's details.
 */
export function cardIsThePerson(card: Fact[], messageFacts: Fact[]): boolean {
  const first = card.find((f) => f.label === "First name")?.value.toLowerCase();
  const full = card.find((f) => f.label === "Full name")?.value.toLowerCase();
  if (!first) return false;
  const names = messageFacts.filter((f) => /\bname\b/i.test(f.label)).map((f) => f.value.toLowerCase().trim());
  if (!names.length) return true;
  return names.some((n) => n === first || n === full || n.split(/\s+/)[0] === first);
}
