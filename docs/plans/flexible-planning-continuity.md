# แยก Workflow Plan, Continuity Ledger และ Plannotator Review

> **Status:** superseded<br>
> **Created:** 2026-08-22 12:40<br>
> **Updated:** 2026-08-23 11:19<br>
> **Purpose:** รื้อ planning integration ให้ workflow/skill เลือกตำแหน่ง artifact ได้ และให้ AI ดูแล continuity ledger สำหรับงานใหญ่โดยไม่บังคับเปิด Plannotator

> **Historical only:** ห้ามใช้ Approach, Decisions หรือ Steps ด้านล่างเป็น current instructions เพราะ managed fallback และ `.workbench/` policy ถูกยกเลิกแล้ว ให้ใช้ `docs/notes/persistent-todo-handoff.md` เป็นสถานะปัจจุบัน

## Context

ระบบเดิมใช้ความซับซ้อนและความเสี่ยงจาก context compaction เป็นเหตุให้ AI เข้า Plannotator แล้วบังคับเก็บทุก plan ใต้ `.workbench/plans/` ทำให้สามเรื่องที่ควรเป็นอิสระถูกผูกเข้าด้วยกัน ได้แก่ ownership ของ workflow artifact, continuity ของงานยาว และ human review ก่อน execution

## Approach

- ให้ workflow หรือ skill ส่ง `filePath` ของ plan artifact ที่ต้องการได้ โดย path ต้องเป็น Markdown ภายใน workspace
- หากไม่มี caller-owned path และงานใหญ่พอ AI สร้าง managed continuity ledger ใต้ `.workbench/continuity/`
- เก็บ pointer ของ active ledger ใน Pi session entry และ inject path กลับทุก turn เพื่อให้ recovery หลัง compaction/resume ไม่พึ่ง summary เพียงอย่างเดียว
- แยกการเข้า Plannotator เป็นเครื่องมืออีกตัว ใช้ active ledger หรือ path ที่ caller ระบุ แต่ไม่ใช่เงื่อนไขบังคับของงานใหญ่
- managed ledger เป็น working state ที่ใช้ ignore policy ของแต่ละ workspace และลบเมื่อทำงานเสร็จ ส่วน caller-owned artifact ไม่ถูกลบอัตโนมัติ

## Files to modify

- `extensions/auto-plannotator.ts` และ `extensions/plannotator-workflow.ts` — แทนที่ด้วย planning integration ใหม่
- `package.json`
- `AGENTS.md`, `.gitignore`, `README.md`
- `tests/plannotator-workflow.test.ts`
- `docs/notes/persistent-todo-handoff.md`, `docs/plans/README.md`, `docs/README.md`

## Reuse

- ใช้ shared `plannotator:request` event สำหรับเข้า plan mode
- ใช้ Pi `appendEntry` และ branch restoration สำหรับเก็บ pointer ของ active ledger
- ใช้ `ctx.getContextUsage()` เป็นเพียงสัญญาณประกอบ ไม่ใช้ threshold เป็นคำสั่งบังคับ
- ใช้ Plannotator checklist และ `[DONE:n]` เมื่อมี human-reviewed execution

## Risks

- AI อาจสร้าง continuity ledger มากเกินไป จึงต้องมี strong signals และคำสั่งปิดราย session
- caller-owned artifact อาจมี schema เฉพาะ จึงห้าม cleanup หรือ rewrite อัตโนมัติ
- managed ledger อาจค้างเมื่อ process จบผิดปกติ จึงต้อง restore ได้และมีคำสั่ง status/finish
- Plannotator event API ยังไม่รับ plan path ตอน enter จึงต้องส่ง path ผ่าน tool result และ planning prompt เพิ่มเติม

## Decisions

- แยกคำถาม “ต้องมี continuity หรือไม่” ออกจาก “ต้องให้ผู้ใช้ review หรือไม่”
- caller-owned path มี precedence สูงสุด; fallback ใช้ `.workbench/continuity/<slug>.md`
- default continuity mode เป็น `automatic`; ผู้ใช้ปิดได้ราย session
- ลบอัตโนมัติเฉพาะ managed ledger ที่ extension เป็นผู้สร้างเท่านั้น

## Steps

### Phase 1 — Planning state และ continuity lifecycle

- [x] สร้าง extension ใหม่พร้อม path validation, managed fallback, session restoration และ lifecycle tools
- [x] Inject guidance สำหรับการสร้าง/อ่าน/อัปเดต ledger ก่อนและหลัง compaction
- [x] Verification: unit tests ครอบคลุม default path, custom artifact, restore และ cleanup

### Phase 2 — Optional Plannotator integration

- [x] เพิ่มเครื่องมือเข้า Plannotator ที่รับ caller-selected path หรือ reuse active ledger
- [x] เอากฎบังคับ `.workbench/plans/`, metadata และ index ออกจาก runtime prompt
- [x] Verification: ทดสอบ event request, exact path guidance และ phase handling

### Phase 3 — Policy และ documentation

- [x] ปรับ AGENTS/README ให้แยก workflow artifact, continuity ledger และ review
- [x] อัปเดตบันทึก design เดิมโดยทำเครื่องหมาย decision ที่ถูกแทนที่
- [x] Verification: `npm test`, `git diff --check` และตรวจว่าไม่มี runtime prompt บังคับ directory กลาง

## Handoff

implementation รุ่นนี้เคยเสร็จและผ่าน verification แล้ว แต่ decision เรื่อง managed fallback, skeleton และ auto-delete ถูกยกเลิกเมื่อ 2026-08-22 16:15 และ pointer-only รุ่นถัดมาถูกขยายเมื่อ 2026-08-23 ปัจจุบัน AI-only plan เก็บเป็น Pi session state ส่วน explicit `filePath` เท่านั้นที่เป็น workspace plan ดูสถานะล่าสุดที่ `docs/notes/persistent-todo-handoff.md`

## Change log

- 2026-08-23 11:19 — อัปเดต handoff ให้ชี้ dual session/workspace tracking รุ่นปัจจุบัน โดยคง Approach เดิมไว้เป็นประวัติ
- 2026-08-22 16:34 — เพิ่มคำเตือน historical-only เพื่อไม่ให้ agent ใช้ managed fallback รุ่นเก่าเป็น current instructions
- 2026-08-22 16:15 — ทำเครื่องหมาย superseded หลังถอด managed fallback และ workspace-owned file lifecycle ออกจาก extension
- 2026-08-22 12:51 — ปิดแผนหลัง implementation, documentation และ verification ผ่านครบ
- 2026-08-22 12:40 — สร้างแผนรื้อ planning integration ตาม artifact ownership และ continuity lifecycle ใหม่
