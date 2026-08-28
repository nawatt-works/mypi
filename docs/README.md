# เอกสาร My Pi

> **Status:** active<br>
> **Created:** 2026-07-27 08:55<br>
> **Updated:** 2026-08-28 15:20<br>
> **Purpose:** แสดงภาพรวมของ design notes และ implementation history ที่ repository `my-pi` เป็นเจ้าของ

`docs/` เป็น project documentation ของ repository นี้ ไม่ใช่ workspace-wide artifact store และไม่ใช่ default path สำหรับ plan, note หรือ output จาก AI tool/skill/harness อื่น

## Plans

| Updated | Created | Status | Document | Purpose |
|---|---|---|---|---|
| 2026-08-25 09:19 | 2026-08-25 09:19 | active | [Pi Coordinator บน Herdr](plans/pi-herdr-coordinator.md) | พัฒนา Coordinator ที่สร้างและควบคุม Workers ผ่าน Herdr โดยเริ่มจาก probe วัด runtime primitive ก่อนเขียน extension |
| 2026-08-23 11:19 | 2026-08-22 12:40 | superseded | [แยก Workflow Plan, Continuity Ledger และ Plannotator Review](plans/flexible-planning-continuity.md) | implementation รุ่น managed fallback; ต่อมาถูกแทนด้วย pointer-only และ dual session/workspace tracking |
| 2026-08-09 19:25 | 2026-08-09 11:10 | complete | [ย้ายและขยาย Azure DevOps extension](plans/azure-devops-extension-crud.md) | เพิ่ม opt-in Work Item CRUD; ปัจจุบัน maintain ที่ `local/extensions/azure-devops/` และให้แต่ละ project โหลดเอง |
| 2026-08-23 11:19 | 2026-08-09 09:02 | superseded | [ให้ AI ตัดสินใจเปิด Plannotator](plans/ai-auto-plannotator.md) | implementation เดิมที่ผูกงานใหญ่กับ Plannotator; ดู current design ใน Persistent Todo + Handoff |
| 2026-08-22 16:15 | 2026-08-05 12:04 | reference | [ประวัติแผนของ My Pi](plans/README.md) | อธิบายขอบเขตของ project-owned plan history โดยไม่เป็น default path ให้กลไกอื่น |

## Notes

| Updated | Created | Status | Document | Purpose |
|---|---|---|---|---|
| 2026-08-28 15:20 | 2026-08-28 15:20 | ทิศทางที่ยืนยันให้ศึกษาต่อ | [Delegated Autonomy สำหรับ Coordinator และ Guardrails](notes/delegated-autonomy-guardrails-research.md) | เปรียบเทียบ OpenCode, Claude Code และ Codex CLI พร้อมวิเคราะห์การเปลี่ยนจาก approval ทุกขั้นเป็น bounded mandate และ Coordinator review |
| 2026-08-25 09:19 | 2026-08-23 22:27 | อนุมัติให้พัฒนา | [Runtime-negotiated Orchestration ผ่าน Pi และ Herdr](notes/runtime-negotiated-herdr-orchestration.md) | กำหนด Pi Coordinator ที่สร้าง Workers และ artifact handoff ระหว่างสนทนา โดยใช้ config เฉพาะ runtime policy |
| 2026-08-23 11:19 | 2026-07-27 02:31 | ดำเนินการบางส่วน | [Extension Review](notes/extensions-review.md) | ประเมิน third-party extensions และแนวทางปรับ Pi setup |
| 2026-08-22 11:57 | 2026-08-21 09:43 | อยู่ระหว่างวิเคราะห์ | [ทิศทางพัฒนา Pi โดยเรียนรู้จาก OMP](notes/pi-omp-context-code-intelligence-tui.md) | สรุป context governance, benchmark และ short-cycle candidates สำหรับ code intelligence, orchestration และ OMP-inspired TUI |
| 2026-08-23 11:19 | 2026-07-27 01:41 | นำมาใช้แล้ว | [Persistent Todo + Handoff](notes/persistent-todo-handoff.md) | แยก AI-only session state ออกจาก workspace plan และ Plannotator review |

## Change log

- 2026-08-28 15:20 — บันทึกผลเปรียบเทียบ guardrails และ agent orchestration ของ OpenCode, Claude Code และ Codex CLI พร้อมยืนยันทิศทางรื้อ Coordinator เป็น delegated autonomy ภายใต้ bounded mandate
- 2026-08-25 09:19 — อนุมัติให้พัฒนา Pi Coordinator บน Herdr และเปิดแผนที่เริ่มจาก probe phase พร้อม worker mode แทนการแยก repository
- 2026-08-24 19:36 — เพิ่มหลัก bounded delegation, explicit ownership, correction เดิม, execution/assurance separation และ runtime identity ในแบบ Pi/Herdr orchestration
- 2026-08-23 22:27 — บันทึกข้อกำหนด runtime-negotiated orchestration ผ่าน Pi/Herdr และพัก implementation ไว้รอตัดสินใจ
- 2026-08-23 11:19 — แยก AI-only plan ไปเก็บใน Pi session และให้ explicit `filePath` เป็นเส้นแบ่ง workspace artifact
- 2026-08-22 16:34 — ตรวจ historical `.workbench` references, เพิ่ม warning ใน superseded plans และแก้ benchmark link ที่ยังชี้ path เดิม
- 2026-08-22 16:15 — ย้าย project documentation จาก hidden `.workbench/` มา `docs/` และยกเลิก catch-all workspace policy
- 2026-08-22 12:51 — ปิดแผน flexible planning หลัง implementation และ verification ผ่านครบ
- 2026-08-22 12:40 — เพิ่มแผนรื้อ planning integration ให้แยก workflow artifact, continuity ledger และ Plannotator review
- 2026-08-22 12:40 — ทำเครื่องหมาย auto-Plannotator เดิมเป็น superseded และอัปเดต Persistent Todo + Handoff ตาม workflow ใหม่
- 2026-08-22 11:57 — ยกเลิก workspace-local runtime, ย้าย durable code-intelligence benchmark artifacts และให้ temporary files ใช้ default ของ harness หรือ OS
- 2026-08-21 15:46 — เพิ่ม validation backlog และ short-cycle candidates ในบันทึก Pi/OMP
- 2026-08-21 15:15 — อัปเดตบันทึก Pi/OMP ด้วยผล benchmark code intelligence และ draft upstream issue ของ `pi-lsp-adapter`
- 2026-08-21 09:43 — เพิ่มบันทึกทิศทางพัฒนา Pi จากการประเมิน OMP ครอบคลุม context, compaction, memory, code intelligence, orchestration และ TUI
- 2026-08-09 19:25 — อัปเดต Azure DevOps เป็น project-local deployment จาก source กลางใน repository นี้
- 2026-08-09 12:50 — ปิดแผน Azure DevOps หลัง automated, user acceptance และ post-removal verification ผ่านครบ
- 2026-08-09 12:47 — Azure DevOps acceptance ผ่าน, write ถูก block ตาม read-only และรอ post-removal retest
- 2026-08-09 11:53 — Azure DevOps implementation ผ่าน automated verification และ blocked รอ user acceptance ก่อนลบ local source
- 2026-08-09 11:27 — พักแผน Azure DevOps ไว้รอคำสั่งเริ่ม พร้อมกำหนดให้ผู้ใช้ทำ acceptance test และห้าม AI เรียก Azure CLI
- 2026-08-09 11:10 — เพิ่มแผนย้ายและขยาย Azure DevOps extension พร้อม permission CRUD ราย project
- 2026-08-09 09:10 — ปิดแผน AI-selected Plannotator หลัง implementation และ verification ผ่าน
- 2026-08-09 09:02 — เพิ่มแผนให้ AI ตัดสินใจเปิด Plannotator และอัปเดตสถานะ Persistent Todo + Handoff
- 2026-08-05 12:04 — เพิ่มแนวทางแผนงานใหญ่และอัปเดตสถานะ Plannotator, Todo และ Handoff
- 2026-07-27 09:19 — อัปเดตสถานะ Extension Review หลังเพิ่ม Guardrails
- 2026-07-27 08:55 — สร้าง index และรวบรวมเอกสารที่มีอยู่ใน `.workbench`
