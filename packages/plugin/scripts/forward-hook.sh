#!/bin/bash
# Forwards Claude Code hook events to all running Golem instances.
# Reads event JSON from stdin, POSTs to each registered instance.

INSTANCE_DIR="$HOME/.golem/instances"

# No instances directory or empty — nothing to do (fast path)
[ -d "$INSTANCE_DIR" ] || exit 0
files=("$INSTANCE_DIR"/*)
[ -e "${files[0]}" ] || exit 0

INPUT=$(cat)

for f in "${files[@]}"; do
  [ -f "$f" ] || continue
  PORT=$(cat "$f")
  # Very short connect timeout to avoid blocking Claude on stale instances.
  # Failed curls are silent and non-blocking (backgrounded).
  curl -s -X POST "http://localhost:$PORT/hook" \
    -H "Content-Type: application/json" \
    -d "$INPUT" \
    --connect-timeout 0.2 \
    -o /dev/null 2>/dev/null &
done

wait
exit 0
