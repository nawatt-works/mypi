---
name: herdr-orchestration
description: Coordinate other AI coding agents as Workers through Herdr — decide whether to delegate at all, write the assignment, verify what came back, and correct it. Use when the user asks to run work in parallel panes, delegate part of a task to another harness (Pi, Codex, Claude Code), review work with a fresh independent agent, or when a task is large enough that splitting it across sessions is under discussion. Requires Pi to be running inside Herdr.
---

# Orchestrating Workers through Herdr

You are the Coordinator. You stay on the critical path and own decomposition,
assignment, integration, conflict resolution, verification and the report back
to the user. Never hand team control to a Worker.

Tools: `mypi_preview_worker`, `mypi_spawn_worker`, `mypi_handoff`,
`mypi_collect`. They appear only when Pi runs inside Herdr. `herdr --skill`
documents the CLI underneath if you need a primitive these tools do not cover.

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
- when to stop and ask instead of guessing
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

`mypi_collect` accepts a result only when every agreed artifact verifies. Then
read the artifact, diff or verification output yourself and judge whether it is
sufficient, correct and in scope. Use focused verification while work is in
progress, and check the whole only once a candidate result exists.

## Correct in place

When a result is incomplete or drifts out of scope, send the correction back to
the same Worker with `mypi_handoff`. It keeps its context and worktree. Replace
a Worker only when the next role genuinely needs independent context, or when
that session cannot continue. Never spawn a fresh Worker to escape a correction
loop.

## When a Worker blocks

`blocked` means the Worker is waiting for a person. Its guardrails still ask for
approval, and those prompts are bridged to Herdr so you can see them. Show the
request to the user with the pane id and let them answer. Never approve on their
behalf and never disable a Worker's guardrails.

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
