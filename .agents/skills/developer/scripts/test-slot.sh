#!/usr/bin/env bash
# Runs a heavy command in one of TEST_SLOTS machine-wide slots; each slot after the first opens only with TEST_SLOT_EXTRA_FREE_MB free.
# With --all, waits for and holds every slot, so no other heavy command runs beside it.
if [ $# -eq 0 ] || { [ "$1" = --all ] && [ $# -eq 1 ]; }; then
  echo "usage: test-slot.sh [--all] <command> [args...]" >&2
  exit 2
fi
budget="$(dirname "$0")/../../../machine.env"
[ -f "$budget" ] && . "$budget"
slots=${TEST_SLOTS:-2} extra_free=${TEST_SLOT_EXTRA_FREE_MB:-3500} poll=${TEST_SLOT_POLL_SECONDS:-10}
if [ "$1" = --all ]; then
  shift
  # Takes the slots in order, slot 1 first, so two --all commands never hold one slot each.
  cmd=("$@")
  for i in $(seq "$slots" -1 2); do cmd=(flock ~/.agents/test.lock."$i" "${cmd[@]}"); done
  exec flock ~/.agents/test.lock "${cmd[@]}"
fi
while :; do
  flock -n -E 200 ~/.agents/test.lock "$@"; rc=$?
  [ $rc -ne 200 ] && exit $rc
  for i in $(seq 2 "$slots"); do
    avail=$(free -m | awk '/^Mem:/{print $7}')
    [ "$avail" -gt "$extra_free" ] || break
    flock -n -E 200 ~/.agents/test.lock."$i" "$@"; rc=$?
    [ $rc -ne 200 ] && exit $rc
  done
  sleep "$poll"
done
