#!/bin/bash
# Stages an "I can't hear anything" problem for the demo: mutes the Mac.
# The old volume is saved so scripts/demo-reset.sh can put it back.
set -euo pipefail

SAVE="/tmp/calhack-demo-sound-$(id -u).txt"

# Only save once, so running this twice doesn't overwrite the real settings with the muted ones.
if [ ! -f "$SAVE" ]; then
  osascript -e 'get volume settings' > "$SAVE"
  echo "Saved the current sound settings: $(cat "$SAVE")"
fi

osascript -e 'set volume with output muted'
echo "Muted the Mac's sound."
osascript -e 'get volume settings'
echo "Done. Run scripts/demo-reset.sh to undo."
