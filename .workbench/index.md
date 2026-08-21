# Workbench

> **Status:** active<br>
> **Created:** 2026-07-27 08:55<br>
> **Updated:** 2026-08-21 09:43<br>
> **Purpose:** แสดงภาพรวมของเอกสารประกอบ เพื่อให้ค้นหาและเข้าใจลำดับงานได้ง่าย

เอกสารเรียงตามเวลาอัปเดตล่าสุด แล้วตามเวลาสร้าง หากต้องการรายละเอียดการตัดสินใจหรือสิ่งที่เปลี่ยน ให้เปิดหัวข้อ `Decisions` และ `Change log` ภายในเอกสารนั้น

## Plans

| Updated | Created | Status | Document | Purpose |
|---|---|---|---|---|
| 2026-08-09 19:25 | 2026-08-09 11:10 | complete | [ย้ายและขยาย Azure DevOps extension](plans/azure-devops-extension-crud.md) | เพิ่ม opt-in Work Item CRUD; ปัจจุบัน maintain ที่ `local/extensions/azure-devops/` และให้แต่ละ project โหลดเอง |
| 2026-08-09 09:10 | 2026-08-09 09:02 | complete | [ให้ AI ตัดสินใจเปิด Plannotator](plans/ai-auto-plannotator.md) | เพิ่มกลไกให้ AI เข้า plan mode เองเมื่องานซับซ้อนหรือเสี่ยงสูญเสียบริบท |
| 2026-08-05 12:04 | 2026-08-05 12:04 | active | [แนวทางเขียนแผนงานใหญ่](plans/README.md) | กำหนดตำแหน่งและโครงสร้างขั้นต่ำของแผนที่ใช้ร่วมกับ Plannotator |

## Notes

| Updated | Created | Status | Document | Purpose |
|---|---|---|---|---|
| 2026-08-21 09:43 | 2026-08-21 09:43 | อยู่ระหว่างวิเคราะห์ | [ทิศทางพัฒนา Pi โดยเรียนรู้จาก OMP](notes/pi-omp-context-code-intelligence-tui.md) | สรุป context governance, code intelligence, external orchestration และแนวทางทำ OMP-inspired TUI บน Pi |
| 2026-08-05 12:04 | 2026-07-27 02:31 | ดำเนินการบางส่วน | [Extension Review](notes/extensions-review.md) | ประเมิน third-party extensions และแนวทางปรับ Pi setup |
| 2026-08-09 09:02 | 2026-07-27 01:41 | นำมาใช้แล้ว | [Persistent Todo + Handoff](notes/persistent-todo-handoff.md) | กำหนด workflow สำหรับ AI-selected planning, การติดตามงานใหญ่ และส่งต่อบริบทข้าม session |

## Change log

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
