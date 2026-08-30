# ประวัติแผนของ My Pi

> **Status:** reference<br>
> **Created:** 2026-08-05 12:04<br>
> **Updated:** 2026-08-30 11:10<br>
> **Purpose:** เก็บแผน implementation ที่เป็นเอกสารของ repository `my-pi` และมีประโยชน์สำหรับอ้างอิงย้อนหลัง

ไฟล์ใน directory นี้เป็น project documentation ที่ย้ายมาจาก `.workbench/plans/` เพื่อให้มองเห็นได้จากเครื่องมือทั่วไป ไม่ใช่ default plan directory และไม่สร้างข้อกำหนดให้ AI tool, skill, workflow หรือ harness อื่น

เมื่อกลไกใดสร้าง plan ให้ใช้ path, schema, checklist, verification และ lifecycle ที่กลไกนั้นกำหนดไว้ ไม่ต้องคัดลอกหรือแปลงมาไว้ใน directory นี้ การเพิ่มเอกสารใหม่ที่นี่ควรเกิดขึ้นเฉพาะเมื่อเอกสารนั้นเป็นส่วนหนึ่งของการ maintain repository `my-pi` โดยตรง

## Current plans

- [จัด My Pi เป็น Capability Packages และ Pinned Releases](capability-packages-and-pinned-releases.md) — active; checkpoint `ae81d9d`พร้อมและรอ human `v0.2.0` tag/push/Default install decision
- [ปรับ Pi/Herdr Coordinator เป็น Delegated Autonomy](delegated-autonomy-coordinator.md) — paused หลัง pure registriesผ่าน; exact nextชี้กลับมาที่ capability migration

## Decisions

- 2026-08-30 — ใช้ capability packageเป็นหน่วย ownership/deployment, stable-only global release, `capabilities/{global,project-opt-in,incubator}` และ pinned Git release
- 2026-08-22 — ย้าย project-owned plan history จาก hidden `.workbench/plans/` มา `docs/plans/`
- 2026-08-22 — ยกเลิกสถานะของ directory นี้ในฐานะ fallback กลางสำหรับ plan
- 2026-08-22 — artifact owner เป็นผู้กำหนด path, format และ lifecycle; `my-pi` ไม่เพิ่ม schema กลาง

## Change log

- 2026-08-30 11:10 — บันทึก atomic capability checkpoint `ae81d9d`; Phase 6รอ human release actions
- 2026-08-30 11:00 — Phase 5 verificationผ่านครบและเลือก root release version `0.2.0`
- 2026-08-30 10:30 — capability migration implementครบ 11 packages; Phase 5ตรวจ links/diff/smokeก่อน atomic commit
- 2026-08-30 10:00 — capability Phase 0 inventoryครบ, baseline `142/142`; exact nextคือยืนยัน package grouping
- 2026-08-30 09:20 — รวม global, project opt-inและ incubator lanesไว้ใต้ `capabilities/`
- 2026-08-30 09:10 — เพิ่ม current plan linksและเปิด capability-package/pinned-release migrationเป็นงานหลักก่อน Worker profile
- 2026-08-22 16:15 — เปลี่ยนจาก planning policy เป็น project documentation reference และย้ายมา `docs/plans/`
- 2026-08-22 12:40 — แยก workflow-owned artifact และ continuity tracking ออกจาก fallback durable plan
- 2026-08-05 12:04 — สร้างแนวทางกลางสำหรับ Plannotator plans ซึ่งภายหลังถูกยกเลิก
