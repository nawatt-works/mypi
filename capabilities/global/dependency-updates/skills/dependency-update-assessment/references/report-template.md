# Report template

```markdown
# Dependency Update Assessment

> Assessment time: <ISO timestamp>
> Repository state: <clean/dirty, branch, HEAD>
> Mutation status: none

## Executive verdict

| Package | Current exact pin | Candidate | Semver class | Verdict | Confidence |
|---|---:|---:|---|---|---|
| <name> | <version> | <version> | <patch/minor/major/prerelease> | CURRENT/SAFE_TO_PROPOSE/HOLD/REJECT/HUMAN | high/medium/low |

<One paragraph explaining the decision without overstating it.>

## Evidence

| Evidence | Exact source/version/date | Finding |
|---|---|---|
| npm metadata | <URL or command> | <verified fact> |
| release notes | <URL/tag> | <verified fact> |
| tarball | <integrity/path inventory> | <verified fact> |

Clearly label inference and unavailable evidence.

## Impact analysis

### Packaging and resources
- Wrapper/import paths:
- Exports and packed files:
- Pi extensions/skills/prompts/themes:
- Tool/command/skill surface:

### Runtime and state
- Node/Pi/peer compatibility:
- Config/auth/cache/session migration:
- Lifecycle/process/network behavior:

### Authority and security
- New or widened capabilities:
- Secrets/external mutations/install scripts:
- Advisories/license/provenance:
- Generated Worker and production boundaries:

### Lockfile
- Direct changes:
- Transitive changes:
- Unexpected churn:

## Disposable verification

| Gate | Command or method | Result | Evidence limitation |
|---|---|---|---|
| focused tests | ... | PASS/FAIL/NOT RUN | ... |
| full suite | ... | ... | ... |
| clean install/resource smoke | ... | ... | ... |
| audit | ... | ... | ... |
| authenticated/real-provider acceptance | ... | HUMAN/NOT REQUIRED/PASS | ... |

## Exact-pin decision

State why the evidence meets or fails the selected verdict. `CURRENT` means no patch is needed. `SAFE_TO_PROPOSE` means a patch may be presented for approval; it does not mean the real repository was changed.

## Proposed patch — not applied

- `<capability>/package.json`: `<current>` → `<candidate>`
- `package-lock.json`: regenerate without lifecycle scripts; review direct/transitive diff
- Wrapper/tests/docs requiring changes:
- Post-apply gates:

## Remaining uncertainty and human decisions

- <missing evidence>
- <credential/cost/external mutation>
- <commit/tag/push/release/Default switch decision>
```
