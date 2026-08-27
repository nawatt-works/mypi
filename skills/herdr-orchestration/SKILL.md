---
name: herdr-orchestration
description: Coordinate other AI coding agents as Workers through Herdr — decide whether to delegate at all, write the assignment, verify what came back, and correct it. Use when the user asks to run work in parallel panes, delegate part of a task to another harness (Pi, Codex, Claude Code), review work with a fresh independent agent, or when a task is large enough that splitting it across sessions is under discussion. Requires Pi to be running inside Herdr.
---

# Orchestrating Workers through Herdr

Three levels of authority, and they do not overlap:

- **The user decides.** Which Workers exist, which harness each runs, every
  design question the task did not already settle, and whether a result is
  accepted. You never take a decision on their behalf.
- **You are the Coordinator.** You stay on the critical path and own
  decomposition, assignment, integration, conflict resolution, verification and
  the report back to the user. Never hand team control to a Worker.
- **Workers execute one bounded assignment.** They do not make design or
  architecture decisions unless the assignment explicitly delegates a bounded
  choice. A Worker that finds it needs such a decision stops and asks.

Tools: `mypi_preview_worker`, `mypi_spawn_worker`, `mypi_handoff`,
`mypi_wait_worker`, `mypi_collect`, `mypi_set_assurance`. They appear only when
Pi runs inside Herdr. `/mypi-orchestrate-status` shows the team and what has
been verified; `/mypi-orchestrate-cleanup` removes worktrees one at a time after
confirmation. `herdr --skill` documents the CLI underneath if you need a
primitive these tools do not cover.

## First decide whether to delegate at all

Spawning a Worker is not an achievement. Before each one, state at least one
concrete benefit:

- a separable lane shortens the critical path
- separating context keeps requirements or evidence from mixing
- the chosen harness or model suits this bounded assignment significantly better
- the assurance level agreed with the user calls for fresh, independent inspection

No such reason means you do the work yourself. File count, or a task that merely
feels big, is not a reason. Start from the smallest team that works; any
configured worker limit is a ceiling, not a target.

Keep two decisions apart:

| Decision | Question |
|---|---|
| Execution | do it yourself, one Worker, or several — serial or parallel |
| Assurance | is your own evidence enough, or does this need independent review, a human gate, or durable evidence |

Raise assurance because of risk or because the user asked, never because the
team happens to be large.

Record the level with `mypi_set_assurance` **before** the work is assigned, and
say what would fail it. Choosing the bar after seeing the result is how a bar
gets lowered to fit. `coordinator` is satisfied by your own verified evidence;
`independent-review` needs a verifier other than whoever produced the work;
`human-approval` never settles on its own.

Independence is measured against the producer, not the size of the team. When a
Worker produces the work, name it in `producedBy`; when you implement it
yourself, leave it out and one reviewing Worker satisfies the bar. A Worker
verifying its own output never does.

## The user chooses the team

The user decides, or approves, which Workers exist and which harness each one
runs. Propose a team and an order from the context; never treat any role as
mandatory. `mypi_spawn_worker` asks for approval every time — that gate is the
user's, so do not work around it.

Call `mypi_preview_worker` first and show the plan. Prefer the harness the user
named. Warn when a harness has no Herdr lifecycle integration installed: its
identity can then only be recognised from the screen.

## Write a task-local handoff contract

There is no shared result schema. For each assignment, say what that task needs:

- the goal and its boundary
- exact input artifacts, branches, commits or conclusions to read
- exact ownership: what this Worker may write, and what it must not touch
- constraints and prohibitions
- acceptance criteria or observable outcome
- expected output, with the exact path when a file is expected
- verification to run and evidence to attach
- the assurance level this result will be judged against, and what fails it
- when to stop and ask instead of guessing, including any design decision the
  assignment does not already settle
- how to report back

Do not force one schema onto every Worker, and do not move or reshape an
artifact so it fits your conventions. Each artifact keeps the path, format and
lifecycle of whoever owns it; the registry stores only a reference and the
reason the next step reads it.

## Verify before you believe

A Worker's summary is never evidence. Neither is lifecycle state:
`herdr agent prompt --wait` has been observed reporting success for a turn that
died on a provider error, and for a correction that never reached the agent.

`mypi_handoff` reports `delivered: false` when nothing in the Worker's state
moved. Treat that as undelivered work, not a slow Worker: read the pane with
`herdr agent read <name> --source recent-unwrapped` before deciding.

Use `mypi_wait_worker` to wait for a Worker rather than sleeping and re-reading
its screen. Polling burns the context you need for the actual work, and reaching
a state still proves nothing about the result.

`mypi_collect` accepts a result only when every agreed artifact verifies. Then
read the artifact, diff or verification output yourself and judge whether it is
sufficient, correct and in scope. Use focused verification while work is in
progress, and check the whole only once a candidate result exists.

## Correct in place, and end the loop

When a result is incomplete or drifts out of scope, send the correction back to
the same Worker with `mypi_handoff`. It keeps its context and worktree. Replace
a Worker only when the next role genuinely needs independent context, or when
that session cannot continue. Never spawn a fresh Worker to escape a correction
loop.

A correction is bounded to the findings that blocked acceptance, the changes
made in response, and any regression those changes introduce. It is not a fresh
unbounded review, and each round must be strictly smaller than the last. You own
scope control: when rounds stop converging, stop and bring the disagreement to
the user with the evidence, rather than letting the loop run.

Findings outside the agreed scope are not corrections:

- an improvement that is out of scope is **advisory** — report it, do not act
- a serious risk that is out of scope is a **scope escalation** — stop and put
  it to the user

Neither one silently widens what this task was agreed to deliver. The same rule
binds you: finishing a task does not license work nobody asked for.

## Give a Worker its own worktree when it writes code

`mypi_spawn_worker` takes a `worktree` with a branch and an exact base, which
opens a separate checkout so a Worker's edits never land on the shared tree.
Prefer it whenever a Worker commits. Worktrees are never removed automatically:
`/mypi-orchestrate-cleanup` asks per worktree and skips any whose Worker is still
live or whose tree has uncommitted work. Removing a checkout keeps the branch and
its commits.

## When a Worker blocks

`blocked` means the Worker is waiting for a person. Its guardrails still ask for
approval, and those prompts are bridged to Herdr so you can see them. Show the
request to the user with the pane id and let them answer. Never approve on their
behalf and never disable a Worker's guardrails.

After telling them, wait with `mypi_wait_worker --until idle` instead of asking
whether they answered yet. The Worker leaving `blocked` is the confirmation, and
asking for one costs a round trip that the Worker's own state already gives you.
Say what the decision changes for the work — which check is skipped, which
assurance bar goes unmet — so the answer does not require reading the Worker's
screen.

## Identity: what was asked for versus what is running

Track the requested harness separately from the observed kind. Evidence is
`lifecycle` (the harness's integration reported a session), `detection` (Herdr
recognised it on screen) or `none`. An integration reports identity only after
the Worker's first turn, so re-check with `/mypi-orchestrate-status` once it has
worked before concluding anything. Record `unknown` honestly; never infer the
running harness from an agent name, a prompt, or the Worker's own claim.

## Parallel work

Run serial by default. Parallel writing is allowed only when every writing
Worker has exact ownership and write scopes do not overlap. Shared files,
unresolved design decisions and dependency chains are serial, and you merge the
shared parts yourself.

Herdr is not a security boundary. Workers that need different trust levels need
a container, VM or separate OS user.
