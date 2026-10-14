#!/usr/bin/env bash
# Runs a heavy command in one of two machine-wide slots: the second opens only with 4.5 GB free.
while :; do
  flock -n -E 200 ~/.agents/test.lock "$@"; rc=$?
  [ $rc -ne 200 ] && exit $rc
  avail=$(free -m | awk '/^Mem:/{print $7}')
  if [ "$avail" -gt 4500 ]; then
    flock -n -E 200 ~/.agents/test.lock.2 "$@"; rc=$?
    [ $rc -ne 200 ] && exit $rc
  fi
  sleep 10
done
