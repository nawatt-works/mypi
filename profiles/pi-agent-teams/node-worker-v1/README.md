# Pi Agent Teams — Node Worker Image v1

Profile นี้เป็น versioned Phase 0 candidate สำหรับ patched `pi-agent-teams` Worker: direct Read/Write/Editใช้ scoped host operations ส่วน Bashใช้ containerที่เห็นเฉพาะ Worker worktree ยังไม่ใช่ package installและไม่ถูกโหลดโดย production spawn path

## Provenance

- base: official `docker.io/library/node:24.15.0-alpine3.23`
- pinned base digest: `sha256:d1b3b4da11eefd5941e7f0b9cf17783fc99d9c6fc34884a665f40a06dbdfc94f`
- platform ที่ probe: `linux/arm64`
- Node: `24.15.0`
- observed local image digest: `sha256:8b50f94e47e5085446081411ed152f84ebe0a146a575bba1720b56821db15ff8`
- Dockerfile SHA-256: `a391813a89ea2dc8ff004f9ca80a06ada2fdce618ff5a5d06b9615fb17e6ba35`
- SPDX 2.3 SBOM: [`sbom.spdx.json`](sbom.spdx.json), SHA-256 `7fc73a1a025052371f5f801e0dfff8a6304c6b21df0b1398a78c7be8e9240961`
- upstream `tmustier/pi-agent-teams`: commit `2c1776d2a68104aaadc1c622d8a704684c7c35d6`
- [`agent-teams-overlay.patch`](agent-teams-overlay.patch): SHA-256 `77b0a03b07346372db94ceb2b28115cdb8f5b700a3cd117a79d9e4ff8a55abad`
- [`worker-boundary.ts`](worker-boundary.ts): SHA-256 `41ee6b8d62b5f6ac38435da14649cbd67c23b7886494b648b22633d4f29b5e0d`
- `extensions/command-policy.ts`: SHA-256 `d1696594a39fc8eba07ecea9f982abc1aaaaccc5e82abf1be6c8a250a923922f`
- `extensions/scoped-worker-tools.ts`: SHA-256 `c9b5cf7796bf8469a28e514ecbdbbe82ee0f61a26da83532792d4c071284dcee`

Observed local digestเป็นหลักฐานของ deterministic no-provenance manifest ที่ probe ไม่ใช่ cross-platform registry contract BuildKit provenance attestationทำ manifest-list digestเปลี่ยนต่อ build จึงปิดด้วย `--provenance=false`; provenanceที่ใช้คือ pinned base digest, exact Dockerfile และ committed SBOM หาก buildใหม่ได้ digestอื่น ห้ามเปลี่ยน `profile.json` อัตโนมัติ ต้องตรวจทุก artifactและ boundary probesใหม่ก่อน

## Build

Pre-provision base imageโดย explicit operator action; runtime ห้าม pull imageเอง:

```bash
docker pull --platform linux/arm64 \
  node:24.15.0-alpine3.23

docker build --pull=false --network=none --provenance=false \
  -t mypi/pi-worker-node:24.15.0-phase0.1 \
  profiles/pi-agent-teams/node-worker-v1
```

ตรวจ image และสร้าง SBOM:

```bash
docker image inspect mypi/pi-worker-node:24.15.0-phase0.1

docker scout sbom \
  local://mypi/pi-worker-node:24.15.0-phase0.1 \
  --format spdx \
  --output profiles/pi-agent-teams/node-worker-v1/sbom.spdx.json
```

## Agent-teams overlay และ atomic profile

Overlayเป็น minimal maintained patch ไม่ใช่การ copy/fork sourceทั้ง repository Operatorต้อง pre-provision exact upstream checkoutแล้ว applyแบบ fail-closed:

```bash
git -C <pi-agent-teams-checkout> checkout --detach \
  2c1776d2a68104aaadc1c622d8a704684c7c35d6

git -C <pi-agent-teams-checkout> apply --check \
  "$PWD/profiles/pi-agent-teams/node-worker-v1/agent-teams-overlay.patch"

git -C <pi-agent-teams-checkout> apply \
  "$PWD/profiles/pi-agent-teams/node-worker-v1/agent-teams-overlay.patch"
```

`extensions/agent-teams-profile.ts` สร้าง leader environmentแบบ allowlistและ injectพร้อมกัน:

- exact patched upstream entry
- exact built-in tools `read,bash,edit,write` + backend-owned `team_message`
- exact `worker-boundary.ts`
- forced worktree
- managed Worker ceiling 1–3
- isolated teams root

Patched leader freezeค่าของ child profileครั้งเดียวตอน extension factoryเริ่ม ไม่อ่าน ambient environmentใหม่ทุก spawn Child RPCบันทึกเฉพาะ observed environment key namesสำหรับ verificationโดยไม่บันทึก values

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
- observed verifierผ่าน `verified: true`, mismatches `[]`

## Boundaries และข้อจำกัด

- Image มี Node/npm/sh เท่านั้น ไม่รับประกัน Git, Bash, ripgrep หรือ project-specific native toolchain
- Container mount worktreeทั้งก้อน จึงไม่ซ่อนไฟล์ secret ที่ถูกสร้างภายใน worktreeเอง `worker-boundary.ts` จึงบังคับ secret/data policyก่อน Docker execution และ clean worktreeยังเป็น required layer
- `task completed` จาก agent-teamsไม่เท่ากับ accepted; My Pi ต้อง collect artifact/diff/testsเอง
- Docker daemonและ exact local imageเป็น trusted fail-closed dependencies หาก preflightไม่ผ่านต้องไม่ register Worker
- Scoped direct operations canonicalizeและ reject symlink escapeก่อน filesystem callแต่ไม่ใช่ OS sandboxและยังมี TOCTOU limitation; strong direct-tool isolationต้องใช้ VM/container filesystem backendในอนาคต
- Profile package/overlay/atomic builderถูก wireและ runtime-probeแล้วแต่ยัง disabled by default ไม่ production-readyจน image/daemon/provider faults, artifact acceptance และ implement→review→correction chainผ่านครบ
