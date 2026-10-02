---
name: token-efficient-agent
description: Keeps an agent equally capable at a fraction of the token cost. Use at the start of any task, whenever context feels large, before reading files or dumping command output, when exploring an unfamiliar codebase, when a session is nearing its context limit, or when the user mentions token usage, cost, context bloat, "be concise", or "use less tokens". Applies to every task by default.
whenToUse: Load at the start of a task and re-check before any large read, broad search, or long command. Also load when a session is running long or the user complains about cost or context.
---

# Token-efficient agent

Same result, fewer tokens. Token cost is dominated by what you *put into context*, not by
how cleverly you word your reply. Every rule below removes input, not capability.

Read this once per task. Do not re-read it.

## 1. Locate before you read

Never open a file to find out whether it is relevant.

- Search first (`grep`) for the symbol or string; read only the matching lines with
  surrounding context.
- Read a file with an explicit `offset`/`limit` window. A 2000-line file read for a
  30-line change is a 98% waste.
- Prefer `glob` for "where is X" over reading directories file by file.
- Read the *table of contents* — a README's headings, a file's exported symbol list —
  before reading the body.

Rule of thumb: a read should be justified by an already-known line number or symbol.

## 2. Cap every command's output

Unbounded output is the single largest hidden cost. Always bound it at the source:

| Instead of | Use |
|---|---|
| `git log` | `git log --oneline -10` |
| `git diff` | `git diff --stat`, then targeted hunks |
| `ls -R` | `ls` of one level, or `glob` |
| `cat file` | `read` with offset/limit |
| `npm test` | `npm test 2>&1 \| tail -30` |
| `find` | `glob` (returns at most 100) |
| `grep -r` | `grep` tool (caps at 250, reports where the rest is) |

A command that prints 5000 lines to answer a yes/no question is a bug in the command.

## 3. Batch independent calls

Independent tool calls belong in **one** assistant message. Three separate round trips
re-send the whole conversation three times; one message sends it once. This is usually
the largest available saving in a long session.

Only serialize when a call genuinely needs the previous result.

## 4. Delegate breadth, keep the conclusion

A subagent has its own context window. Reading 40 files to answer one question costs you
nothing if the subagent returns a 20-line answer.

Delegate when: the work spans many files, needs a broad sweep, or is exploratory.
Keep in the main thread when: the work needs this conversation's context, or you are
editing specific code.

State the deliverable and the exact sections you want back. "Summarize this" returns
noise; "return: purpose, entry point, and the 3 callers of X, citing file:line" returns
signal.

## 5. Never echo what the user can already see

- Do not restate tool output, file contents, or your own plan in the reply.
- Do not repeat the question back before answering it.
- Cite `file:line` instead of quoting the code.
- Do not narrate what you are about to do before each step; do it, then report.
- Skip preamble ("Great question!", "I'll now...") and closing filler.

Report only: what changed, where, whether it works, and what you could not verify.

## 6. Do not re-derive what you already know

- Do not re-read a file you just wrote or edited.
- Do not re-run a passing check to confirm it still passes unless something changed.
- When resuming, treat durable state (files, git, a written plan) as truth instead of
  re-exploring from scratch.
- Write intermediate findings to a file, not into the conversation. Reference the path.

## 7. Progressive disclosure

Load detail only when the decision depends on it.

- Read the reference doc when you hit the case it covers — not preemptively.
- Load a skill's companion files on demand, not with the skill itself.
- Ask for the schema you need, not the whole API surface.
- Stop reading when the question is answered.

## 8. Smallest sufficient action

- Prefer a targeted edit over rewriting a whole file.
- Prefer the existing helper over writing a new one.
- Prefer the smallest model/effort that can complete the task; escalate only on failure.
- Stop when the objective is met. Do not gold-plate, add unrequested features, or
  "improve while I'm here".

## 9. Compress at boundaries, not continuously

Summarizing after every step costs more than it saves. Compress at real boundaries:
the end of a task, before a long delegation, or when context is genuinely tight.

A good boundary summary is facts that would be expensive to re-derive:
- the decision made and why
- paths that matter
- what is verified vs assumed

Never compress by silently dropping a constraint or an unresolved risk.

## 10. Fail loudly and cheaply

Check the exit code. A failed command whose error you never read will be re-run — that
is the same tokens spent twice. Read the tail of the error, fix the cause, move on.
Do not re-run a command unchanged hoping for a different result.

## Anti-patterns

- Reading a whole file "to be safe".
- Piping full build logs into context.
- Explaining a diff line by line.
- Re-listing files you just listed.
- One tool call per message when they are independent.
- Restating the plan instead of executing it.
- Loading every skill and reference up front.

## Self-check before replying

1. Did I read anything I did not use?
2. Could independent calls have been batched?
3. Is there output in this reply the user already has?
4. Did I stop when the objective was met?
