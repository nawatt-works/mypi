# Independent security review — agent-teams atomic overlay/profile

วันที่รีวิว: 2026-08-29
รีวิวต่อ commit: `ead8778` เทียบ `caf8aae`
producer repo ที่ตรวจ: `/Users/developer/my-project/my-pi`
artifact ที่ส่งมอบ: รายงานนี้เท่านั้น

## Verdict

**PASS-WITH-FOLLOWUPS**

สรุปสั้น:
- จุดที่ดีและผ่าน: production wiring ยัง disabled, direct-path guard เปิดเผย TOCTOU limitation ตรงกับ implementation, artifact/image verifier และ startup preflight มีแนว fail-closed ชัด, exact built-in/backend tool set ถูกประกาศคงที่ใน profile/boundary
- จุดที่ต้องแก้ก่อนเปิดใช้ candidate นี้จริง: ยังมี **ช่อง fail-open ใน overlay runtime เมื่อ env/profile injection หายหรือไม่ครบ** และยังมี **ช่อง provenance gap สำหรับ patched upstream entry** เพราะ verifier/hash ปัจจุบันไม่ผูกกับ content ของ entry file ที่ถูกโหลดจริง

> ผลรีวิวนี้ตีความตามสภาพปัจจุบันที่ README/plan ระบุชัดว่า candidate นี้ **ยังไม่ถูกโหลดใน production spawn path**. ถ้าเปิดใช้ก่อนแก้ follow-ups ด้านล่าง ระดับความเสี่ยงจะเพิ่มทันที

## ขอบเขตที่ตรวจ

ประเด็นตาม assignment:
- minimal overlay provenance / applyability
- frozen profile / environment behavior
- exact built-in / backend tools
- scoped direct path / symlink / secret / `.git` enforcement และ TOCTOU claims
- Worker boundary artifact / image / Docker / command / data policy
- builder / verifier fail-closed behavior
- runtime evidence claims
- confirmation production remains disabled

## คำสั่งที่ใช้ และผลสรุป

### 1) diff ที่ตรวจ

```sh
cd /Users/developer/my-project/my-pi
git diff --stat caf8aae..ead8778
git diff --name-only caf8aae..ead8778
```

ผลย่อ:
- เปลี่ยน 14 files
- code หลักที่เพิ่มคือ:
  - `extensions/agent-teams-profile.ts`
  - `extensions/scoped-worker-tools.ts`
  - `profiles/pi-agent-teams/node-worker-v1/agent-teams-overlay.patch`
  - `profiles/pi-agent-teams/node-worker-v1/worker-boundary.ts`
  - tests 2 files

### 2) read-only tests ที่ rerun เอง

```sh
cd /Users/developer/my-project/my-pi
node --test tests/agent-teams-profile.test.ts tests/scoped-worker-tools.test.ts tests/command-policy.test.ts
```

ผล:

```text
ℹ tests 24
ℹ pass 24
ℹ fail 0
```

สิ่งที่ผลนี้ยืนยันได้:
- artifact hash checks ใน profile/boundary ยังผ่าน
- command-policy adversarial cases ผ่าน
- scoped direct path checks ผ่านในกรณี unit/integration ที่มีอยู่

สิ่งที่ผลนี้ **ยังไม่ยืนยันได้เอง**:
- live patched `pi-agent-teams` runtime บน upstream checkout จริง
- live Docker/daemon/image failure chain
- implement→review→correction chain เต็ม

### 3) ตรวจว่า production wiring ยังไม่ถูกเปิด

```sh
cd /Users/developer/my-project/my-pi
rg -n "buildAgentTeamsProfile|verifyAgentTeamsProfile|createScopedPathValidator|createScopedToolOperations|agentTeamsWorkerBoundary|pi-agent-teams-docker-strong-v1" -g '!**/node_modules/**'
```

ผลสำคัญ:
- references ของ `buildAgentTeamsProfile` / `verifyAgentTeamsProfile` อยู่ใน `extensions/agent-teams-profile.ts` และ tests/doc เท่านั้น
- `agentTeamsWorkerBoundary` อยู่ที่ `profiles/pi-agent-teams/node-worker-v1/worker-boundary.ts`
- ไม่พบการ import เข้าสาย production orchestration/spawn ปัจจุบัน

## Findings (เรียงตามความรุนแรง)

### 1) [Medium] provenance ของ `patchedTeamsEntryPath` ยังไม่ถูก verify ตามระดับที่เอกสารอ้าง

**ผลกระทบ**
- ตอนนี้ระบบ verify hash ของ overlay patch / worker boundary / command policy / scoped tools / Dockerfile / SBOM แต่ **ไม่ได้ verify content ของ entry file ที่ child โหลดจริงผ่าน `-e`**
- ถ้า file ที่ path เดิมถูกสลับ content หลัง build profile หรือ caller ส่ง path ที่เป็นไฟล์อื่นตั้งแต่แรก verifier ปัจจุบันยังอาจผ่านได้
- เมื่อ candidate ถูกเปิดใช้จริง ช่องนี้จะทำให้คำอ้าง “exact patched upstream entry” อ่อนกว่าการบังคับใช้จริง

**หลักฐาน**
- README อ้างว่า builder inject “exact patched upstream entry”: `profiles/pi-agent-teams/node-worker-v1/README.md:61-68`
- builder ตรวจเพียง absolute path / exists / realpath ของ entry file แต่ไม่ hash content และไม่ผูกกับ git tree ของ upstream checkout: `extensions/agent-teams-profile.ts:155-163`
- `profileDigest` hash จาก object ที่มี path string และ artifact digests อื่น ๆ แต่ไม่มี digest ของ entry file content: `extensions/agent-teams-profile.ts:175-195`
- observed verifier เปรียบเทียบเพียง path list ของ `childExtensions`: `extensions/agent-teams-profile.ts:216-219`
- runtime artifact verifier hash เฉพาะ Dockerfile/SBOM/worker-boundary/command-policy/scoped-tools/overlay patch แต่ **ไม่ hash patched teams entry**: `profiles/pi-agent-teams/node-worker-v1/worker-boundary.ts:88-95`
- tests ปัจจุบันยืนยัน hash artifacts ข้างต้น แต่ไม่ยืนยัน hash ของ patched entry content: `tests/agent-teams-profile.test.ts:45-48,50-82,109-170`

**ข้อสรุป**
- คำอ้างเรื่อง provenance ตอนนี้ยังเป็น **partial provenance** ไม่ใช่ end-to-end provenance ของ code entry ที่ execute จริง

**Required correction**
1. เพิ่ม digest/identity ของ patched teams entry ลงใน profile artifact และ verify ใน runtime ก่อน ready
2. หรือ verify จาก upstream checkout/git tree ที่ pin ไว้แบบ exact path + blob id
3. เพิ่ม negative tests ว่า entry content drift ที่ path เดิมต้อง fail closed

---

### 2) [Medium] overlay runtime ยัง fail-open ถ้า profile env injection หายหรือไม่ครบ

**ผลกระทบ**
- overlay patch อ่าน profile จาก env แล้ว default เป็นค่ากว้าง/ว่าง แทนที่จะปฏิเสธทันที
- ถ้า `PI_TEAMS_CHILD_EXTENSIONS` หาย child อาจ start โดย **ไม่มี `worker-boundary.ts` เลย**
- ถ้า `PI_TEAMS_CHILD_TOOLS` หาย child จะ fallback ไปใช้ parent active tools ที่ผ่าน allowlist ภายใน patch
- ถ้า `PI_TEAMS_FORCE_WORKTREE` หาย `workspaceMode` จะไม่ถูก force เป็น worktree
- ถ้า `PI_TEAMS_MAX_WORKERS` หาย ceiling จะกลายเป็น `null` แล้วไม่จำกัด
- startup verification ปัจจุบันยืนยันเพียง RPC readiness + `setSessionName()` ไม่ได้ยืนยันว่า boundary/profile ที่ต้องการถูกโหลดจริง

**หลักฐาน**
- overlay freeze `childProfile` จาก env โดย default เป็น false/undefined/empty string: `profiles/pi-agent-teams/node-worker-v1/agent-teams-overlay.patch:69-80`
- force worktree เกิดเฉพาะเมื่อ env flag ตรง: `profiles/pi-agent-teams/node-worker-v1/agent-teams-overlay.patch:127-130`
- max-workers ใช้ `childProfile.maxWorkers`; ถ้าไม่มี env จะเข้า `limit === null` แล้ว allow: `profiles/pi-agent-teams/node-worker-v1/agent-teams-overlay.patch:138-147,490-523`
- tools fallback ไป `pi.getActiveTools()` เมื่อ `childProfile.tools` ไม่มี: `profiles/pi-agent-teams/node-worker-v1/agent-teams-overlay.patch:164-181`
- extension loading ไม่บังคับว่าต้องมี boundary extension; ถ้า `extraExtensions` ว่าง จะยังโหลดแค่ `teamsEntry`: `profiles/pi-agent-teams/node-worker-v1/agent-teams-overlay.patch:188-196`
- startup verification หลัง spawn คือ RPC ready handshake + `setSessionName()` เท่านั้น: `profiles/pi-agent-teams/node-worker-v1/agent-teams-overlay.patch:205-239,371-384`
- README อ้าง fail-closed/atomic profile behavior: `profiles/pi-agent-teams/node-worker-v1/README.md:48-70,104-107`

**ข้อสรุป**
- profile builder/verifier ใน repo ดีขึ้นมาก แต่ overlay ที่จะใช้กับ upstream runtime ยังไม่ได้บังคับ invariants นี้แบบ fail-closed ด้วยตัวเอง
- ในสภาพปัจจุบันความเสี่ยงถูกลดทอนเพราะ candidate ยัง disabled; แต่ finding นี้ต้องปิดก่อน activation

**Required correction**
1. ใน overlay/adapter ให้ reject ทันทีเมื่อ `PI_TEAMS_CHILD_EXTENSIONS`, `PI_TEAMS_CHILD_TOOLS`, `PI_TEAMS_FORCE_WORKTREE`, `PI_TEAMS_MAX_WORKERS` หายหรือ parse ไม่ผ่าน
2. บังคับว่าต้องมี boundary extension exact path/digest ก่อน spawn child
3. เพิ่ม post-start verification RPC/state ที่ยืนยัน observed env keys, tool set, loaded extensions, forceWorktree, และ maxWorkers ตรงกับ requested profile ไม่ใช่แค่ session naming
4. เพิ่ม regression tests สำหรับ missing/partial env แล้วต้อง fail closed

## จุดที่ตรวจแล้วไม่พบปัญหาใหม่ระดับ finding

### A) exact built-in/backend tools ถูกตรึงชัดใน candidate profile

หลักฐาน:
- builder กำหนด built-ins และ backend tool คงที่: `extensions/agent-teams-profile.ts:11-12,184-185`
- worker profile manifest ระบุ `tools=[read,bash,edit,write]` และ `backendTools=[team_message]`: `profiles/pi-agent-teams/node-worker-v1/profile.json:38-43`
- runtime boundary reject ถ้า tool set ใน profile manifest เปลี่ยน: `profiles/pi-agent-teams/node-worker-v1/worker-boundary.ts:81-84`

สรุป:
- ในชั้น candidate artifact/boundary คำอ้างเรื่อง exact tool set ตรงกับ implementation
- แต่ยังขึ้นกับ follow-up finding #2 ถ้าจะยืนยันว่า overlay runtime โหลด profile env ครบจริงทุกครั้ง

### B) scoped direct path/symlink/secret/`.git` enforcement ตรงกับที่ code อ้าง แต่ TOCTOU limitation เป็นของจริงและถูกเปิดเผยตรงไปตรงมา

หลักฐาน:
- validator ตรวจ absolute path, outside-worktree, protected segment `.git`, sensitive path, symlink escape และ canonical escape ก่อน IO: `extensions/scoped-worker-tools.ts:56-96`
- read/write/edit operations ใช้ validator ก่อน call FS ทุกครั้ง: `extensions/scoped-worker-tools.ts:118-149`
- tests ครอบคลุม external path, symlink escape, internal symlink, `.git`, `.env`, canonical sensitive path และ relative path: `tests/scoped-worker-tools.test.ts:19-75`
- README ระบุชัดว่านี่เป็น host-operation guard และยังมี TOCTOU limitation ไม่ใช่ OS sandbox: `README.md:56-58`, `profiles/pi-agent-teams/node-worker-v1/README.md:115`

ข้อสังเกต:
- implementation validate แล้วค่อยใช้ original path ใน FS call (`extensions/scoped-worker-tools.ts:119-149`) จึงมี race window จริง
- แต่เอกสารปัจจุบันไม่ได้ overclaim เกิน implementation ในจุดนี้

### C) Worker boundary / builder / verifier มี fail-closed shape ที่ดีในหลายจุด

หลักฐาน:
- profile artifact pin schema/status/profile id/upstream commit: `extensions/agent-teams-profile.ts:124-130`
- builder reject bad commit, missing path, maxWorkers นอกช่วง 1..3: `extensions/agent-teams-profile.ts:151-160`; tests `tests/agent-teams-profile.test.ts:84-107`
- verifier fail เมื่อ digest/readiness/boundary booleans ไม่ครบ: `extensions/agent-teams-profile.ts:203-238`; tests `tests/agent-teams-profile.test.ts:109-170`
- worker boundary preflight hash และ Docker identity ก่อน ready; failure ทำ `process.exit(78)`: `profiles/pi-agent-teams/node-worker-v1/worker-boundary.ts:88-119,266-274`
- bash execution block command-policy และ data-policy ก่อนรันจริง: `profiles/pi-agent-teams/node-worker-v1/worker-boundary.ts:237-262`

สรุป:
- fail-closed intent และ implementation ใน candidate layer ค่อนข้างชัด
- ข้ออ่อนหลักยังอยู่ที่ provenance gap และ missing-env fail-open ตาม findings ด้านบน

### D) confirmation production remains disabled — ตรวจแล้วสอดคล้องกับโค้ดปัจจุบัน

หลักฐาน:
- root README ระบุชัดว่า candidate profile ยัง disabled by default และไม่ถูกโหลดใน production spawn: `README.md:59-61,79-81`
- active plan ระบุว่ายัง disabled และห้ามเปลี่ยน production behavior ก่อน independent review/fault chain: `docs/plans/delegated-autonomy-coordinator.md:186,524-527,798-803`
- search ใน repo ไม่พบการ import builder/verifier/boundary เข้าสาย production orchestration ปัจจุบัน (ดู command `rg -n ...` ในส่วน Commands)

สรุป:
- ณ commit นี้ไม่พบหลักฐานว่ามีการเปิด confirmation-bypassing production path ใหม่
- ความเสี่ยงของ findings จึงยังถูกจำกัดอยู่ใน candidate artifact/patch layer

## Runtime evidence claims

สิ่งที่ฉัน **ยืนยันเองจากการ rerun ได้**:
- `tests/agent-teams-profile.test.ts`, `tests/scoped-worker-tools.test.ts`, `tests/command-policy.test.ts` ผ่านรวม 24 tests
- artifact hashes ที่ worker-boundary ตรวจยังสอดคล้องกับไฟล์ใน repo ปัจจุบัน

สิ่งที่ฉัน **ไม่ได้ยืนยันซ้ำเองในการรีวิวนี้**:
- Docker runtime probes แบบ live บน patched upstream checkout
- single/direct/multi replacement runtime ที่อ้างใน docs
- provider/image/daemon fault chain

การอ่าน claims ฝั่ง docs:
- `docs/README.md:35`
- `docs/plans/delegated-autonomy-coordinator.md:524-527`
- `profiles/pi-agent-teams/node-worker-v1/README.md:92-107`

สรุป:
- claims ฝั่ง runtime ตอนนี้ยังเป็น **documented prior evidence + targeted repo tests** ไม่ใช่ fully reproduced evidence จากการรีวิวนี้
- ไม่พอเป็น finding ใหม่เพราะเอกสารยังคงบอกว่าคandidate นี้ไม่ production-ready และ exact next step คือ independent review + fault chain

## Final recommendation

ให้ **คงสถานะ PASS-WITH-FOLLOWUPS และห้าม activate candidate นี้** จนกว่าจะปิดอย่างน้อย 2 เรื่องนี้:
1. verify patched teams entry แบบ end-to-end provenance
2. เปลี่ยน overlay runtime ให้ missing/partial profile env fail closed พร้อม post-start verification ของ observed profile

หลังแก้แล้วควร rerun อย่างน้อย:
- negative tests สำหรับ env/profile omission/drift
- live patched upstream startup where boundary omission must fail
- daemon/image fault probes
- implement → independent-review → correction chain เต็ม
