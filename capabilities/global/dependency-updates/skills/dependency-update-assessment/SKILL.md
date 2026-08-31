---
name: dependency-update-assessment
description: Assess proposed npm dependency upgrades before changing exact pins. Use whenever the user asks whether a package version is safe to update, what an npm dependency upgrade could break, whether My Pi should bump MCP/Web/Chrome or another runtime package, or requests changelog, compatibility, lockfile, security, tool-surface, or migration impact analysis. Produce an evidence-based go/hold/reject recommendation and never apply the update without separate approval.
compatibility: Requires Node.js, npm, Git, temporary filesystem access, and network access for live registry or upstream evidence.
---

# Dependency update assessment

Evaluate an update before editing the authoritative manifest or lockfile. A newer registry version is a candidate, not evidence that it is compatible.

## Authority boundary

- Treat the checked-in package manifest and lockfile as the current authority.
- Keep registry queries, release-note research, tarball inspection, and disposable-copy verification read-only with respect to the real repository.
- Never edit the real manifest or lockfile, run candidate lifecycle scripts, commit, tag, push, publish, switch Default Pi, or alter user settings during assessment.
- If the user later approves application, treat that as a separate change phase and re-run all gates after editing the exact pin.
- Preserve unrelated dirty work. A dirty repository lowers confidence and blocks automatic application, but does not prevent a clearly labelled read-only assessment.

## Workflow

### 1. Establish the exact scope

1. Locate the aggregate root, workspace package manifest, lockfile entry, wrapper/resource paths, and tests that own the dependency.
2. Record current exact pin, installed/locked version, candidate version, registry `latest`, Node engine, Pi peer compatibility, and whether the candidate is a patch, minor, major, prerelease, deprecated, or missing.
3. If no candidate was specified, discover versions but do not assume `latest` is the desired target. If no package was specified either, ask for or report the missing scope; do not select an arbitrary dependency merely because it appears in the repository.
4. State explicitly that no repository or profile mutation has occurred.

### 2. Gather authoritative evidence

Prefer evidence in this order:

1. npm registry metadata and tarball integrity for the exact version;
2. upstream release notes, changelog, migration guide, security advisory, and repository comparison;
3. candidate tarball contents inspected in a private temporary directory;
4. existing My Pi contracts, tests, acceptance notes, and runtime boundaries.

Use exact URLs or commands in the report. Separate verified facts from inference. Treat a fact as verified only when the command response or fetched source was actually observed in this run. Search snippets, publisher pages, cached prose, and failed or hanging commands cannot prove a dist-tag or exact version. If direct registry metadata, a changelog, or another required source is unavailable or ambiguous, list it as unavailable and return `HOLD` rather than filling gaps from version numbers.

For registry inspection, capture the full JSON and parse it rather than relying on terminal formatting. Relevant fields include `version`, `dist`, `engines`, `peerDependencies`, `dependencies`, `exports`, `pi`, `scripts`, `repository`, `license`, and `deprecated`. Download with `npm pack --ignore-scripts` only into a private temporary directory; extract as data and never execute package code or lifecycle hooks.

### 3. Compare impact surfaces

Read [the assessment checklist](references/assessment-checklist.md) and cover every applicable category. For Pi packages, explicitly compare:

- extension, skill, prompt, theme, command, and tool resources;
- wrapper import paths and package exports;
- command/tool names, schemas, lazy-loading behavior, and default activation;
- config, credential, cache, browser profile, and session-state locations or migrations;
- Pi core imports and peer ranges against the host extension-loader contract;
- subprocesses, network access, authentication, uploads, remote mutation, install scripts, and secret exposure;
- generated Worker exact allowlists and whether the dependency could leak into isolated profiles;
- direct and transitive lockfile churn, licenses, engines, deprecations, advisories, and provenance.

A semver patch can still widen authority. A major release can still be compatible, but requires migration evidence and stronger verification.

### 4. Verify in a disposable copy

When evidence is sufficient to test:

1. Copy the repository to a private temporary directory, excluding `.git`, `node_modules`, caches, credentials, and profile state.
2. Change only the candidate's exact pin in the copy.
3. Update/install with scripts disabled. Never use bypass or force flags to make resolution pass.
4. Review manifest and lock diff. Flag unrelated upgrades, peer reshaping, new lifecycle scripts, removed integrity, or unexpectedly large churn.
5. Run the package's focused tests, full repository suite, clean-install/resource smoke, and `npm audit --omit=dev` when available.
6. Run real-provider, authenticated browser, upload, publish, or external-mutation checks only after a separate human decision.
7. Delete the disposable copy after recording redacted evidence.

Do not claim compatibility from `npm install` alone. Registration smoke proves loading, not semantic behavior.

### 5. Decide

Use exactly one assessment verdict:

- `CURRENT` — direct registry JSON observed in this run shows the requested candidate is identical to the current exact pin, so no patch is needed. Require a successful `npm view <package> dist-tags version --json` response or an equivalent fetched `registry.npmjs.org` document containing the exact dist-tag/version; an npm web page, search result, publisher profile, cached page, or release list is not sufficient. If direct registry JSON is unavailable, use `HOLD`. Never use `SAFE_TO_PROPOSE` for a no-op version.
- `SAFE_TO_PROPOSE` — exact candidate and provenance are verified, relevant changes are understood, wrapper/resource and peer contracts remain valid, every required disposable gate was actually run and passed, and no unresolved authority expansion exists. Registry/tarball evidence, changelog or exact source diff, lock-diff review, focused/full tests, clean-install resource smoke, and applicable audit are hard prerequisites; if any required gate is unavailable or not run, return `HOLD`. This authorizes proposing a patch, not applying it.
- `HOLD` — evidence, migration guidance, compatibility, or verification is incomplete or ambiguous.
- `REJECT` — the exact candidate violates a required contract, fails gates, is deprecated/untrusted, removes required resources, or introduces unacceptable authority.
- `HUMAN` — the next evidence step itself requires credentials, cost, authenticated browser state, external mutation, release/tag/push, Default switch, or another human-only boundary.

When different packages have different outcomes, give each package its own verdict. Do not bundle upgrades merely because they were discovered together.

## Report contract

Follow [the report template](references/report-template.md). Include:

- exact current/candidate versions and integrity/provenance;
- authoritative evidence with dates;
- changed behavior and affected My Pi files/contracts;
- disposable verification commands and results;
- direct/transitive lockfile impact;
- remaining uncertainty and human-only steps;
- exact files that a future approved patch would change.

Never say “safe to update” when the evidence only supports “safe to propose,” and never propose a patch when the exact pin is already `CURRENT`.
