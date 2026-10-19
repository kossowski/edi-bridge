#!/usr/bin/env bash
# Stops what a developer or a check left running from one worktree, from a ticket's worktrees
# ../<repo>-worktrees/<NN>-*, or from the whole worktrees folder: dev servers, Storybook, vitest
# browser runs and their Chromium. Matches on the working directory of each process, spares this
# shell and its parents, and prints what it stopped.
#
# Usage: scripts/stop-leftovers.sh [<worktree> | <NN>]
set -uo pipefail
project="$(dirname "$0")/../../../project.env"
[ -f "$project" ] && . "$project"
main=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
wts=$main/../$(basename "$main")-worktrees
if [[ ${1:-} =~ ^[0-9]+$ ]]; then
  dirs=()
  for d in "$wts/$1"-*; do [[ -d $d ]] && dirs+=("$(realpath -m "$d")"); done
  ((${#dirs[@]})) || { echo "no worktrees $(realpath -m "$wts")/$1-*"; exit 0; }
else
  dirs=("$(realpath -m "${1:-$wts}")")
fi

skip=" $$ "; p=$PPID
while [[ $p -gt 1 ]]; do
  skip+="$p "
  p=$(awk '/^PPid:/{print $2}' "/proc/$p/status" 2>/dev/null || echo 1)
done

pids=()
for d in /proc/[0-9]*; do
  pid=${d#/proc/}
  [[ $skip == *" $pid "* ]] && continue
  cwd=$(readlink "$d/cwd" 2>/dev/null) || continue
  for dir in "${dirs[@]}"; do
    if [[ $cwd == "$dir" || $cwd == "$dir"/* ]]; then pids+=("$pid"); break; fi
  done
done

if ((${#pids[@]} == 0)); then
  echo "nothing running under ${dirs[*]}"
else
  for pid in "${pids[@]}"; do
    echo "stopping $pid: $(tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null | cut -c1-100) in $(readlink "/proc/$pid/cwd" 2>/dev/null)"
  done
  kill "${pids[@]}" 2>/dev/null
  sleep 3
  alive=()
  for pid in "${pids[@]}"; do [[ -d /proc/$pid ]] && alive+=("$pid"); done
  ((${#alive[@]})) && kill -9 "${alive[@]}" 2>/dev/null
  echo "stopped ${#pids[@]} process(es)"
fi

for port in ${DEV_PORTS:-}; do
  holder=$(ss -ltnpH "sport = :$port" 2>/dev/null | grep -o 'pid=[0-9]*' | head -1)
  [[ -n $holder ]] && echo "port $port is still held by pid ${holder#pid=}, which runs outside ${dirs[*]}"
done
exit 0
