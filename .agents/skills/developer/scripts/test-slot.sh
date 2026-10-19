#!/usr/bin/env bash
# Runs a heavy command in one of TEST_SLOTS machine-wide slots; each slot after the first opens only with TEST_SLOT_EXTRA_FREE_MB free.
budget="$(dirname "$0")/../../../machine.env"
[ -f "$budget" ] && . "$budget"
slots=${TEST_SLOTS:-2} extra_free=${TEST_SLOT_EXTRA_FREE_MB:-3500} poll=${TEST_SLOT_POLL_SECONDS:-10}
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
