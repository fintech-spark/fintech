#!/usr/bin/env bash
# claim.sh — atomic, expiring path leases so multiple agents can share one repository.
#
#   claim.sh acquire <scope-prefix> [--note TEXT] [--ttl SECONDS] [--owner NAME]
#   claim.sh check   <path>                 # exit 0 free, 1 held by someone else
#   claim.sh heartbeat [--ttl SECONDS]      # extend the current claim's lease
#   claim.sh release [claim-id]             # release current, or an explicit id
#   claim.sh status                         # show all live claims
#   claim.sh reap                           # drop expired claims from crashed agents
#
# Scope is a path prefix, relative to the repository root. "src/api" and
# "src/api/routes.ts" overlap; "src/api" and "src/db" do not. "*" means the whole repo
# and conflicts with everything. Leases expire so a crashed agent cannot block the repo
# forever; heartbeat long-running work.
set -euo pipefail

root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
claims="${AGENT_CLAIMS_DIR:-$root/.agents/claims}"
owner="${AGENT_OWNER:-$(hostname -s 2>/dev/null || echo agent)-$$}"

# The "current claim" pointer is per owner, never global: with two agents sharing one
# repository a shared pointer would let one agent release or heartbeat the other's lease.
# The owner is sanitised so it is safe as a filename component.
current_file() { printf '%s/.current-%s' "$claims" "$(printf '%s' "$owner" | tr -c 'A-Za-z0-9._-' '_')"; }

die() { printf 'claim: %s\n' "$*" >&2; exit 1; }

now() { date +%s; }

# Normalise: strip leading ./, collapse trailing slashes.
norm() {
  local s="$1"
  s="${s#./}"
  while [ "${s%/}" != "$s" ] && [ -n "${s%/}" ]; do s="${s%/}"; done
  printf '%s' "$s"
}

# Two scopes overlap when one is the other or a path-boundary prefix of it.
overlaps() {
  local a="$1" b="$2"
  [ "$a" = "*" ] || [ "$b" = "*" ] && return 0
  [ "$a" = "$b" ] && return 0
  case "$b" in "$a"/*) return 0 ;; esac
  case "$a" in "$b"/*) return 0 ;; esac
  return 1
}

expires_of() { cat "$1/expires" 2>/dev/null || echo 0; }
scope_of()   { cat "$1/scope"   2>/dev/null || echo ""; }
owner_of()   { cat "$1/owner"   2>/dev/null || echo unknown; }
note_of()    { cat "$1/note"    2>/dev/null || echo ""; }

is_expired() { [ "$(expires_of "$1")" -le "$(now)" ] 2>/dev/null; }

# Global board lock. `mkdir` is atomic, so exactly one process can hold it. A lock left
# behind by a killed process is broken after 30s so a crash cannot freeze the board.
board_lock() {
  local i=0 age mtime
  while [ "$i" -lt 100 ]; do
    if mkdir "$claims/.lock" 2>/dev/null; then
      printf '%s\n' "$$" > "$claims/.lock/pid" 2>/dev/null || true
      return 0
    fi
    if [ -d "$claims/.lock" ]; then
      mtime="$(stat -f %m "$claims/.lock" 2>/dev/null || stat -c %Y "$claims/.lock" 2>/dev/null || now)"
      age=$(( $(now) - mtime ))
      if [ "$age" -gt 30 ]; then rm -rf "$claims/.lock"; continue; fi
    fi
    sleep 0.1
    i=$((i + 1))
  done
  return 1
}
board_unlock() { rm -rf "$claims/.lock"; }

# Remove expired claim directories. Prints how many were reaped.
reap() {
  local n=0 d
  [ -d "$claims" ] || return 0
  for d in "$claims"/*/; do
    [ -d "$d" ] || continue
    if is_expired "$d"; then rm -rf "$d"; n=$((n + 1)); fi
  done
  [ "$n" -gt 0 ] && printf 'claim: reaped %s expired lease(s)\n' "$n" >&2
  return 0
}

# Print the first live claim that conflicts with $1, excluding directory $2.
find_conflict() {
  local scope="$1" skip="${2:-}" d s
  for d in "$claims"/*/; do
    [ -d "$d" ] || continue
    [ -n "$skip" ] && [ "$(cd "$d" && pwd)" = "$(cd "$skip" && pwd)" ] && continue
    s="$(scope_of "$d")"
    [ -n "$s" ] || continue
    if overlaps "$scope" "$s"; then printf '%s' "$d"; return 0; fi
  done
  return 1
}

cmd_acquire() {
  local scope="" note="" ttl=1800
  while [ $# -gt 0 ]; do
    case "$1" in
      --note) note="${2:-}"; shift 2 ;;
      --ttl)  ttl="${2:-}";  shift 2 ;;
      --owner) owner="${2:-}"; shift 2 ;;
      -*) die "unknown option $1" ;;
      *) [ -z "$scope" ] && scope="$1" || die "one scope only"; shift ;;
    esac
  done
  [ -n "$scope" ] || die "acquire needs a scope prefix (or \"*\")"
  case "$ttl" in ''|*[!0-9]*) die "--ttl must be a positive integer" ;; esac
  scope="$(norm "$scope")"

  mkdir -p "$claims"
  reap

  local id dir conflict
  # The whole check-then-create step runs under one board lock. Without it, two agents
  # can both scan a free board, both create a claim, and one must be torn down again —
  # a lost race that denies both. The lock is a directory, so acquisition is atomic.
  if ! board_lock; then die "board is busy (stale .lock? run: claim.sh reap)"; fi
  if conflict="$(find_conflict "$scope")"; then
    board_unlock
    printf 'claim: DENIED — %s is held by %s' "$scope" "$(owner_of "$conflict")" >&2
    printf ' (scope %s, note: %s)\n' "$(scope_of "$conflict")" "$(note_of "$conflict")" >&2
    return 1
  fi
  id="$(now)-$$-$RANDOM"
  dir="$claims/$id"
  if ! mkdir "$dir" 2>/dev/null; then board_unlock; die "could not create claim directory"; fi
  printf '%s\n' "$scope" > "$dir/scope"
  printf '%s\n' "$owner" > "$dir/owner"
  printf '%s\n' "$(( $(now) + ttl ))" > "$dir/expires"
  printf '%s\n' "$note" > "$dir/note"
  printf '%s\n' "$root" > "$dir/root"
  printf '%s\n' "$id" > "$(current_file)"
  board_unlock
  printf '%s\n' "$id"
  printf 'claim: ACQUIRED %s as %s for %ss (id %s)\n' "$scope" "$owner" "$ttl" "$id" >&2
  return 0
}

cmd_check() {
  [ $# -ge 1 ] || die "check needs a path"
  local p; p="$(norm "$1")"
  mkdir -p "$claims"; reap
  local c
  if c="$(find_conflict "$p")"; then
    printf 'HELD by %s (scope %s, note: %s)\n' "$(owner_of "$c")" "$(scope_of "$c")" "$(note_of "$c")"
    return 1
  fi
  printf 'FREE %s\n' "$p"
  return 0
}

cmd_heartbeat() {
  local ttl=1800
  while [ $# -gt 0 ]; do
    case "$1" in --ttl) ttl="${2:-}"; shift 2 ;; *) die "unknown option $1" ;; esac
  done
  local id; id="$(cat "$(current_file)" 2>/dev/null || true)"
  [ -n "$id" ] || die "no current claim to heartbeat"
  [ -d "$claims/$id" ] || die "current claim $id no longer exists (expired?)"
  printf '%s\n' "$(( $(now) + ttl ))" > "$claims/$id/expires"
  printf 'claim: heartbeat %s now expires %s\n' "$id" "$(date -r "$(expires_of "$claims/$id")" '+%H:%M:%S' 2>/dev/null || expires_of "$claims/$id")"
}

cmd_release() {
  local id="${1:-}"
  if [ -n "$id" ] && [ "$id" != "--all" ]; then
    [ -d "$claims/$id" ] || die "claim $id not found"
    rm -rf "$claims/$id"
    printf 'claim: RELEASED %s\n' "$id"
    return 0
  fi
  # With no id (or --all), release every lease this owner holds. An agent can hold more
  # than one scope, and the per-owner pointer only remembers the last, so releasing a
  # single "current" claim would leak the rest and block other agents.
  local d n=0
  for d in "$claims"/*/; do
    [ -d "$d" ] || continue
    if [ "$(owner_of "$d")" = "$owner" ]; then
      printf 'claim: RELEASED %s (%s)\n' "$(basename "$d")" "$(scope_of "$d")"
      rm -rf "$d"
      n=$((n + 1))
    fi
  done
  rm -f "$(current_file)"
  [ "$n" -gt 0 ] || die "no claims held by $owner"
  printf 'claim: released %s lease(s) for %s\n' "$n" "$owner"
}

cmd_status() {
  mkdir -p "$claims"; reap
  local d found=0 s o e n
  printf '%-28s %-22s %-10s %-8s %s\n' SCOPE OWNER EXPIRES LEFT NOTE
  for d in "$claims"/*/; do
    [ -d "$d" ] || continue
    s="$(scope_of "$d")"; [ -n "$s" ] || continue
    found=1
    o="$(owner_of "$d")"; e="$(expires_of "$d")"; n="$(note_of "$d")"
    printf '%-28s %-22s %-10s %-8s %s\n' \
      "$s" "$o" \
      "$(date -r "$e" '+%H:%M:%S' 2>/dev/null || echo "$e")" \
      "$(( e - $(now) ))s" "$n"
  done
  [ "$found" -eq 1 ] || echo "(no active claims — repository is free)"
}

case "${1:-}" in
  acquire)   shift; cmd_acquire "$@" ;;
  check)     shift; cmd_check "$@" ;;
  heartbeat) shift; cmd_heartbeat "$@" ;;
  release)   shift; cmd_release "$@" ;;
  status)    cmd_status ;;
  reap)      reap ;;
  ""|-h|--help|help)
    sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//' ;;
  *) die "unknown command '$1' (try --help)" ;;
esac
