// Adding an event to Apple Calendar, with an alert, and reading it back as proof.
// The event's text is never put inside the script: it goes to osascript as separate arguments (argv), so a title like
// `" & do shell script "…` is just a title. Dates are checked numbers. macOS asks once to let CalHack use Calendar.

export interface CalendarEvent {
  title: string;
  /** Local time on this Mac. */
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  durationMinutes: number;
  /** 0 = no alert. */
  alertMinutesBefore: number;
  notes: string;
  url: string;
}

function shq(text: string): string {
  return "'" + text.replace(/'/g, "'\\''") + "'";
}

/** Text that's safe as one argument: no control characters except new lines, no leading dash (osascript would read it as an option). */
function clean(text: string, max: number): string {
  return text.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").replace(/^[-\s]+/, "").trim().slice(0, max);
}

/**
 * The event, checked, or a sentence saying what's wrong. `start` is "YYYY-MM-DDTHH:MM" in the Mac's local time.
 * A time that has already passed is refused (most likely a wrong guess at the year or the date).
 */
export function parseEvent(
  input: { title: string; start: string; durationMinutes: number | null; alertMinutesBefore: number | null; notes: string; url: string },
  now: number,
): CalendarEvent | { problem: string } {
  const title = clean(input.title, 120);
  if (!title) return { problem: "The event needs a title." };
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(input.start.trim());
  if (!m) return { problem: 'The start time must look like "2026-10-26T10:00".' };
  const [year, month, day, hour, minute] = m.slice(1).map(Number);
  const when = new Date(year, month - 1, day, hour, minute);
  if (when.getFullYear() !== year || when.getMonth() !== month - 1 || when.getDate() !== day || hour > 23 || minute > 59) return { problem: "That date doesn't exist." };
  if (when.getTime() < now - 60_000) return { problem: "That time has already passed. Check the date and year." };
  if (when.getTime() > now + 2 * 365 * 86_400_000) return { problem: "That date is more than two years away. Check the year." };
  const durationMinutes = input.durationMinutes ?? 30;
  if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 24 * 60) return { problem: "The length must be between 5 minutes and a day." };
  const alertMinutesBefore = input.alertMinutesBefore ?? 0;
  if (!Number.isInteger(alertMinutesBefore) || alertMinutesBefore < 0 || alertMinutesBefore > 7 * 24 * 60) return { problem: "The alert must be between 0 minutes and a week before." };
  let url = "";
  if (input.url.trim()) {
    try {
      const u = new URL(input.url.trim());
      if (u.protocol !== "https:" || u.username || u.password) return { problem: "The link must be an https link." };
      url = u.href;
    } catch {
      return { problem: "The link isn't a valid web address." };
    }
  }
  return { title, year, month, day, hour, minute, durationMinutes, alertMinutesBefore, notes: clean(input.notes, 1000), url };
}

/** Builds the date `s` from argv items 2-6 (year, month, day, hour, minute), safely (day 1 first, so no month overflow). */
const DATE_FROM_ARGV = [
  "set s to current date",
  "set day of s to 1",
  "set year of s to (item 2 of argv as integer)",
  "set month of s to (item 3 of argv as integer)",
  "set day of s to (item 4 of argv as integer)",
  "set time of s to ((item 5 of argv as integer) * 3600 + (item 6 of argv as integer) * 60)",
];

const ADD_SCRIPT = [
  "on run argv",
  "set t to item 1 of argv",
  ...DATE_FROM_ARGV,
  "set e to s + ((item 7 of argv as integer) * 60)",
  "set alertMin to (item 8 of argv as integer)",
  "set notesText to item 9 of argv",
  "set linkText to item 10 of argv",
  'tell application "Calendar"',
  "set cal to missing value",
  "repeat with c in calendars",
  "if writable of c then",
  "set cal to c",
  "exit repeat",
  "end if",
  "end repeat",
  'if cal is missing value then error "There is no calendar to add to."',
  "if (count of (every event of cal whose summary is t and start date is s)) > 0 then return \"exists|\" & (name of cal)",
  "set ev to make new event at end of events of cal with properties {summary:t, start date:s, end date:e, description:notesText}",
  'if linkText is not "" then set url of ev to linkText',
  "if alertMin > 0 then",
  "tell ev to make new display alarm at end of display alarms with properties {trigger interval:(0 - alertMin)}",
  "end if",
  'return "added|" & (name of cal)',
  "end tell",
  "end run",
].join("\n");

const FIND_SCRIPT = [
  "on run argv",
  "set t to item 1 of argv",
  ...DATE_FROM_ARGV,
  'tell application "Calendar"',
  "repeat with c in calendars",
  "set found to (every event of c whose summary is t and start date is s)",
  "if (count of found) > 0 then",
  'set a to ""',
  "try",
  "set a to (trigger interval of display alarm 1 of (item 1 of found)) as text",
  "end try",
  'return "found|" & (name of c) & "|" & a',
  "end if",
  "end repeat",
  "end tell",
  'return "missing"',
  "end run",
].join("\n");

function dateArgs(e: CalendarEvent): string[] {
  return [e.title, String(e.year), String(e.month), String(e.day), String(e.hour), String(e.minute)];
}

/** The command that adds the event (or says it's already there). Prints "added|<calendar>" or "exists|<calendar>". */
export function addEventCommand(e: CalendarEvent): string {
  const args = [...dateArgs(e), String(e.durationMinutes), String(e.alertMinutesBefore), e.notes, e.url];
  return `osascript -e ${shq(ADD_SCRIPT)} ${args.map(shq).join(" ")}`;
}

/** The command that looks the event up. Prints "found|<calendar>|<alert trigger in minutes, negative>" or "missing". */
export function findEventCommand(e: CalendarEvent): string {
  return `osascript -e ${shq(FIND_SCRIPT)} ${dateArgs(e).map(shq).join(" ")}`;
}

export function parseFound(output: string): { found: false } | { found: true; calendar: string; alertMinutesBefore: number | null } {
  const line = output.trim().split("\n").pop() ?? "";
  const m = /^found\|(.*)\|(-?\d+)?$/.exec(line);
  if (!m) return { found: false };
  return { found: true, calendar: m[1], alertMinutesBefore: m[2] ? Math.abs(Number(m[2])) : null };
}

/** "Mon, Oct 26 at 10:00 AM" in the Mac's own language settings. */
export function whenLabel(e: CalendarEvent): string {
  const d = new Date(e.year, e.month - 1, e.day, e.hour, e.minute);
  return `${d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} at ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}
