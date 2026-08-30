# Agent-teams Generated-path Real-provider Acceptance

> **Status:** PASS — production remains disabled<br>
> **Executed:** 2026-08-30<br>
> **Provider/model:** `openai-codex/gpt-5.4`, thinking `low`<br>
> **Candidate commits:** `cb05e2f`, `5340500`<br>
> **Profile digest:** `6cb191d99f13aa33d9b5c460816942501c84deed2e0cfed2bd6e2d4f3311b50b`

## Operator boundary

ผู้ใช้เปิด Development Piด้วย isolated `PI_CODING_AGENT_DIR`, login/select model, รัน `/mypi-worker-setup setup`และยืนยัน `/mypi-worker-acceptance` Credential valueไม่ผ่าน chat, argv, child environment, auditหรือ repository

Initial operator runได้ structured `BLOCKED` ที่ stage `install` เพราะ pinned upstreamไม่มี `package-lock.json` Candidate correctionเปลี่ยนเป็น committed acceptance-only exact lockfileพร้อม digest pin + isolated `npm ci`

Startup correctionถัดมาย้าย Git worktreeออกจาก credential runtimeไป sibling private `worker-worktrees-v1` และแก้ readinessให้ bind backend tool `team_message`ร่วมกับ built-ins หลัง corrections Coordinator rerun exact runnerด้วย trusted setup receipt metadataจาก Development sessionโดยไม่อ่านหรือส่ง credential value

## Observed PASS evidence

```json
{
  "status": "PASS",
  "productionActivated": false,
  "profileDigest": "6cb191d99f13aa33d9b5c460816942501c84deed2e0cfed2bd6e2d4f3311b50b",
  "runtimeAuthorityDigest": "6d90012f628776f6f60ab88478c993452271d01e01fb1799491565e8c119937c",
  "credentialRevision": 1,
  "providerId": "openai-codex",
  "modelId": "gpt-5.4",
  "checks": {
    "realProviderArtifact": true,
    "generatedSpawnReadiness": true,
    "boundedWorktreeMutation": true,
    "noInteractiveRequests": true,
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
  → stop
  → same-name replacement with new profile/lease identities
  → cleanup + no reusable credential state
```

## Verification

- full repository suite `193/193`
- runtime/fault probes `10/10`
- patched upstream typecheck/lint PASS
- independent correction reviewหลัง real run: **PASS**, no High/Medium

## Remaining gate

ผลนี้ผ่าน generated spawn/readiness/work/stop/replacement path แต่ยังไม่เปิด production ต้องเพิ่ม forced-crash/retry reconciliation, credential rotation acceptanceและ final Phase 2–3 evidence reviewก่อน root import, releaseหรือ Default Pi switch
