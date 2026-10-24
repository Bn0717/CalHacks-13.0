#!/bin/bash
# Stages a "printer won't print" problem for the demo: a fake printer, paused, with 3 stuck jobs.
# Safe and reversible: it only adds a new printer called Office_Printer. Undo with scripts/demo-reset.sh.
set -euo pipefail

QUEUE="Office_Printer"
# 192.0.2.x is a test address that never answers, so jobs just wait.
ADDRESS="socket://192.0.2.10:9100"
GENERIC_PPD="/System/Library/Frameworks/ApplicationServices.framework/Versions/A/Frameworks/PrintCore.framework/Versions/A/Resources/Generic.ppd"

if lpstat -p "$QUEUE" >/dev/null 2>&1; then
  echo "Removing the old $QUEUE first."
  lpadmin -x "$QUEUE"
fi

if [ -f "$GENERIC_PPD" ]; then
  lpadmin -p "$QUEUE" -D "Office Printer" -L "Office" -v "$ADDRESS" -P "$GENERIC_PPD" -E
else
  # Fallback: the generic PostScript driver that ships with CUPS.
  lpadmin -p "$QUEUE" -D "Office Printer" -L "Office" -v "$ADDRESS" -m drv:///sample.drv/generic.ppd -E
fi
echo "Added printer $QUEUE (\"Office Printer\") pointing at $ADDRESS."

# Right after adding a printer the Mac sometimes says no once, so try a few times.
for try in 1 2 3 4 5; do
  if cupsdisable -r "Paused" "$QUEUE" 2>/dev/null; then break; fi
  if [ "$try" = 5 ]; then echo "Couldn't pause $QUEUE." >&2; exit 1; fi
  sleep 1
done
echo "Paused $QUEUE."

for i in 1 2 3; do
  lp -d "$QUEUE" -t "Demo page $i" /etc/hosts >/dev/null
done
echo "Queued 3 small print jobs."
echo
LC_ALL=C lpstat -p "$QUEUE"
LC_ALL=C lpstat -o "$QUEUE"
echo
echo "Done. Run scripts/demo-reset.sh to undo."
