# Agent-teams Generated-path Real-provider Acceptance

> **Status:** PASS — production remains disabled<br>
> **Executed:** 2026-08-31<br>
> **Provider/model:** `openai-codex/gpt-5.4`, thinking `low`<br>
> **Candidate commits:** `cb05e2f`, `5340500`, `d09c982`, `567826a`, `d5273ed`, `637f0b0`, `89b91b6`, `6ef5705`, `3463b31`, `ef05fe8`, `e89dd0b`, `53f40e3`, `6e893c2`, `afd7ab4`, `d0610f2`, `f8bb328`, `ea9637d`, `c5b672b`<br>
> **Profile digest:** `9445ad8b171af11d51dc0f1312c3b3f20fe45f076658f954f8bce8f1b02b83ad`

## Operator boundary

ผู้ใช้เปิด Development Piด้วย isolated `PI_CODING_AGENT_DIR`, login/select model, รัน `/mypi-worker-setup setup`และยืนยัน `/mypi-worker-acceptance` Credential valueไม่ผ่าน chat, argv, child environment, auditหรือ repository

Initial operator runได้ structured `BLOCKED` ที่ stage `dependencies` เพราะ pinned upstreamไม่มี `package-lock.json` Candidate correctionเปลี่ยนเป็น committed acceptance-only exact lockfileพร้อม digest pin + isolated `npm ci`

Startup correctionถัดมาย้าย Git worktreeออกจาก credential runtimeไป sibling private `worker-worktrees-v1` และแก้ readinessให้ bind backend tool `team_message`ร่วมกับ built-ins หลัง corrections Coordinator rerun exact runnerด้วย trusted setup receipt metadataจาก Development sessionโดยไม่อ่านหรือส่ง credential value

## Observed PASS evidence

```json
{
  "status": "PASS",
  "productionActivated": false,
  "profileDigest": "9445ad8b171af11d51dc0f1312c3b3f20fe45f076658f954f8bce8f1b02b83ad",
  "runtimeAuthorityDigest": "b4e2a62884957ba51f809c835eeaacea0425412ae8f57578c5e45a47347ae7d4",
  "credentialRevision": 1,
  "providerId": "openai-codex",
  "modelId": "gpt-5.4",
  "checks": {
    "realProviderArtifact": true,
    "exactReadOnlyAdapter": true,
    "exactWorktreeWriteAdapter": true,
    "delegatedResolverNoWorkerUi": true,
    "exactReviewConsumeOnce": true,
    "humanBoundaryPreserved": true,
    "remoteMutationGuardrail": true,
    "productionOptInDisabled": true,
    "productionEntryComposed": true,
    "generatedSpawnReadiness": true,
    "boundedWorktreeMutation": true,
    "noInteractiveRequests": true,
    "forcedCrashCleanup": true,
    "leaderLossCleanup": true,
    "leaderLossWorktreeRetained": true,
    "orderlyShutdownClassified": true,
    "stopCleanup": true,
    "sameNameReplacement": true,
    "noReusableCredentialState": true
  },
  "generatedProfileRootRemoved": true,
  "interactiveRequestsObserved": 0
}
```

ไม่เก็บ team ID, setup digestหรือ credential-derived dataใน repository auditนี้

## Path exercised

```text
trusted machine receipt
  → pinned public upstream + zero-context overlay
  → exact acceptance dependency lock + npm ci
  → patched leader RPC
  → read-only Worker: canonical leader workspace, exact read + team_message, no shell/mutation/container mount
  → orderly read-only stop + no leader-workspace mutation
  → worktree-write Worker: exact managed sibling worktree, exact read/bash/edit/write + team_message, Bash rw bind
  → exact manifest/canonical cwd/readiness workspace binding
  → pure guardrail detector → delegated resolver → no Worker UI
  → Coordinator-owned exact workspace generation authority
  → exact REVIEW issue/consume once + replay reject
  → HUMAN remote mutation remains blockedทั้ง command-policyและ tool-call guardrail
  → disabled production entry no-op before authority inspection
  → exact opt-in composes resolver/orchestration once in disposable path
  → provisionAgentTeamsWorkerProfile
  → signed single-use lease
  → exact generated argv/environment
  → structured boundary readiness
  → real-provider nonce-bound artifact
  → exact Worker PID SIGKILL
  → generation-bound asynchronous cleanup
  → immediate same-name retry serialized behind cleanup
  → same-name replacement with new profile/lease identities
  → graceful stop classified without false leader-loss marker
  → third generation + leader SIGKILL
  → child watchdog/self-clean exact profile and auth
  → durable generation marker + retained recovery worktree
  → cleanup + no reusable credential state
```

## Verification

- full repository suite `227/227`
- exact Docker runtime hardening contract bindใน leader/boundary digestและ negative drift coverageครบ
- runtime/fault probes `10/10`
- patched upstream typecheck/lint PASS
- rotation integration: active generated profile block, idle rotation revision `1→2`, stale setup/revision failก่อน lease/spawn, revisionใหม่สร้าง profile identityใหม่และ cleanupผ่าน
- final four-layer guardrail closure review: **PASS**, no High/Medium

## Remaining gate

ผลนี้ผ่าน exact read-only/worktree-write adapters, delegated resolver, generated spawn/readiness/work/forced-crash/immediate retry/orderly stop/leader-loss self-clean/worktree retention/replacement path 19/19 และ rotation integrationยืนยัน active block → idle rotate → stale revision reject → new revision spawnแล้ว Disabled production opt-in reviewผ่านและ explicit entryถูก wireแล้วโดย root/manual behaviorไม่เปลี่ยน Production activation, push, release/tagและ Default Pi switchยังต้องขอ human decisionแยกกัน
