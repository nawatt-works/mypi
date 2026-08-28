# Pi Coordinator บน Herdr

> **Status:** active<br>
> **Created:** 2026-08-25 09:19<br>
> **Updated:** 2026-08-28 09:58<br>
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
- `skills/herdr-orchestration/SKILL.md` — authority tiers, delegation judgment, handoff contract, audit contract และ verification discipline (ใหม่)
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
- [x] เพิ่ม skill `herdr-orchestration` สำหรับ delegation judgment, handoff contract และ verification discipline
- [x] Verification: ทำ research แล้วส่งต่อ implement ครบหนึ่งรอบกับงานจริง โดย Coordinator ไม่เคยรับคำสรุปของ Worker เป็นหลักฐาน

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

### ผลการ verification ปลาย Phase 1

รันงานจริงใน `lab/pi-orchestration` เมื่อ 2026-08-25 โดยผู้ใช้เปิด Pi session เป็น Coordinator เอง และให้โจทย์แบบภาษาธรรมชาติที่ไม่ระบุชื่อ tool หรือลำดับขั้น งานคือแก้ `parseDuration` ที่ไม่รองรับ `"2h"` และปล่อยค่าผิดรูปแบบผ่านไปเงียบ ๆ

ทีมที่เกิดขึ้นจริง: `timeout-auditor` (Claude Code) เขียนรายงานวิเคราะห์ แล้ว `timeout-implementer` (Codex) อ่านรายงานนั้นแล้วแก้ code ทั้งสองผ่านการอนุมัติของผู้ใช้ก่อน spawn

พฤติกรรมที่ยืนยันได้:

- เรียก `mypi_preview_worker` ก่อน `mypi_spawn_worker` ทุกครั้ง พร้อม rationale ที่เป็นรูปธรรมและ expected artifacts
- task ที่ส่งให้ Worker มี exact ownership, ไฟล์ที่ห้ามแตะ, base SHA ที่เจาะจง, acceptance criteria, verification ที่ต้องรัน และเงื่อนไขให้หยุดถาม
- ส่งต่องานด้วย exact SHA ไม่ใช่คำอธิบายให้ Worker ไปค้นเอง
- `mypi_collect` รอบแรกคืน incomplete ตอน Worker ยังติด approval และ Coordinator ส่ง correction กลับ session เดิมแทนการสร้าง Worker ใหม่
- เมื่อ Worker `blocked` Coordinator แสดง pane id ให้ผู้ใช้ไปกดเอง ไม่กดแทนและไม่ปิด guardrail ของ Worker
- ตรวจ commit ด้วย `git diff-tree` และ parent SHA จริง ไม่ใช้คำสรุปของ Worker เป็นหลักฐาน
- ไม่ปิด Worker ที่เสร็จงานแล้วทิ้ง เก็บไว้ idle เผื่อ correction

ผลที่ตรวจซ้ำอิสระหลังจบงาน: `main` ยังอยู่ที่ `e1d2def` ไม่มีการ merge, implementation commit `04d1a04` แก้เฉพาะ `src/parse-duration.ts` กับ `tests/parse-duration.test.ts` โดยมี parent เป็น report commit `c518700`, working tree สะอาด, `npm test` ผ่าน 4/4 และ behavior probe ตรงกับทุก decision ที่ผู้ใช้เลือกไว้ (`"2h"` → 7200000, `"abc"`/`"-5s"`/`"1.5m"`/`""` throw TypeError, `undefined` ใช้ fallback)

### ข้อบกพร่องที่พบจากการรันงานจริง

**ไม่มี tool ให้รอ Worker** — เมื่อ Worker ไปติด approval แล้วผู้ใช้มากดทีหลัง Coordinator ไม่มีวิธีรอต่อ จึงประดิษฐ์ polling loop เอง (`sleep 15; herdr agent read ... | tail -180` ซ้ำ ๆ) ทั้งที่ Herdr มี `agent wait --until` อยู่แล้ว ต้นทุนของช่องว่างนี้คือ context และเงินที่หมดไปกับการอ่านหน้าจอซ้ำ session นี้ใช้ไป 2.85 ดอลลาร์กับงานขนาดเล็กมาก จึงควรเพิ่ม `mypi_wait_worker` ที่ห่อ `agent wait --until` ใน Phase 2

**Codex ต้องให้ผู้ใช้อนุมัติ hooks ก่อนจึงรายงาน identity** — Codex worker ค้างที่ `detection` จนกว่าผู้ใช้จะเลือก trust hooks ในหน้าจอของมัน หลังจากนั้น `agent_session` (`kind: "id"`, `source: "herdr:codex"`) จึงปรากฏและ identity ขยับเป็น `lifecycle` Coordinator ควรรู้ว่านี่ไม่ใช่ integration เสีย

**จำนวน approval ต่อหนึ่งงานสูง** — งานสองบทบาทนี้ต้องให้ผู้ใช้กดอนุมัติในหน้าจอ Worker หลายครั้ง (Codex trust directory, trust hooks, `git switch -c`, `git add`, `git commit`, `git rebase --onto`) นอกเหนือจากการอนุมัติ spawn สองครั้ง เป็นต้นทุนความสนใจของผู้ใช้ที่ต้องพิจารณาใน Phase 2 โดยไม่ลดทอน guardrail

### Phase 2 — Assurance และ worktree

- [x] แยก execution decision กับ assurance decision เป็นคนละ state ผ่าน `mypi_set_assurance`
- [x] รองรับ correction กลับ session เดิมโดยรักษา ownership และ worktree เดิม
- [x] เพิ่ม worktree lifecycle พร้อม `/mypi-orchestrate-status` และ `/mypi-orchestrate-cleanup`
- [x] จัดการ `blocked` โดย surface ให้ผู้ใช้พร้อม pane ID และห้ามตอบแทน
- [x] เพิ่ม `mypi_wait_worker` ที่ห่อ `agent wait --until` เพื่อเลิก polling loop ที่ Coordinator ประดิษฐ์เอง
- [x] Verification: ครอบคลุม `done`, `blocked`, missing artifact, Worker exit, dirty worktree, undelivered handoff และ scope control จากงานจริง; timeout ยังทดสอบเฉพาะระดับ unit

### บันทึกระหว่าง Phase 2

**worktree เปิด workspace ใหม่ ไม่ใช่แค่ pane** — `worktree create` คืน `workspace`, `tab` และ `root_pane` มาให้ spawn จึงใช้ root pane นั้นเป็นที่รัน Worker แทนการ split pane และ checkout ไปอยู่ที่ `~/.herdr/worktrees/<repo>/<branch>`

**workspaceId ที่เก็บไว้กลายเป็นค่าเก่าได้** — พบตอนทดสอบจริงว่าการปิด pane ของ Worker ทำให้ workspace ของ worktree ปิดไปด้วย `herdr worktree remove --workspace` จึงล้มเหลวด้วย `workspace ... not found` และเหลือ checkout ค้างบน disk cleanup จึง fallback ไป `git worktree remove <path>` โดยหา repository ต้นทางจาก `git rev-parse --git-common-dir` ของตัว worktree เอง

**cleanup ต้องข้ามสองกรณีก่อนถาม** — Worker ที่ยัง live และ worktree ที่มีงานยังไม่ commit ทดสอบจริงแล้วทั้งสองกรณี และเมื่อลบสำเร็จ branch กับ commit ยังอยู่ใน repository ต้นทาง ลบเฉพาะ checkout

**assurance ไม่ผูกกับจำนวน Worker** — `coordinator` พอเมื่อมีหลักฐานที่ตรวจผ่านอย่างน้อยหนึ่งชุด, `independent-review` ต้องมี Worker คนละตัวตรวจผ่านอย่างน้อยสองราย และ `human-approval` ไม่ปิดเองไม่ว่ากรณีใด การยกระดับ assurance ไม่ทิ้งหลักฐานที่เก็บมาแล้ว

### บทบาทที่ถูกล็อกหลัง skill trigger และการแก้

ทดสอบด้วย Coordinator ที่สะอาดบน fixture ที่มี lane แยกได้ห้าทาง แล้วให้โจทย์ที่ไม่มีคำว่าทีมหรือแบ่งงานเลย ผลคือ **ไม่เรียก orchestration tool แม้แต่ครั้งเดียว** และลงมือทำเองจนจบ ระหว่างนั้นแปลงโปรเจกต์จาก TypeScript เป็น JavaScript โดยไม่มีใครขอ ซึ่งเป็น scope drift ที่ไม่มีกลไกใดจับได้เพราะงานไม่ได้ผ่าน Worker

สาเหตุคือ Pi ใส่เฉพาะ `name` และ `description` ของ skill ไว้ใน system prompt ส่วนเนื้อใน `SKILL.md` จะถูกอ่านต่อเมื่อ model เลือกเปิด เมื่อ model ไม่คิดจะแตกทีม มันจึงไม่เคยเห็นประโยคที่นิยามบทบาทตัวเองเลย

`AGENTS.md` แก้ปัญหานี้ไม่ได้เพราะ Pi หา context file จาก cwd และ directory แม่เท่านั้น ไม่มีระดับ user ขณะที่ `my-pi` เป็น global package ที่ตามไปทุก workspace จึงต้องใช้ guidance injection ที่ `before_agent_start` แทน โดยประกาศอำนาจสามชั้น คือ ผู้ใช้ตัดสิน Coordinator ประสาน และ Worker ทำงานที่ถูก bound ไว้โดยไม่ตัดสินใจเชิงออกแบบเอง

ทดลองซ้ำด้วย fixture และ prompt เดิมทุกตัวอักษรหลังเพิ่ม guidance: Coordinator เรียก `mypi_set_assurance` เลือก `independent-review` ก่อน แล้วเสนอ Worker เพียงตัวเดียวเป็น reviewer อิสระที่ไม่แก้ไฟล์ พร้อมเหตุผลที่อ้างถึง assurance bar แล้วหยุดรอผู้ใช้อนุมัติ ไม่ได้แตกทีมตามจำนวนโมดูลซึ่งเป็นคำตอบที่ถูกกว่า

### กฎที่รับมาจาก Software-Factories

ทบทวน `AGENTS.md` และ audit policy ของ workspace `Software-Factories` แล้วนำสี่เรื่องมาปรับใช้ ได้แก่ การประกาศอำนาจสามชั้นไว้นอก skill, การ freeze ระดับ assurance ก่อนมอบหมายงานแทนที่จะเลือกหลังเห็นผลงาน, ขอบเขตและเงื่อนไขจบของ correction loop และการแยก advisory ออกจาก scope escalation โดยทั้งสองอย่างไม่ขยาย Definition of Done เงียบ ๆ

ไม่รับโครงสร้าง Mission Control มาด้วย เพราะ directory contract และ precedence แบบรวมศูนย์ขัดกับ working decision ที่ให้ artifact ใช้ path และ lifecycle ของเจ้าของ

### ผลการรันงานจริงหลังเพิ่ม guidance

รันงานเดียวกับที่เคยไม่มีการเสนอทีม โดยผู้ใช้อนุมัติ Worker เอง ผลคือ Coordinator เลือก `independent-review` ก่อนเริ่มงาน ทำ implementation เอง แล้วขอ reviewer อิสระหนึ่งตัว ไม่มี scope drift และไม่แตะไฟล์นอกที่ตกลง ต่างจากรอบก่อน guidance ที่แปลงโปรเจกต์จาก TypeScript เป็น JavaScript โดยไม่มีใครขอ

ระหว่างทางเกิดเคสจริงสามอย่างโดยไม่ได้จัดฉาก คือ Worker ตายกลางคัน (Codex reviewer จบตัวเองที่หน้าจอ update), handoff ที่ส่งไม่ถึงจริงและถูกจับได้ด้วย `agent_prompt_stalled` และ reviewer ขอขยายขอบเขตไปรัน `npm publish --dry-run` ทั้งที่ตกลงเป็น internal package ซึ่ง Coordinator ปฏิเสธเองตามหลัก scope control

**bug ที่พบจากการรันจริง: กฎ independence เดิมเป็นไปไม่ได้ในรูปแบบที่พบบ่อยที่สุด** — เดิมกำหนดให้ `independent-review` ผ่านเมื่อมี `verifiedBy` ต่างชื่อกันตั้งแต่สองราย แต่เมื่อ Coordinator ทำงานเองแล้วมี Worker หนึ่งตัวตรวจ จะมีชื่ออยู่ใน `verifiedBy` ได้แค่รายเดียวเสมอ เพราะงานของ Coordinator ไม่เคยผ่าน `mypi_collect` gate จึงรายงานว่ายังไม่พอทั้งที่ review อิสระเกิดขึ้นจริงแล้ว และ Coordinator ก็ปิดงานไปโดยที่ gate ยังค้าง

แก้โดยวัด independence เทียบกับผู้ผลิตงานแทนจำนวนผู้ตรวจ: `AssuranceState` เก็บ `producedBy` ซึ่ง default เป็น `coordinator` และ `assuranceMet` ผ่านเมื่อมีผู้ตรวจอย่างน้อยหนึ่งรายที่ไม่ใช่ผู้ผลิต ส่วน Worker ที่ตรวจงานตัวเองยังไม่นับ

**friction ที่ยังเหลือ** — เมื่อ Worker ติด dialog ของ harness ตัวเอง Coordinator จะถามผู้ใช้ให้ไปกด แล้วถามซ้ำอีกครั้งว่ากดหรือยัง ทั้งที่ตรวจเองได้ด้วย `mypi_wait_worker --until idle` เกิดขึ้นสามครั้งในรอบเดียว

### worker mode ไม่ติดตอนใช้งานจริง และการแก้

ผู้ใช้รายงานเมื่อ 2026-08-28 ว่าใช้ Coordinator ใน workspace `team-work` แล้ว Worker ที่เป็น Pi (`delivery-challenger`, pane `wS:p6`) ถูก spawn โดยไม่มี `MYPI_WORKER=1` ยังไม่ได้ยืนยันสาเหตุและยังไม่แก้

สมมติฐานที่ต้องตรวจก่อน เรียงตามความน่าจะเป็น:

1. **race ระหว่าง `pane send-text` กับ shell ที่ยังไม่พร้อม** — spawn ส่ง `export MYPI_WORKER=1` ทันทีหลัง `pane split` โดยไม่รอและไม่ตรวจว่าข้อความถึง shell prompt จริง ขณะที่ `agent start` มี retry สำหรับ `agent_pane_busy` อยู่แล้ว แปลว่าเรารู้อยู่แล้วว่า pane ที่เพิ่งแยกยังไม่พร้อมทันที แต่ไม่ได้ป้องกันฝั่ง export ถ้า shell ยังไม่ถึง prompt บรรทัด export จะหายไปเงียบ ๆ แล้ว `agent start` สำเร็จในรอบ retry ได้ผลเป็น Worker ที่ไม่มี env
2. **Coordinator ไม่ได้ใช้ `mypi_spawn_worker`** — transcript ของผู้ใช้แสดงว่ามันเรียก `herdr agent read` ดิบ ๆ อยู่ ถ้าเคยเรียก `herdr agent start` ดิบด้วย env ก็จะไม่ถูกตั้งเลย
3. spawn สำเร็จแต่ shell ของ pane ไม่ export ต่อไปยัง process ลูกด้วยเหตุอื่น เช่น shell profile เขียนทับ

ไม่ว่าสาเหตุใด ปัญหาเชิงออกแบบร่วมกันคือ **spawn ไม่เคยยืนยันว่า worker mode ติดจริงหลังสตาร์ต** จึงล้มเหลวเงียบ ต่างจากส่วนอื่นของระบบที่ยืนยันผลเสมอ

### ทางเลือกจาก Pi resource flags

ตรวจ `pi --help` ของ v0.84.3 ในเครื่องยืนยันว่ามี flag ชุดนี้จริง:

| flag | ผล |
|---|---|
| `-ne` / `--no-extensions` | ปิด extension discovery โดย `-e <path>` ยังโหลดได้ |
| `-ns` / `--no-skills` | ปิด skill discovery |
| `-nc` / `--no-context-files` | ปิด AGENTS.md / CLAUDE.md |
| `-np` / `--no-prompt-templates` | ปิด prompt template |
| `-xt` / `--exclude-tools <list>` | denylist ของ tool |

ทางเลือกที่ควรพิจารณาแทนหรือเสริม env:

- **`-ne` บวก `-e` เฉพาะ extension ที่ Worker ต้องใช้** ทำให้ชุด extension ของ Worker เป็นค่าที่กำหนดแน่นอน ไม่ต้องพึ่ง env และไม่มี race เพราะ flag เดินทางผ่าน `agent start ... -- <args>` ซึ่ง atomic ต่างจากการพิมพ์ข้อความเข้า shell แลกกับการต้อง maintain รายชื่อ extension ให้ตรงกับที่ package มี
- **`-xt` ตัดเฉพาะ tool ที่บล็อกคน** เช่น `plannotator_submit_plan` เป็นการแก้แคบกว่าและไม่แตะ extension อื่น แต่ครอบคลุมเฉพาะ tool ไม่ครอบคลุมพฤติกรรมอย่าง steering choice ที่ไม่ใช่ tool
- **ยืนยันหลังสตาร์ตไม่ว่าจะใช้วิธีใด** เช่นอ่าน env ของ process จริงหรือให้ Worker รายงานกลับ แล้วถือว่า spawn ล้มเหลวเมื่อ worker mode ไม่ติด

เอกสารยังระบุ `PI_MODEL`, `PI_PROVIDER`, `PI_REASONING_LEVEL` เป็น env ที่ Pi อ่าน ซึ่งเป็นอีกทางสำหรับ model/effort นอกเหนือจาก flag ที่ใช้อยู่ และ `PI_CODING_AGENT_DIR` แยก profile ของ Worker ได้ทั้งก้อน

**วิธีที่เลือกใช้: ย้ายสัญญาณไปไว้ในชื่อ session** — ทดสอบแล้วว่า `pi --name "mypi-worker:<name>"` ทำให้ `pi.getSessionName()` คืนค่านั้นให้ทุก extension อ่านได้ ต่างจาก `getFlag` ที่ scope อยู่กับ extension ที่ register และต่างจาก module state ที่แยกกันเพราะ loader ปิด module cache ข้อดีที่ชี้ขาดคือมันเป็น flag ที่เดินทางไปกับ `agent start ... -- <args>` แบบ atomic จึงไม่มี race แบบการพิมพ์ข้อความเข้า shell

ผลพลอยได้คือ Herdr แสดงชื่อ session ใน `terminal_title` (`π - mypi-worker:wm-check - probe-repo`) ทำให้ Coordinator **ยืนยันจากภายนอกได้** ว่า Worker เริ่มในโหมดนี้จริง spawn จึงตรวจหลังสตาร์ตทุกครั้ง และถ้ายืนยันไม่ได้จะปิด pane ทิ้งแล้วรายงานว่าล้มเหลว แทนที่จะปล่อย Worker ที่ไม่มี guard ทำงานต่อ

`MYPI_WORKER=1` ยังใช้ได้อยู่ในฐานะทางลัดสำหรับรัน session เป็น worker ด้วยมือ

ยืนยันกับ Worker จริง: correction ที่ส่งตอน `agent_status` เป็น `working` ถึงปลายทางและได้ `CORRECTION-RECEIVED` โดยไม่มี steering dialog คั่น ซึ่งเป็นเคสเดิมที่เคยล้มเหลวเงียบ

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

- 2026-08-28 09:58 — ย้ายสัญญาณ worker mode จาก env ที่พิมพ์เข้า shell ไปเป็นชื่อ session ที่ตั้งด้วย `--name` และให้ spawn ยืนยันผลหลังสตาร์ต
- 2026-08-28 09:12 — บันทึกรายงานว่า worker mode ไม่ติดตอนใช้งานจริง พร้อมสมมติฐานและทางเลือกจาก Pi resource flags โดยยังไม่แก้
- 2026-08-27 13:42 — รันงานจริงจนจบวงแล้วแก้กฎ independence ให้วัดเทียบผู้ผลิตงานแทนจำนวนผู้ตรวจ พร้อมปิด verification ของ Phase 2
- 2026-08-27 10:41 — เพิ่ม guidance injection ที่ประกาศอำนาจสามชั้น, `/mypi-orchestrate`, และกฎ audit contract ใน skill หลังพบว่าบทบาทถูกล็อกอยู่หลัง skill trigger
- 2026-08-25 13:18 — เพิ่ม `mypi_wait_worker`, worktree lifecycle, cleanup ที่มี guard และ assurance state; แก้ cleanup ให้ fallback ไป git เมื่อ workspace ปิดไปแล้ว
- 2026-08-25 12:34 — ปิด Phase 1 หลัง verification กับงานจริงผ่านครบ และบันทึกช่องว่างเรื่องการรอ Worker, identity ของ Codex และจำนวน approval ต่องาน
- 2026-08-25 11:31 — เพิ่ม skill `herdr-orchestration` และยืนยันว่า Pi session จริงโหลด skill จาก package ได้
- 2026-08-25 11:12 — เพิ่ม Coordinator tools ครบสี่ตัวและรัดกฎ evidence ให้ artifact ที่ตกลงไว้ต้องผ่านครบ
- 2026-08-25 10:58 — เพิ่ม worker registry พร้อม identity reconciliation และยืนยันกับ Worker จริงทั้ง confirmed, mismatch และ gone
- 2026-08-25 10:26 — แยก `herdr-client.ts` พร้อม JSON envelope handling และยืนยันกับ CLI จริงว่า error มาทาง stderr ที่ exit code 0
- 2026-08-25 10:02 — ทำ worker mode เสร็จและยืนยันกับ Worker จริง; เปลี่ยนจาก CLI flag เป็น environment signal หลังพบข้อจำกัดของ Pi flag scoping
- 2026-08-25 09:32 — เก็บตัวอย่างที่สองบน `gpt-5.6-luna` ทำให้สมมติฐานเรื่อง `done` ตกไป และยืนยันว่า M6 เป็น intermittent failure
- 2026-08-25 09:30 — รัน Phase 0 probe ครบทั้งหกข้อ ยืนยัน silent failure ของ correction ขณะ working และปรับ scope ของ Phase 1
- 2026-08-25 09:19 — สร้างแผนหลังผู้ใช้อนุมัติให้พัฒนา, เลือกเขียน mechanism เอง, ยืนยันให้ทำ probe ก่อน และตัดสินเรื่อง worker mode แทนการแยก repository
