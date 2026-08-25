# Pi Coordinator บน Herdr

> **Status:** active<br>
> **Created:** 2026-08-25 09:19<br>
> **Updated:** 2026-08-25 11:12<br>
> **Purpose:** พัฒนา Coordinator layer ที่ให้ Pi สร้างและควบคุม Workers ผ่าน Herdr โดยเริ่มจาก probe เพื่อวัดว่า runtime primitive เชื่อถือได้จริงแค่ไหนก่อนเขียน extension

## Context

`docs/notes/runtime-negotiated-herdr-orchestration.md` กำหนดข้อกำหนดของ Pi Coordinator ที่ใช้ Herdr ควบคุม AI harness workers ไว้แล้ว และพักไว้รอผู้ใช้ตัดสินใจ ผู้ใช้อนุมัติให้พัฒนาเมื่อ 2026-08-25 พร้อมตัดสินสองเรื่องที่ค้าง คือ เขียน mechanism layer เองโดยใช้ `pi-herdr-subagents` เป็น reference เท่านั้น และให้ทำ probe phase ก่อน implementation

การตรวจ runtime จริงก่อนวางแผนพบว่าข้อสมมติสำคัญสามข้อของโน้ตยังไม่เคยถูกวัด และหนึ่งในนั้นขัดกับพฤติกรรมที่ Herdr ระบุไว้เองใน CLI help คือ `herdr agent prompt --wait` ไม่ track turn จึงใช้ยืนยันการเสร็จงานของ Worker ไม่ได้

นอกจากนี้ extension ที่ติดตั้ง global อยู่แล้วจะถูกโหลดเข้า Worker ทุกตัวที่เป็น Pi ซึ่งทำให้เกิด conflict ที่ต้องแก้ก่อน ไม่ใช่หลัง implementation

## Approach

- แยกงานเป็นสองชั้น คือ extension เป็น mechanism และ skill เป็น judgment เพื่อให้เกณฑ์การ delegate ปรับได้โดยไม่ต้องแก้ TypeScript
- ไม่เขียน CLI wrapper ของ Herdr ซ้ำ ให้แยก client ออกจาก `herdr-integration.ts` แล้วใช้ร่วมกัน
- ไม่สร้าง workflow engine อ้างอิงกับ `herdr --skill` ซึ่งครอบคลุมวิธีสั่ง Herdr อยู่แล้ว และให้ Coordinator รับผิดชอบเฉพาะส่วนที่ skill นั้นไม่ได้ทำ ได้แก่ delegation policy, ownership, registry, requested/observed identity, approval และ verification
- เพิ่ม worker mode ผ่าน Pi flag เพื่อให้ package เดียวรับได้ทั้ง session ปกติของผู้ใช้และ Worker ที่ Coordinator สร้าง โดยไม่ต้องแยก repository
- ยืนยันการเสร็จงานจากหลักฐานจริง ไม่ใช้ lifecycle state หรือข้อความสรุปของ Worker เป็นหลักฐานเดียว
- เริ่มจาก serial worker เดียว แล้วเพิ่ม assurance, worktree และ parallel ตามลำดับ

## Files to modify

- `extensions/orchestration-registry.ts` — runtime task/worker mapping และ identity reconciliation (ใหม่)
- `extensions/orchestration.ts` — Coordinator tools และ approval gate (ใหม่)
- `extensions/herdr-client.ts` — Herdr CLI client ที่แยกออกมาใช้ร่วมกัน (ใหม่)
- `extensions/worker-mode.ts` — environment signal และ helper `isWorkerMode` (ใหม่)
- `extensions/herdr-integration.ts` — ใช้ client ที่แยกออกมา และขยาย integration check ให้ครอบคลุม kind อื่น
- `extensions/steering-choice.ts` — ปิดเมื่ออยู่ใน worker mode
- `extensions/planning-workflow.ts` — worker mode ใช้ session-internal plan เท่านั้น
- `extensions/dependency-update-notifier.ts` — ปิดเมื่ออยู่ใน worker mode
- `skills/` — skill สำหรับ delegation judgment และ handoff contract (ใหม่)
- `package.json`, `README.md`, `AGENTS.md`
- `tests/orchestration.test.ts`, `tests/worker-mode.test.ts` (ใหม่)
- `docs/notes/runtime-negotiated-herdr-orchestration.md`, `docs/README.md`

## Reuse

- `herdr --skill` เป็นแหล่งอ้างอิงวิธีสั่ง Herdr และครอบคลุม pane split, `agent start`, `prompt --wait`, `wait --until`, `read`, opaque IDs และ caller context อยู่แล้ว
- `withHerdrBlocked` และ `herdr:blocked` bridge ใน `herdr-integration.ts` ทำให้ Coordinator เห็นได้เมื่อ Worker หยุดรอผู้ใช้
- `@juicesharp/rpiv-ask-user-question` เป็น approval UI ของ dry-run และ spawn gate โดยไม่ต้องสร้าง UI ใหม่
- Pi `appendEntry` และ `session_start` restoration ตามรูปแบบที่ `planning-workflow.ts` ใช้อยู่
- Pi `sendMessage` พร้อม `deliverAs: "steer"` สำหรับส่งผลของ Worker กลับเข้า turn โดยไม่บล็อกผู้ใช้
- `herdr pane send-text` + `send-keys enter` เพื่อ export `MYPI_WORKER=1` เข้า shell ของ pane ก่อน `herdr agent start` ซึ่งยังคงให้ detection และ identity guarantee ตามเดิม
- `pi-herdr-subagents` ใช้อ่านเป็น reference เรื่อง stall handling และ interrupt เท่านั้น ไม่นำมาเป็น dependency

## Risks

- `agent prompt --wait` ไม่ track turn และอาจ match การจบ turn เดิมที่ค้างอยู่ จึงต้องยืนยันด้วย artifact, git ref และ `revision`/`state_change_seq` ประกอบกัน
- prompt ที่ส่งจากสถานะ non-working ต้องเห็น state เปลี่ยนภายใน 5000ms มิฉะนั้นได้ `agent_prompt_stalled` ซึ่ง Coordinator ต้องแยกจาก timeout จริง
- `steering-choice.ts` แทนที่พฤติกรรม Enter เมื่อ agent ไม่ idle ทำให้ correction ที่ส่งขณะ Worker ยัง working ไปเปิด dialog แทนการส่งข้อความ และ probe ยืนยันว่าล้มเหลวแบบเงียบ คือ `prompt --wait` คืน `rc=0` status `idle` โดย `state_change_seq` ไม่ขยับ ไม่ใช่ `blocked`
- Plannotator ใน Worker อาจเปิด browser เองระหว่างทำงาน
- `unknown` ไม่ได้พิสูจน์ว่างานเสร็จ และ `idle` กับ `done` ต่างกันที่การถูกเห็นใน UI ซึ่ง CLI read ไม่นับ
- Worker kind ที่ยังไม่ได้ติดตั้ง lifecycle integration จะไม่มี `agent_session` ทำให้ยืนยัน identity ได้แค่ระดับ screen detection
- ชื่อ agent ต้องตรง `[a-z][a-z0-9_-]{0,31}` และ unique ในหมู่ agent ที่ยังมีชีวิต จึงต้องมีกฎตั้งชื่อและการเก็บกวาด
- worktree ที่มี commit ค้างอาจลบไม่ได้ จึงห้ามลบอัตโนมัติ
- Herdr ไม่ใช่ security boundary หาก Workers มี trust level ต่างกันต้องใช้ container, VM หรือ OS user แยก

## Decisions

- เขียน mechanism layer เอง ใช้ `pi-herdr-subagents` เป็น reference ไม่เป็น dependency
- ทำ Phase 0 probe ก่อน implementation และให้ผลของ probe เป็นเงื่อนไขกำหนด scope ของ Phase 1
- ไม่แยก repository สำหรับ orchestration ใช้ worker mode ผ่าน environment `MYPI_WORKER=1` แทน โดย session ปกติต้องไม่เห็นความเปลี่ยนแปลง
- Worker ที่เป็น Pi ยังคง guardrails เดิมและยังถามอนุมัติเหมือนเดิม ห้าม auto-approve และห้าม auto-deny; Coordinator ต้อง surface สถานะ blocked พร้อม pane ID ให้ผู้ใช้
- ปิด `steering-choice`, Plannotator และ dependency notifier ใน worker mode
- Worker ใช้ session-internal plan เท่านั้น เว้นแต่ Coordinator ระบุ `filePath` มาใน task
- MVP ไม่มีไฟล์ config ใช้ default ในโค้ดและมี command แสดง effective value; เพิ่ม user/project override ภายหลังเมื่อรู้ว่าต้องปรับอะไรจริง
- runtime mapping เก็บใน session ผ่าน `appendEntry` และ rebuild จาก `herdr agent list` ตอน `session_start` โดยให้ Herdr เป็น source of truth ของ process
- Coordinator เก็บ artifact เป็น reference เท่านั้น ห้ามแตะเนื้อ artifact ตาม `AGENTS.md`
- ต้องอนุมัติทุก Worker ก่อน spawn ใน MVP และทุก spawn ต้องผ่าน preview ที่บังคับใน extension ไม่ใช่ในพรอมป์
- `allowed_harnesses` ต้อง validate กับ kind enum จริงของ Herdr ตอน runtime ไม่ hardcode รายชื่อ
- Coordinator สร้าง worktree ได้เมื่อได้รับอนุมัติ แต่ไม่ลบอัตโนมัติ
- MVP เป็น serial อย่างเดียว เปิด parallel เมื่อบังคับ disjoint write scope ได้จริง
- ไม่ติดตั้ง lifecycle integration ของ kind อื่นอัตโนมัติ แต่ต้องเตือนตอนจะ spawn Worker ของ kind ที่ integration ขาด

## Steps

### Phase 0 — Probe (ทิ้งได้ ไม่แตะ `extensions/`)

- [x] เขียน probe script ใน scratchpad ที่ทำ serial worker เดียว: pane split, `agent start`, `prompt`, `wait`, `read`, ตรวจ artifact
- [x] วัด 1: `agent prompt --wait` ให้ false-complete บ่อยแค่ไหนเทียบกับ artifact จริงและ `state_change_seq`
- [x] วัด 2: `agent_prompt_stalled` เกิดในเงื่อนไขใดบ้างและแยกจาก timeout จริงได้อย่างไร
- [x] วัด 3: `blocked` จาก guardrails ของ Worker เห็นจาก Coordinator จริงหรือไม่ และ label ที่ bridge ไปพอต่อการตัดสินใจหรือไม่
- [x] วัด 4: `agent_session` ใช้ยืนยัน identity ได้จริงหรือไม่ เทียบ kind ที่มีและไม่มี lifecycle integration
- [x] วัด 5: worktree create/remove เมื่อมี commit ค้าง
- [x] วัด 6: ส่ง correction ขณะ Worker `working` เพื่อยืนยัน deadlock จาก `steering-choice`
- [x] Verification: สรุปผลการวัดทั้งหกข้อลงในแผนนี้ แล้วยืนยัน scope ของ Phase 1 กับผู้ใช้ก่อนเขียน extension

### Phase 1 — Worker mode และ MVP extension (serial)

- [x] เพิ่ม `worker-mode.ts` พร้อม environment signal `MYPI_WORKER=1` และ gate ใน `steering-choice`, Plannotator submit tool, dependency notifier และ Plannotator review tool
- [x] แยก `herdr-client.ts` ออกจาก `herdr-integration.ts` โดยไม่เปลี่ยนพฤติกรรมของ command เดิม
- [x] สร้าง registry ที่เก็บ task, agent name, pane, worktree, requested harness, observed kind, identity evidence และ artifact references
- [x] สร้าง tools `mypi_preview_worker`, `mypi_spawn_worker`, `mypi_handoff`, `mypi_collect` พร้อม approval gate และ evidence check
- [ ] เพิ่ม skill สำหรับ delegation judgment, handoff contract และ verification discipline
- [ ] Verification: unit tests, `npm test` และทำ research แล้วส่งต่อ implement ครบหนึ่งรอบโดย Coordinator ไม่เคยรับคำสรุปของ Worker เป็นหลักฐาน

### บันทึกระหว่าง Phase 1

**CLI flag ใช้ไม่ได้ ต้องเปลี่ยนเป็น environment variable** — แผนเดิมกำหนดให้ใช้ `pi.registerFlag` กับ `--mypi-worker` แต่การทดสอบกับ Pi 0.84.3 พบข้อจำกัดสามชั้นที่ทำให้ใช้ไม่ได้:

1. `getFlag` ถูก scope ไว้ที่ extension ที่ register เท่านั้น (`if (!extension.flags.has(name)) return undefined`) extension อื่นอ่านค่าไม่ได้
2. แชร์ผ่าน module state ไม่ได้ เพราะ loader ใช้ jiti ที่ตั้ง `moduleCache: false` ทำให้ทุก extension ได้ module graph ของตัวเอง
3. ให้ทุก extension register ชื่อเดียวกันก็ไม่ได้ Pi ปฏิเสธตอน load ด้วย `Flag "--mypi-worker" conflicts with .../worker-mode.ts` และ extension ที่เหลือ fail ทั้งหมด

จึงเปลี่ยนมาใช้ `MYPI_WORKER=1` ซึ่ง process แชร์อยู่แล้วโดยไม่ต้องมี plumbing ระหว่าง extension และ Coordinator ตั้งค่าได้ด้วย `pane send-text "export MYPI_WORKER=1"` + `send-keys enter` ก่อน `agent start` โดยยังใช้ `agent start` ตามเดิมจึงไม่เสีย detection guarantee

**verification จริง** — spawn worker ที่ `w7:pH` แล้วส่ง correction ตอน `agent_status: working` (`state_change_seq` 1698): ข้อความถึง Worker และตอบ `CORRECTION-RECEIVED` ไม่มี dialog คั่น ต่างจากก่อนแก้ที่ dialog ขึ้นและข้อความหายไปเงียบ ๆ

**Herdr ปฏิเสธคำสั่งด้วย exit code 0 และเขียน error envelope ลง stderr** — ตรวจกับ CLI จริงพบว่า `herdr agent get <ไม่มีอยู่จริง>` คืน `{"error":{"code":"agent_not_found",...}}` ทาง stderr โดย exit code เป็น 0 ดังนั้น `code !== 0` ใช้เป็นสัญญาณความล้มเหลวไม่ได้ `runHerdr` จึง parse envelope จาก stdout ก่อนแล้วจึง stderr และถือว่าไม่สำเร็จเมื่อมี `error` แม้ exit เป็น 0

`runHerdr` คืนความล้มเหลวเป็นค่า ไม่ throw เพราะ Coordinator ต้องแยก `agent_prompt_stalled`, timeout, agent ที่หายไป และ binary ที่เรียกไม่ได้ ออกจากกันเพื่อเลือกการกระทำถัดไป

**lifecycle integration รายงาน identity หลัง turn แรก ไม่ใช่ตอน spawn** — ทดสอบกับ Claude worker ที่ติดตั้ง integration แล้ว: ตอนเพิ่ง `agent start` ได้ `agent_session: null` แต่หลังส่ง prompt แรกได้ `{"agent":"claude","kind":"id","source":"herdr:claude","value":"28b26b29-..."}` ดังนั้น evidence ระดับ `detection` ทันทีหลัง spawn ยังไม่ใช่คำตอบสุดท้าย Coordinator ต้อง refresh ซ้ำหลัง Worker ทำงานรอบแรกก่อนสรุป

รูปแบบ session reference ต่างกันตาม harness: Pi ให้ `kind: "path"` ชี้ไฟล์ jsonl ส่วน Claude ให้ `kind: "id"` เป็น session UUID registry จึงเก็บทั้ง value และ kind

registry ใช้ `herdr agent list` เป็น source of truth ของ process: worker ที่ไม่อยู่ในรายการถือว่า `gone` ยกเว้นตัวที่ยัง `spawning` ส่วนเมื่อเรียก CLI ไม่ได้จะคง mapping เดิมไว้ ไม่ตีความว่า worker ตาย

**evidence rule แบบ "ผ่านอย่างน้อยหนึ่งอย่าง" หลวมเกินไป** — ทดสอบ chain จริงแล้วพบว่า `collect` ที่อ้าง artifact ซึ่งไม่มีอยู่จริงกลับได้ `complete: true` เพราะ `state_change_seq` ขยับ กฎจึงเปลี่ยนเป็น artifact ที่ตกลงไว้ต้องผ่าน **ครบทุกรายการ** ส่วน lifecycle เป็นหลักฐานประกอบที่ไม่มีสิทธิ์ตัดสินแทน

`collect` ต้องเทียบ `state_change_seq` กับค่าก่อนมอบหมายงาน ไม่ใช่ค่าหลังมอบหมาย เพราะตัว handoff เองก็ทำให้ counter ขยับและจะดูเหมือนมีความคืบหน้าเสมอ registry จึงเก็บ `seqAtHandoff` แยกจาก `lastSeq`

ทดสอบ chain เต็มกับ Worker จริง: preview ไม่สร้างอะไร, spawn สร้าง pane และ agent หลังอนุมัติ, handoff ส่งถึงจริง (`seq` 1719 → 1721), collect ผ่านเมื่อ artifact มีจริงและไม่ผ่านเมื่อ artifact หาย

### Phase 2 — Assurance และ worktree

- [ ] แยก execution decision กับ assurance decision เป็นคนละ state
- [ ] รองรับ correction กลับ session เดิมโดยรักษา ownership และ worktree เดิม
- [ ] เพิ่ม worktree lifecycle พร้อม `/mypi-orchestrate-status` และ `/mypi-orchestrate-cleanup`
- [ ] จัดการ `blocked` โดย surface ให้ผู้ใช้พร้อม pane ID และห้ามตอบแทน
- [ ] Verification: ทดสอบ `done`, `blocked`, timeout, missing artifact, scope drift และ Worker exit

### Phase 3 — Parallel workers

- [ ] บังคับ declared ownership และตรวจ disjoint write scope จาก git status ของแต่ละ worktree
- [ ] รองรับ fan-in ที่ Coordinator รวมผลเอง
- [ ] Verification: ทดสอบ parallel สองตัวที่ write scope ไม่ทับกัน และกรณีที่ทับกันต้องถูกปฏิเสธ

## ผลการวัด Phase 0

probe รันสองรอบเมื่อ 2026-08-25 09:22–09:30 ด้วย Pi worker ชื่อ `probe-dev` (kind `pi`, provider `openai-codex`) ใน throwaway git repo ใน scratchpad; รอบแรกใช้ `gpt-5.6-sol` ที่ pane `w7:p9` รอบสองใช้ `gpt-5.6-luna` ที่ pane `w7:pA` เพื่อเก็บตัวอย่างที่สองของ M1 และ M6; script อยู่ที่ scratchpad ของ session ไม่ถูก commit

| # | สิ่งที่วัด | ผล |
|---|---|---|
| M1 | `prompt --wait` เทียบ artifact จริง | สามตัวอย่าง: สำเร็จ+`done` (6767ms), สำเร็จ+`idle` (5842ms), ล้มเหลวจาก provider error+`idle` ไม่มี artifact (3546ms) ทั้งสามคืน `rc=0` |
| M2 | `agent_prompt_stalled` | `rc=1` ที่ 5075ms พร้อม error message ที่ระบุ `status is idle and state_change_seq remained 1659` แยกจาก timeout ได้ชัดและ machine-readable |
| M3 | guardrails blocked | `wait --until blocked` จับได้ใน 858ms และ `agent read` แสดง dialog เต็มพร้อม target path และตัวเลือก; `send-keys esc` ยกเลิกได้สะอาดและไม่มีไฟล์ถูกเขียน |
| M4 | runtime identity | `agent_session` ของ Pi worker ชี้ session jsonl จริงพร้อม `source: herdr:pi`; pane ที่เป็น `claude` ใน session เดียวกันไม่มี field นี้เพราะยังไม่ได้ติดตั้ง integration |
| M5 | worktree lifecycle | `worktree create` สร้าง **workspace ใหม่ทั้งชุด** (`wK`) ไม่ใช่แค่ pane และ checkout อยู่ที่ `~/.herdr/worktrees/<repo>/<branch>`; `remove` สำเร็จโดย `forced: false` เมื่อ tree สะอาด และ branch กับ commit ยังอยู่ครบใน repo ต้นทาง |
| M6 | correction ขณะ working | ล้มเหลวเมื่อ Worker `working` จริงตอน Enter ถึง (รอบแรก) และผ่านปกติเมื่อ Worker `idle` ไปแล้ว (รอบสอง) ทั้งสองกรณีคืน `rc=0` เหมือนกัน |

### ข้อค้นพบที่เปลี่ยน design

- **M6 ล้มเหลวแบบเงียบ ไม่ใช่ deadlock ที่มองเห็น** — correction ที่ส่งขณะ Worker `working` ไปติดที่ dialog ของ `steering-choice` แต่ `agent prompt --wait` คืน `rc=0` ที่ 1797ms และ status เป็น `idle` โดย `state_change_seq` ไม่ขยับเลย (1667 ทั้งก่อนและหลัง) Coordinator จึงเข้าใจว่าส่ง correction สำเร็จแล้วทั้งที่ข้อความไม่เคยถึง Worker
- ต่างจาก M3 ที่ dialog ของ guardrails ถูก bridge เป็น `herdr:blocked` และมองเห็นได้ทันที จึงสรุปเป็นกฎทั่วไปได้ว่า **UI ใดของ `my-pi` ที่บล็อก input ได้ ต้องถูก bridge ไป `herdr:blocked` หรือถูกปิดใน worker mode** ไม่มีทางเลือกที่สาม
- **`agent_status` ไม่มีข้อมูลเรื่องความสำเร็จเลย** — ตัวอย่างที่สองบน `gpt-5.6-luna` เขียน artifact ถูกต้องแต่คืน `idle` ส่วนตัวอย่างแรกบน `gpt-5.6-sol` คืน `done` ในสถานการณ์เดียวกัน สมมติฐานที่ว่า `done` แปลว่างานเสร็จจริงจึงตกไป และเหลือ artifact กับ git state เป็นหลักฐานเดียวที่ใช้ได้
- **M6 เป็น failure ที่เกิดเป็นครั้งคราว** ขึ้นกับว่า Worker อยู่สถานะใดตอน Enter ถึงพอดี รอบแรก `mid-task status=working` แล้วข้อความหาย รอบสอง `mid-task status=idle` แล้วข้อความถึงปกติ ทั้งสองรอบ `rc=0` เท่ากัน ความไม่สม่ำเสมอนี้ทำให้อันตรายกว่า failure ที่เกิดทุกครั้ง เพราะจะผ่านการทดสอบแบบผิวเผิน
- `agent start` คืน `argv` ที่ใช้จริงกลับมาด้วย เช่น `["pi","--provider","openai-codex","--model","gpt-5.6-luna"]` ใช้บันทึกเป็น requested configuration ได้ แต่ยังไม่ใช่ observed runtime
- `agent start` คืน `agent_pane_busy` ถ้าเรียกทันทีหลัง `pane split` เพราะ shell ยังไม่ถึง interactive prompt จึงต้องมี readiness retry ไม่ใช่เรียกครั้งเดียว
- provider error ของ Worker (usage limit) จบ turn ทันทีโดยที่ lifecycle ดูเหมือนงานปกติ ยืนยันว่า Coordinator ต้องอ่านหลักฐานจริงเสมอ ไม่มีข้อยกเว้นสำหรับงานสั้น

### ผลต่อ scope ของ Phase 1

- worker mode เป็น blocker ของ Phase 1 ไม่ใช่ nice-to-have
- ต้องเพิ่ม readiness retry ใน spawn path
- evidence check ต้องรวม `state_change_seq` ก่อน/หลัง เพราะเป็นตัวเดียวที่จับ M6 ได้
- ก่อนส่ง correction ทุกครั้งต้องอ่าน status ก่อน และหลังส่งต้องยืนยันว่ามีการเปลี่ยนแปลงที่สังเกตได้จริง เพราะ `rc=0` ไม่ได้แปลว่าข้อความถึงปลายทาง
- ห้ามใช้ `agent_status` เป็นเงื่อนไขในการรับผลงาน ใช้ได้เฉพาะควบคุม process
- `agent read` ให้ข้อมูลพอที่จะ surface approval request ที่ actionable ต่อผู้ใช้ ไม่ต้องออกแบบช่องทางใหม่

## Change log

- 2026-08-25 11:12 — เพิ่ม Coordinator tools ครบสี่ตัวและรัดกฎ evidence ให้ artifact ที่ตกลงไว้ต้องผ่านครบ
- 2026-08-25 10:58 — เพิ่ม worker registry พร้อม identity reconciliation และยืนยันกับ Worker จริงทั้ง confirmed, mismatch และ gone
- 2026-08-25 10:26 — แยก `herdr-client.ts` พร้อม JSON envelope handling และยืนยันกับ CLI จริงว่า error มาทาง stderr ที่ exit code 0
- 2026-08-25 10:02 — ทำ worker mode เสร็จและยืนยันกับ Worker จริง; เปลี่ยนจาก CLI flag เป็น environment signal หลังพบข้อจำกัดของ Pi flag scoping
- 2026-08-25 09:32 — เก็บตัวอย่างที่สองบน `gpt-5.6-luna` ทำให้สมมติฐานเรื่อง `done` ตกไป และยืนยันว่า M6 เป็น intermittent failure
- 2026-08-25 09:30 — รัน Phase 0 probe ครบทั้งหกข้อ ยืนยัน silent failure ของ correction ขณะ working และปรับ scope ของ Phase 1
- 2026-08-25 09:19 — สร้างแผนหลังผู้ใช้อนุมัติให้พัฒนา, เลือกเขียน mechanism เอง, ยืนยันให้ทำ probe ก่อน และตัดสินเรื่อง worker mode แทนการแยก repository
