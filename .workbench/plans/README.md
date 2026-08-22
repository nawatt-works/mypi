# แนวทางเขียนแผนงานใหญ่

> **Status:** active<br>
> **Created:** 2026-08-05 12:04<br>
> **Updated:** 2026-08-22 12:40<br>
> **Purpose:** กำหนดโครงสร้าง fallback สำหรับ durable project plan เมื่อ workflow หรือ skill ไม่ได้กำหนดตำแหน่ง artifact เอง

## การใช้งาน

- หาก workflow, skill หรือผู้ใช้กำหนดตำแหน่ง plan artifact ให้ใช้ตำแหน่งและ schema นั้นแทนเอกสารนี้
- ใช้ `.workbench/plans/` เฉพาะ durable project plan ที่ไม่มี workflow-specific location และตั้งชื่อแบบ kebab-case ที่สื่อความหมาย
- ใช้ไฟล์เดิมเมื่อแก้แผนรอบใหม่ เพื่อให้ Plannotator แสดง plan diff ได้
- แบ่งขั้นตอนเป็น phase และใช้ Markdown checkbox สำหรับงานที่ลงมือทำได้
- ระบุ verification ของแต่ละ phase และทำเครื่องหมายเสร็จเมื่อ verification ผ่านแล้วเท่านั้น
- บันทึก blocker, decision และ next action ใน `Handoff` ก่อนหยุดงานที่ยังไม่เสร็จ
- ห้ามเก็บ secret, raw transcript, cache, log หรือ generated artifact ในแผน
- Managed continuity ledger ใต้ `.workbench/continuity/` ไม่อยู่ภายใต้รูปแบบนี้ ไม่ต้องเพิ่มใน index และถูกลบเมื่อจบงาน

## โครงสร้างแนะนำ

```markdown
# ชื่อแผน

> **Status:** draft | active | blocked | complete<br>
> **Created:** YYYY-MM-DD HH:mm<br>
> **Updated:** YYYY-MM-DD HH:mm<br>
> **Purpose:** ผลลัพธ์ที่ต้องการแบบสั้น

## Context
## Approach
## Files to modify
## Reuse
## Risks
## Decisions
## Steps
### Phase 1 — ชื่อ phase
- [ ] งานที่ต้องทำ
- [ ] Verification ของ phase
## Handoff
## Change log
```

## Decisions

- 2026-08-22 — ให้ workflow/skill เป็นเจ้าของ plan path; `.workbench/plans/` เหลือเป็น fallback สำหรับ durable project plan และไม่ใช้เก็บ managed continuity ledger
- 2026-08-05 — ใช้ Markdown ธรรมดาตามกติกา `.workbench/` และให้ checklist เป็นข้อมูลร่วมระหว่าง plan file กับ terminal widget

## Change log

- 2026-08-22 12:40 — แยก workflow-owned artifact และ managed continuity ledger ออกจาก fallback durable plan
- 2026-08-05 12:04 — สร้างแนวทางกลางสำหรับ Plannotator plans
