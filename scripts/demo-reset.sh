#!/bin/bash
# Undoes the demo scripts: removes the fake Office_Printer and puts the sound back how it was.
# Never touches any other printer.
set -uo pipefail

QUEUE="Office_Printer"
SAVE="/tmp/calhack-demo-sound-$(id -u).txt"

if lpstat -p "$QUEUE" >/dev/null 2>&1; then
  cancel -a "$QUEUE" 2>/dev/null || true
  lpadmin -x "$QUEUE"
  echo "Removed the demo printer $QUEUE."
else
  echo "No demo printer to remove."
fi

if [ -f "$SAVE" ]; then
  # Saved line looks like: output volume:13, input volume:50, alert volume:48, output muted:false
  VOL=$(sed -n 's/.*output volume:\([0-9][0-9]*\).*/\1/p' "$SAVE")
  MUTED=$(sed -n 's/.*output muted:\([a-z]*\).*/\1/p' "$SAVE")
  if [ -n "$VOL" ]; then osascript -e "set volume output volume $VOL"; fi
  if [ "$MUTED" = "true" ]; then
    osascript -e 'set volume with output muted'
  else
    osascript -e 'set volume without output muted'
  fi
  rm -f "$SAVE"
  echo "Put the sound back: $(osascript -e 'get volume settings')"
else
  # Nothing saved: just make sure sound is on.
  osascript -e 'set volume without output muted'
  echo "Sound is on: $(osascript -e 'get volume settings')"
fi
