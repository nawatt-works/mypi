# Workbench

> **Status:** active<br>
> **Created:** 2026-07-27 08:55<br>
> **Updated:** 2026-08-09 09:10<br>
> **Purpose:** แสดงภาพรวมของเอกสารประกอบ เพื่อให้ค้นหาและเข้าใจลำดับงานได้ง่าย

เอกสารเรียงตามเวลาอัปเดตล่าสุด แล้วตามเวลาสร้าง หากต้องการรายละเอียดการตัดสินใจหรือสิ่งที่เปลี่ยน ให้เปิดหัวข้อ `Decisions` และ `Change log` ภายในเอกสารนั้น

## Plans

| Updated | Created | Status | Document | Purpose |
|---|---|---|---|---|
| 2026-08-09 09:10 | 2026-08-09 09:02 | complete | [ให้ AI ตัดสินใจเปิด Plannotator](plans/ai-auto-plannotator.md) | เพิ่มกลไกให้ AI เข้า plan mode เองเมื่องานซับซ้อนหรือเสี่ยงสูญเสียบริบท |
| 2026-08-05 12:04 | 2026-08-05 12:04 | active | [แนวทางเขียนแผนงานใหญ่](plans/README.md) | กำหนดตำแหน่งและโครงสร้างขั้นต่ำของแผนที่ใช้ร่วมกับ Plannotator |

## Notes

| Updated | Created | Status | Document | Purpose |
|---|---|---|---|---|
| 2026-08-05 12:04 | 2026-07-27 02:31 | ดำเนินการบางส่วน | [Extension Review](notes/extensions-review.md) | ประเมิน third-party extensions และแนวทางปรับ Pi setup |
| 2026-08-09 09:02 | 2026-07-27 01:41 | นำมาใช้แล้ว | [Persistent Todo + Handoff](notes/persistent-todo-handoff.md) | กำหนด workflow สำหรับ AI-selected planning, การติดตามงานใหญ่ และส่งต่อบริบทข้าม session |

## Change log

- 2026-08-09 09:10 — ปิดแผน AI-selected Plannotator หลัง implementation และ verification ผ่าน
- 2026-08-09 09:02 — เพิ่มแผนให้ AI ตัดสินใจเปิด Plannotator และอัปเดตสถานะ Persistent Todo + Handoff
- 2026-08-05 12:04 — เพิ่มแนวทางแผนงานใหญ่และอัปเดตสถานะ Plannotator, Todo และ Handoff
- 2026-07-27 09:19 — อัปเดตสถานะ Extension Review หลังเพิ่ม Guardrails
- 2026-07-27 08:55 — สร้าง index และรวบรวมเอกสารที่มีอยู่ใน `.workbench`
