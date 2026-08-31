# Assessment checklist

Use this checklist as a coverage aid, not as a substitute for package-specific judgment. Mark non-applicable items explicitly.

## Version and provenance

- Exact current, locked, installed, candidate, latest, and dist-tag versions agree where expected.
- Candidate is not a typo-squatted name, prerelease selected accidentally, deprecated release, or mutable non-version specifier.
- Registry tarball URL, SHA-512 integrity, shasum, repository, license, publisher/provenance metadata, and publication time are recorded.
- Release notes and Git tag correspond to the exact npm artifact.

## Packaging and Pi resources

- `package.json` entrypoints, `exports`, `main`, module type, files list, and packed paths are compatible with the My Pi wrapper.
- `pi.extensions`, `pi.skills`, `pi.prompts`, and `pi.themes` additions/removals are understood.
- Extension factory and lifecycle behavior do not move privileged work into module load time.
- Tool and command names, parameters, result shapes, lazy loading, defaults, and collision behavior are compared.
- Skill names/descriptions and collision order are compared.

## Runtime compatibility

- Node engine and platform/native dependency support match the release environment.
- Pi core imports use documented public roots/subpaths covered by the installed host loader.
- Pi/typebox/zod peer ranges resolve without force, overrides, or multiple incompatible runtime identities.
- Config paths, schemas, migrations, cache/auth storage, session entries, and backward compatibility are reviewed.
- Existing state remains readable or a bounded migration/rollback is documented.

## Authority and security

- New subprocess, shell, browser, filesystem, keyring, credential, upload, callback server, and network behavior is identified.
- New install/preinstall/postinstall/prepare scripts are reviewed; candidate scripts are never executed during assessment.
- New remote-mutation tools or opaque command executors are covered by guardrails or held for human review.
- Secret values do not enter args, environment, logs, worktrees, manifests, digests, or reports.
- Security advisories, dependency deprecations, license changes, and provenance gaps are resolved.

## My Pi boundaries

- Root aggregate still loads only stable global resources.
- Project-opt-in and incubator resources do not leak into stable startup.
- Generated Workers retain `--no-extensions`, `--no-skills`, and exact tool allowlists unless a separately reviewed profile change is intended.
- Production opt-ins remain disabled unless the user explicitly authorizes activation.
- Existing standalone package entries are removed atomically only during an authorized Default switch, never during assessment.

## Disposable verification

- Candidate exact pin is the only intentional manifest change.
- Lock diff distinguishes direct candidate changes from transitive churn.
- Focused tests pass.
- Full tests pass.
- Clean install and Pi RPC/resource discovery pass without duplicate tools, commands, or skills.
- Host-owned Pi core resolution remains valid.
- `npm audit --omit=dev` has no unresolved severity above project policy.
- Real-provider or authenticated acceptance is either passed with explicit approval or listed as `HUMAN`/remaining evidence.

## Rollback

- Previous exact pin and lockfile are recoverable.
- Config/state migrations are reversible or explicitly one-way.
- Release, tag, Default Pi, and settings rollback steps are identified but not executed during assessment.
