# Agent-teams Generated-path Real-provider Acceptance

> **Status:** PASS — production remains disabled<br>
> **Executed:** 2026-08-30<br>
> **Provider/model:** `openai-codex/gpt-5.4`, thinking `low`<br>
> **Candidate commits:** `cb05e2f`, `5340500`, `d09c982`, `567826a`, `d5273ed`, `637f0b0`<br>
> **Profile digest:** `368d561ec19be9b4a57a5b1e0296df606fd814eae958728a97b5464335287f7f`

## Operator boundary

ผู้ใช้เปิด Development Piด้วย isolated `PI_CODING_AGENT_DIR`, login/select model, รัน `/mypi-worker-setup setup`และยืนยัน `/mypi-worker-acceptance` Credential valueไม่ผ่าน chat, argv, child environment, auditหรือ repository

Initial operator runได้ structured `BLOCKED` ที่ stage `dependencies` เพราะ pinned upstreamไม่มี `package-lock.json` Candidate correctionเปลี่ยนเป็น committed acceptance-only exact lockfileพร้อม digest pin + isolated `npm ci`

Startup correctionถัดมาย้าย Git worktreeออกจาก credential runtimeไป sibling private `worker-worktrees-v1` และแก้ readinessให้ bind backend tool `team_message`ร่วมกับ built-ins หลัง corrections Coordinator rerun exact runnerด้วย trusted setup receipt metadataจาก Development sessionโดยไม่อ่านหรือส่ง credential value

## Observed PASS evidence

```json
{
  "status": "PASS",
  "productionActivated": false,
  "profileDigest": "368d561ec19be9b4a57a5b1e0296df606fd814eae958728a97b5464335287f7f",
  "runtimeAuthorityDigest": "7398876bb4d8fe04fe33ac22295e0a7fa153f9a7e26213b88c9b5c19d24a58f7",
  "credentialRevision": 1,
  "providerId": "openai-codex",
  "modelId": "gpt-5.4",
  "checks": {
    "realProviderArtifact": true,
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

- full repository suite `194/194`
- runtime/fault probes `10/10`
- patched upstream typecheck/lint PASS
- rotation integration: active generated profile block, idle rotation revision `1→2`, stale setup/revision failก่อน lease/spawn, revisionใหม่สร้าง profile identityใหม่และ cleanupผ่าน
- final independent correction/evidence review: **PASS**, no High/Medium

## Remaining gate

ผลนี้ผ่าน generated spawn/readiness/work/forced-crash/immediate retry/orderly stop/leader-loss self-clean/worktree retention/replacement path 11/11 และ rotation integrationยืนยัน active block → idle rotate → stale revision reject → new revision spawnแล้ว แต่ยังไม่เปิด production ต้องเพิ่ม read-only/worktree-write adaptersและ final Phase 2–3 evidence reviewก่อน root import, releaseหรือ Default Pi switch
