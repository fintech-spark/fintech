---
name: repo-concurrency-protocol
description: Coordinate with the other agents working in this repository at the same time, and commit or push safely. Use before writing any file in a shared repo, when another agent's changes appear unexpectedly, when git status shows modifications you did not make, when deciding whether to commit or push, before staging or committing anything, or when deciding whether to switch branches, stash, reset, or clean. Encodes the claim lease tool, the branch lock, safe staging, and the four sibling worktrees.
---

# Repository concurrency protocol

Several agents work in this repository simultaneously, including separate worktrees on their own
branches. Uncoordinated agents delete each other's tracked files and revert each other's edits.
Coordination costs a few hundred tokens; recovery costs the work.

## The one rule

**Never write to a path you have not claimed, and never touch a path another agent holds.**

## Claims

```bash
CLAIM=.agents/tools/claim.sh
$CLAIM acquire "modules/rag" --note "adds tenant filter to retrieval" --ttl 1800
$CLAIM status                     # who holds what
$CLAIM check "modules/rag/domain/chunking.ts"   # exit 1 = held
$CLAIM heartbeat                  # extend during long work
$CLAIM release                    # always, even on failure
$CLAIM reap                       # clear expired leases from crashed agents
```

Scope is a path prefix; `src/api` and `src/api/x.ts` overlap, `src/api` and `src/db` do not. Leases
live in `.agents/claims/` and are gitignored — local runtime state, never committed. A `.<owner>`
marker file (`.current-<owner>`) records the current holder. Acquire narrowly and release early: a
broad claim blocks everyone, a long claim expires under you.

`acquire` failing means someone else owns it. Pick different work, wait, or ask the human. Do not
"just make a small change" in someone else's scope.

## Git is locked, not a coordination mechanism

Stay on the branch that was checked out when you started. Never create, switch, rename, or delete a
branch; never create a worktree; never merge, rebase, cherry-pick, or reset to another branch; never
force-push; never change remotes or upstream tracking. The starting branch must equal the ending
branch.

The existence of another branch is **not** permission to use it. If another workstream's work is
required, identify the dependency and work with the contract instead.

Sibling worktrees exist: `fintech-audit-ai` (`feature/ai`), `fintech-backend` (`feature/backend`),
`fintech-frontend` (`feature/frontend`), `fintech-security` (`feat/database-security`). Read them
if you must; never write in them.

## When the tree changes under you

1. **Stop writing.** Do not race it.
2. `git status --short` and `$CLAIM status` to see the shape of the change.
3. **Do not revert.** `git checkout -- <file>`, `git restore`, `git reset --hard`, `git clean -fd`
   destroy other people's in-flight work. A deleted tracked file is usually mid-refactor.
4. Compare against what you claimed. Outside your scope → ignore and continue. Inside your scope →
   stop and report the collision.
5. Report facts, not guesses: path, what changed, timestamps observed, which claim overlaps, and
   what you did **not** do about it. Let the human arbitrate.

## Committing and pushing

- Stage explicit paths. Never `git add -A` in a shared tree.
- Review every staged file: `git diff --cached --stat`, `git diff --cached --check`.
- Never commit another agent's in-flight work, secrets, `.env*`, or generated junk.
- Push only the branch you started on, and only when explicitly asked.
- Expect another agent to commit your in-flight files. That is not a reason to revert; check
  `git log` before assuming your work was lost.

## References

- `.agents/rules/code-review.md`, `.agents/rules/security.md` — review and security policies
- `.agents/skills/multi-agent-concurrency/SKILL.md` — the generic protocol
