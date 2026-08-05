# แนวทางเขียนแผนงานใหญ่

> **Status:** active<br>
> **Created:** 2026-08-05 12:04<br>
> **Updated:** 2026-08-05 12:04<br>
> **Purpose:** กำหนดตำแหน่งและโครงสร้างขั้นต่ำของแผนที่ใช้ร่วมกับ Plannotator

## การใช้งาน

- สร้างหนึ่งไฟล์ต่อหนึ่งชื่องานใน `.workbench/plans/` และตั้งชื่อแบบ kebab-case ที่สื่อความหมาย
- ใช้ไฟล์เดิมเมื่อแก้แผนรอบใหม่ เพื่อให้ Plannotator แสดง plan diff ได้
- แบ่งขั้นตอนเป็น phase และใช้ Markdown checkbox สำหรับงานที่ลงมือทำได้
- ระบุ verification ของแต่ละ phase และทำเครื่องหมายเสร็จเมื่อ verification ผ่านแล้วเท่านั้น
- บันทึก blocker, decision และ next action ใน `Handoff` ก่อนหยุดงานที่ยังไม่เสร็จ
- ห้ามเก็บ secret, raw transcript, cache, log หรือ generated artifact ในแผน

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

- 2026-08-05 — ใช้ Markdown ธรรมดาตามกติกา `.workbench/` และให้ checklist เป็นข้อมูลร่วมระหว่าง plan file กับ terminal widget

## Change log

- 2026-08-05 12:04 — สร้างแนวทางกลางสำหรับ Plannotator plans
