# Pi Agent Teams — Node Worker Image v1

Profile นี้เป็น versioned Phase 0 candidate ภายใน incubator capabilityสำหรับ patched `pi-agent-teams` Worker มี execution adapterสองแบบ: `read-only-v1` ให้เฉพาะ scoped Readบน leader workspace และ `worktree-write-v1` ให้ scoped Read/Write/Editพร้อม Bash containerบน exact managed worktree Profileไม่ถูก root stable packageหรือ production spawn pathโหลด

## Provenance

- base: official `docker.io/library/node:24.15.0-alpine3.23`
- pinned base digest: `sha256:d1b3b4da11eefd5941e7f0b9cf17783fc99d9c6fc34884a665f40a06dbdfc94f`
- platform ที่ probe: `linux/arm64`
- Node: `24.15.0`
- observed local image digest: `sha256:8b50f94e47e5085446081411ed152f84ebe0a146a575bba1720b56821db15ff8`
- Dockerfile SHA-256: `a391813a89ea2dc8ff004f9ca80a06ada2fdce618ff5a5d06b9615fb17e6ba35`
- SPDX 2.3 SBOM: [`sbom.spdx.json`](sbom.spdx.json), SHA-256 `7fc73a1a025052371f5f801e0dfff8a6304c6b21df0b1398a78c7be8e9240961`
- upstream `tmustier/pi-agent-teams`: commit `2c1776d2a68104aaadc1c622d8a704684c7c35d6`
- [`agent-teams-overlay.patch`](agent-teams-overlay.patch): SHA-256 `600a23622a89474febaa9c4fe78686f002885a06082b9b0b9240bd3d6d3af426`
- [`worker-boundary.ts`](worker-boundary.ts): SHA-256 `b9ab4465fc4755918dc22c0fa2c06cde3ee278451dabb8e1d4d3d1b8fe0568c8`
- `extensions/worker-profile-runtime.ts`: SHA-256 `654cbeeb5b8525c4cf03feded21d20fae7c7a788aacd6de6c9098de8325d67eb`
- `extensions/worker-machine-setup.ts`: SHA-256 `b19e344c889a93533da6afb0dcd89137a909600d84bace65c9f225eec4cedb16`
- `extensions/agent-teams-worker-profile.ts`: SHA-256 `cebb9b81a5dccfed4248606c70f0a0fdaccbccfe0cde51147536596f7a75c191`
- `extensions/worker-execution-adapters.ts`: SHA-256 `34f714bb9b520663bd16e2c682bc5e38e8e232fb1ece0f9adb79138f725435c9`
- `extensions/command-policy.ts`: SHA-256 `d1696594a39fc8eba07ecea9f982abc1aaaaccc5e82abf1be6c8a250a923922f`
- `extensions/scoped-worker-tools.ts`: SHA-256 `c432f62225da80ea553966f4613e453554cde67442a7c94613ef2068421301cb`
- `capabilities/global/safety-guardrails/extensions/detector.ts`: SHA-256 `d08b3ffd251e8d0e3428c463d95698e62ee3b7330e2f3c1a4463297bf15f92ea`

Observed local digestเป็นหลักฐานของ deterministic no-provenance manifest ที่ probe ไม่ใช่ cross-platform registry contract BuildKit provenance attestationทำ manifest-list digestเปลี่ยนต่อ build จึงปิดด้วย `--provenance=false`; provenanceที่ใช้คือ pinned base digest, exact Dockerfile และ committed SBOM หาก buildใหม่ได้ digestอื่น ห้ามเปลี่ยน `profile.json` อัตโนมัติ ต้องตรวจทุก artifactและ boundary probesใหม่ก่อน

## Build

Pre-provision base imageโดย explicit operator action; runtime ห้าม pull imageเอง:

```bash
docker pull --platform linux/arm64 \
  node:24.15.0-alpine3.23

docker build --pull=false --network=none --provenance=false \
  -t mypi/pi-worker-node:24.15.0-phase0.1 \
  capabilities/incubator/delegated-orchestration/profiles/pi-agent-teams/node-worker-v1
```

ตรวจ image และสร้าง SBOM:

```bash
docker image inspect mypi/pi-worker-node:24.15.0-phase0.1

docker scout sbom \
  local://mypi/pi-worker-node:24.15.0-phase0.1 \
  --format spdx \
  --output capabilities/incubator/delegated-orchestration/profiles/pi-agent-teams/node-worker-v1/sbom.spdx.json
```

## Agent-teams overlay และ atomic profile

Overlayเป็น minimal maintained zero-context patch (`--unified=0`) ไม่ใช่การ copy/fork sourceทั้ง repository รูปแบบ zero-contextตัด whitespace-only context driftจาก upstreamและยัง bindด้วย exact commit/source-tree digest Operatorต้อง pre-provision exact upstream checkoutแล้ว applyแบบ fail-closed:

```bash
git -C <pi-agent-teams-checkout> checkout --detach \
  2c1776d2a68104aaadc1c622d8a704684c7c35d6

git -C <pi-agent-teams-checkout> apply --check --unidiff-zero \
  "$PWD/capabilities/incubator/delegated-orchestration/profiles/pi-agent-teams/node-worker-v1/agent-teams-overlay.patch"

git -C <pi-agent-teams-checkout> apply --unidiff-zero \
  "$PWD/capabilities/incubator/delegated-orchestration/profiles/pi-agent-teams/node-worker-v1/agent-teams-overlay.patch"

npm run test:agent-teams-runtime -- <pi-agent-teams-checkout>

# clone/apply sourceและติดตั้ง exact lockfileใน disposable rootsเอง; เรียก provider/modelจริง
# ต้องรับ trusted setup receiptผ่าน /mypi-worker-acceptance ไม่รับ path/digest/credential arguments
npm run test:agent-teams-acceptance
```

Opt-in runtime probeสร้าง clean worktreeเพื่อ `git apply --check` แล้ว execute missing managed env, valid-wrong digest, replaced boundary, forged/replayed marker, missing marker และ post-marker startup-race negative cases โดยไม่เรียก provider/model Probeส่ง `--session-dir` ไป temporary rootทุก childเพื่อไม่พึ่งหรือเขียน global Pi session store

Phase 0 legacy acceptanceเคยใช้ pinned checkoutและ `openai-codex/gpt-5.4-mini:low` จริงเพื่อสร้างหลักฐาน implement → review → correction → acceptance → HUMAN blocker แต่ probeรูปแบบเดิม bypass generated profile path จึงถูกแทนด้วย fail-closed blocker (exit `78`) จน one-time machine setupและ generated-profile real-provider acceptanceพร้อม ห้ามนับ historical chainเป็น acceptanceของ wiringใหม่นี้

`extensions/agent-teams-profile.ts` ตรวจ Git `HEAD`, exact entry digest และ deterministic digestของ source tree `extensions/teams/` ทั้งชุดก่อนสร้าง leader environmentแบบ allowlistและ injectพร้อมกัน:

- exact patched upstream entry/source tree
- exact read-only tools `read` + backend-owned `team_message` บน leader workspace
- exact worktree-write tools `read,bash,edit,write` + backend-owned `team_message` บน managed worktree
- exact `worker-boundary.ts` และ pinned execution-adapter module
- managed Worker ceiling 1–3
- isolated teams root

Patched leader require managed profile id, derived boundary/runtime contract digests, exact boundary/profile/runtime/execution-adapter module hashes, private runtime/default-profile separation, pinned provider/model/thinking/key authority, execution modes, ceiling และ patched-entry/source identityครบตั้งแต่ extension factory; missing/partial/malformed envทำให้ extension loadล้มเหลวแทน fallback แล้ว freezeค่าครั้งเดียว ไม่อ่าน ambient environmentใหม่ทุก spawn

Spawn candidateใช้ adapterออก signed single-use credential leaseจาก private source, atomic claim/materialize generated Worker profileก่อน `TeammateRpc.start` และส่ง exact generated argv/environment เท่านั้น Readiness bind random per-spawn nonce, lease ID, generated profile digest, runtime contract, team/Worker identity, trusted boundary/source hashes, exact tools/env, execution adapter/workspace modeและ ceiling Cleanupถูก serializeต่อ Workerและทำเมื่อ startup verification, stopหรือ process close; failureไม่ถูก suppress

## Runtime contract

Runtime ต้องเรียก imageด้วย immutable digestและ flagsอย่างน้อย:

```text
--pull never
--network none
--read-only
--cap-drop ALL
--security-opt no-new-privileges
--pids-limit 64
--memory 512m
--cpus 1
--tmpfs /tmp:rw,noexec,nosuid,size=64m
--mount type=bind,src=<worker-worktree>,dst=/workspace
--workdir /workspace
```

ห้าม mount host HOME, host `/tmp`, Docker socket หรือ pathนอก worktree Image ใช้ non-root user `node`

## Verified Phase 0 behavior

เมื่อเรียกด้วย image digestและ flagsข้างต้น:

- worktree write: `IMAGE_ROUTINE_OK`
- parent environment marker: `ENV_ABSENT`
- host `/tmp` fixture: `HOST_READ_ISOLATED`
- root/external write: `OUTSIDE_DENIED`
- network via Node `fetch`: `NETWORK_DENIED`
- `npm test`: `TEST_OK`
- Node runtime: `v24.15.0`
- patched agent-teams single Worker และ ceiling-2/multi-worker replacement probesผ่านบน imageเดียวกัน
- atomic profile runtime: routine `ROUTINE_OK`, integrated `npm test` → `TEST_OK`, parent env absent, network denied, host read isolated
- Bash secret/external-write fixturesถูก blockก่อน execution; `rm -rf /workspace`ได้ structured `DENY/workspace-root-destruction`
- scoped direct tools: routine writeผ่าน; `.env` read/write, `/etc/hosts`, external write/edit และ symlink escapeถูก deny
- observed verifierผ่าน `verified: true`, mismatches `[]`; structured readinessและ nonce/session/boundary identityตรง requested
- committed opt-in runtime probeผ่าน apply-check + negative/startup cases `10/10`: missing env, wrong contract, missing/stale adapter, Default-linked runtime, replaced boundary, exact environmentไม่รับ ambient `LC_*` secret, forged/replayed marker, missing marker และ post-marker process exit
- additional fault probes: provider/model unavailableไม่ register Worker; missing SBOM fail; Docker daemon/image unavailableออก code `78`
- clean pinned checkoutผ่าน provenance verifier; source driftที่ pathเดิม fail closed; `git push`ได้ `HUMAN/remote-mutation` blockerโดยไม่มี dialog
- historical Phase 0 Pi-native chainผ่าน tasks `5/5`, artifacts `7/7`, user approvals `0`, routine dialogs `0`, HUMAN side effects `0`; หลักฐานนี้ไม่ใช้แทน generated-path acceptance
- generated-path real-provider acceptanceวัด exact read-only/worktree-write adapters, artifact/readiness/bounded mutation, Worker/leader crash, observed interactive requests `0`, stop/replacement cleanupและ no reusable credential stateครบ 13 checks

## Boundaries และข้อจำกัด

- Image มี Node/npm/sh เท่านั้น ไม่รับประกัน Git, Bash, ripgrep หรือ project-specific native toolchain
- Container mount worktreeทั้งก้อน จึงไม่ซ่อนไฟล์ secret ที่ถูกสร้างภายใน worktreeเอง `worker-boundary.ts` จึงบังคับ secret/data policyก่อน Docker execution และ clean worktreeยังเป็น required layer
- `task completed` จาก agent-teamsไม่เท่ากับ accepted; My Pi ต้อง collect artifact/diff/testsเอง
- Docker daemonและ exact local imageเป็น trusted fail-closed dependencies หาก preflightไม่ผ่านต้องไม่ register Worker
- Scoped direct operations canonicalizeและ reject symlink escapeก่อน filesystem callแต่ไม่ใช่ OS sandboxและยังมี TOCTOU limitation; strong direct-tool isolationต้องใช้ VM/container filesystem backendในอนาคต
- Profile package/overlay/generated-profile adapter, one-time machine setup, forced-crash/rotation/leader-loss และ dual execution-adapter real-provider acceptanceผ่านแล้ว แต่ productionยัง disabledและไม่มี root production importจน final Phase 2–3 evidence reviewครบ
