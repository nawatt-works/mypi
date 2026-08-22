# ประวัติแผนของ My Pi

> **Status:** reference<br>
> **Created:** 2026-08-05 12:04<br>
> **Updated:** 2026-08-22 16:15<br>
> **Purpose:** เก็บแผน implementation ที่เป็นเอกสารของ repository `my-pi` และมีประโยชน์สำหรับอ้างอิงย้อนหลัง

ไฟล์ใน directory นี้เป็น project documentation ที่ย้ายมาจาก `.workbench/plans/` เพื่อให้มองเห็นได้จากเครื่องมือทั่วไป ไม่ใช่ default plan directory และไม่สร้างข้อกำหนดให้ AI tool, skill, workflow หรือ harness อื่น

เมื่อกลไกใดสร้าง plan ให้ใช้ path, schema, checklist, verification และ lifecycle ที่กลไกนั้นกำหนดไว้ ไม่ต้องคัดลอกหรือแปลงมาไว้ใน directory นี้ การเพิ่มเอกสารใหม่ที่นี่ควรเกิดขึ้นเฉพาะเมื่อเอกสารนั้นเป็นส่วนหนึ่งของการ maintain repository `my-pi` โดยตรง

## Decisions

- 2026-08-22 — ย้าย project-owned plan history จาก hidden `.workbench/plans/` มา `docs/plans/`
- 2026-08-22 — ยกเลิกสถานะของ directory นี้ในฐานะ fallback กลางสำหรับ plan
- 2026-08-22 — artifact owner เป็นผู้กำหนด path, format และ lifecycle; `my-pi` ไม่เพิ่ม schema กลาง

## Change log

- 2026-08-22 16:15 — เปลี่ยนจาก planning policy เป็น project documentation reference และย้ายมา `docs/plans/`
- 2026-08-22 12:40 — แยก workflow-owned artifact และ continuity tracking ออกจาก fallback durable plan
- 2026-08-05 12:04 — สร้างแนวทางกลางสำหรับ Plannotator plans ซึ่งภายหลังถูกยกเลิก
