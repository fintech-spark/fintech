---
name: multi-agent-concurrency
description: Lets several coding agents work in one repository at the same time without overwriting each other. Use before ANY file write, edit, delete, or branch operation in a repository that more than one agent may be working in, when you notice unexpected file changes or deletions you did not make, when git status changes on its own, when starting a session in a repo with a COORDINATION.md or .agents/ directory, or when the user mentions multiple agents, parallel agents, concurrent sessions, Antigravity, opencode, or agents fighting each other.
whenToUse: Load before the first write of any session in a shared repository, and again whenever the working tree changes without you changing it.
---

# Multi-agent concurrency

Several agents in one repository will destroy each other's work unless they coordinate.
This is not hypothetical: uncoordinated agents delete tracked files and revert each
other's edits. Coordination costs a few hundred tokens; recovery costs the work.

The mechanism is a **claim**: an on-disk, atomic, expiring lease over a path.

## The one rule

**Never write to a path you have not claimed, and never touch a path another agent holds.**

Everything below supports that rule.

## Setup, once per repository

```bash
mkdir -p .agents/tools .agents/claims
printf '%s\n' ".agents/claims/" >> .gitignore   # leases are local, never committed
cp "<skill-dir>/scripts/claim.sh" .agents/tools/claim.sh && chmod +x .agents/tools/claim.sh
```

The **tool** lives in `.agents/tools/` so it is committed and every agent runs one shared
version. The **leases** live in `.agents/claims/` and must never be committed — they are
per-machine runtime state.

## The claim tool

`scripts/claim.sh` in this skill ships with the protocol. Copy it into the repository
once as shown above:

```bash
CLAIM=.agents/tools/claim.sh

# Before writing: reserve the paths you will touch
$CLAIM acquire "src/api" --note "adding pagination" --ttl 1800

# Check a single path without claiming
$CLAIM check "src/api/routes.ts"   # exit 0 free, exit 1 held, prints the holder

# While working: extend the lease
$CLAIM heartbeat

# When done
$CLAIM release

# Inspect the board
$CLAIM status

# Clear expired leases from crashed agents
$CLAIM reap
```

Scope is a **path prefix**. `src/api` and `src/api/routes.ts` overlap; `src/api` and
`src/db` do not. Use `"*"` only for genuinely repository-wide work — it blocks everyone.

## The protocol

1. **Discover.** `$CLAIM status` and read the coordination board. Know who is active.
2. **Claim.** `$CLAIM acquire <prefix> --note "<what you are doing>"`. If it fails, the
   holder prints its scope and owner. Do not override it.
3. **Verify you still hold it** before the first write, especially after a long read.
4. **Work small.** Claim the narrowest prefix that covers your edit, and release early.
   A big claim blocks everyone; a long claim expires under you.
5. **Record.** Append one line to the board: owner, scope, intent, timestamp.
6. **Release.** `$CLAIM release`. Do this even on failure — a leaked claim blocks others.
7. **Heartbeat** long tasks so the lease does not expire mid-edit.

If `acquire` fails: pick different work, wait, or ask the user to arbitrate. Do **not**
"just make a small change" in someone else's scope.

## When the tree changes under you

Unexpected modifications, deletions, or new files mean another agent acted. Respond:

1. **Stop writing.** Do not race it.
2. Run `$CLAIM status` and `git status` to see the shape of the change.
3. **Do not revert it.** `git checkout -- <file>` on another agent's in-flight edit
   destroys work. A deleted tracked file may be mid-refactor.
4. Compare against what you claimed. If the change is outside your scope, ignore it and
   continue; if it is inside, stop and report the collision.
5. Tell the user what changed and when, with timestamps. Let them arbitrate.

## Hard rules

- Never `git checkout -- .`, `git reset --hard`, `git clean`, or `rm -rf` on a shared
  repository without an explicit instruction naming the paths.
- Never force-push. Never rewrite shared history.
- Never delete a tracked file you did not create — report it instead.
- Never commit another agent's in-progress changes as your own.
- Never edit the coordination board's record of another agent's claim.
- If there is no git remote, treat every file as unrecoverable and act accordingly.

## Board format

Keep it append-only and machine-readable so agents can parse it:

```markdown
## Active claims
| scope | owner | since | expires | note |
|---|---|---|---|---|
| src/api | antigravity-ide | 17:56 | 18:26 | adding pagination |

## Handoff
- <owner> → <owner>: <what is now safe to touch>
```

Append; do not rewrite history. Reap expired rows rather than editing them.

## Reporting a collision

State the concrete facts, not a guess:

- the path
- what changed (added / modified / deleted)
- the timestamps you observed
- which claim, if any, overlaps
- what you did not do about it

Never guess another agent's intent. Report and let the human decide.
