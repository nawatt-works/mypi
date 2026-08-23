# Persistent Todo + Handoff

> **Status:** นำมาใช้แล้ว<br>
> **Created:** 2026-07-27 01:41<br>
> **Updated:** 2026-08-23 11:19<br>
> **Purpose:** อธิบายการรักษาสถานะงานใหญ่ข้าม turn, compaction และ session โดยไม่แย่ง ownership ของ plan artifact จากผู้ใช้, skill, workflow หรือ harness

## รูปแบบที่นำมาใช้

- **Artifact ownership** — ผู้ใช้, skill, workflow หรือ harness ที่สร้าง artifact เป็นเจ้าของ path, schema, update policy และ lifecycle
- **Automatic continuity guidance** — `planning-workflow.ts` ให้ AI ประเมินว่างานใหญ่ควรมี continuity state หรือไม่ โดยไม่บังคับให้เกิดไฟล์
- **Session-internal tracking** — ถ้า plan มีไว้ให้ AI ทำงานต่อเอง `mypi_start_work_plan` รับ compact snapshot และเก็บใน Pi session โดยไม่สร้างไฟล์ใน workspace; อัปเดตแบบ replacement ด้วย `mypi_update_work_plan`
- **Workspace pointer tracking** — ถ้า plan เป็น artifact `mypi_start_work_plan` รับ exact workspace-relative Markdown path แล้วเก็บ pointer โดยไม่สร้างหรือแก้ไฟล์
- **Recovery guidance** — inject session snapshot หรือ active path กลับทุก turn หลัง compaction/resume
- **Non-owning finish** — `mypi_finish_work_plan` ปิด active session state เท่านั้น ไม่ archive, move หรือ delete workspace artifact
- **Optional plan review** — ใช้ Plannotator เฉพาะกับ workspace plan เมื่อ human review, annotation หรือ approval มีประโยชน์

Session-internal plan เป็น AI working state ไม่ใช่ artifact หรือ confidential storage ส่วน workspace plan เป็น source of truth ตาม contract ของ artifact owner และ Plannotator เป็น optional UI สำหรับ workspace plan เท่านั้น

## Workflow

1. AI ประเมิน continuity จากจำนวน phase, dependency, verification และความเสี่ยงจาก compaction โดยไม่ผูกกับ Browser UI
2. ถ้าใช้เพื่อติดตามงานของ AI เท่านั้น เรียก `mypi_start_work_plan` โดยส่ง compact `snapshot` และไม่ส่ง `filePath`
3. อัปเดต snapshot หลังมี progress, decision, blocker, verification หรือ exact next action เปลี่ยน โดยเก็บเฉพาะ working state ที่กระชับ สรุป untrusted content แทนการคัดลอก embedded instructions และไม่เก็บ private chain-of-thought
4. ถ้า plan ต้องเป็น workspace artifact ให้เจ้าของ artifact เลือก path/format และสร้างไฟล์ จากนั้นเรียก `mypi_start_work_plan` ด้วย exact `filePath`
5. อ่านและอัปเดต workspace plan ตาม contract ของเจ้าของ artifact ไม่เพิ่ม metadata, checklist หรือ index จากกฎของ `my-pi`
6. พิจารณา Plannotator แยกต่างหากและใช้เฉพาะ workspace path; extension ไม่แปลง session plan เป็นไฟล์อัตโนมัติ
7. เมื่อเสร็จหรือยกเลิก ให้เรียก `mypi_finish_work_plan` เพื่อหยุด tracking โดย lifecycle ของ workspace file ยังเป็นของเจ้าของเดิม

## ข้อจำกัดและงานที่ยังเหลือ

- Session-internal plan ผูกกับ Pi session; ephemeral/in-memory session อาจไม่รอด process restart และ session ใหม่ที่ไม่ได้ resume จะไม่เห็น state เดิม
- Session storage ไม่ใช่พื้นที่ลับ จึงห้ามเก็บ credentials, secrets หรือ private chain-of-thought
- ถ้า workspace artifact จำเป็นแต่ไม่มี project หรือ harness convention เจ้าของงานยังต้องเลือก path ที่เหมาะสมเอง โดย extension จะไม่สร้าง default folder แฝง
- การประเมิน continuity เป็นการตัดสินใจของโมเดลและอาจแนะนำ plan มากหรือน้อยเกินไป ผู้ใช้ปิด automatic guidance ราย session ได้ด้วย `/mypi-continuity off`
- mode override มีผลเฉพาะ session; session ใหม่กลับไปใช้ `automatic`
- หลาย session ที่แก้ plan เดียวกันพร้อมกันยังเสี่ยงชนกัน เจ้าของ artifact ต้องกำหนด coordination
- Progress ของ Plannotator อาศัย Markdown checkbox และ `[DONE:n]`; ใช้ได้เฉพาะเมื่อ format ของ plan รองรับ และยังต้องยืนยันด้วย verification จริง

## Decisions

- 2026-08-23 — ให้ AI-only plan ใช้ compact snapshot ใน Pi session เป็นค่าเริ่มต้น โดยไม่สร้าง workspace file
- 2026-08-23 — ใช้ explicit `filePath` เป็นเส้นแบ่ง workspace artifact และไม่ promote ข้ามโหมดอัตโนมัติ
- 2026-08-23 — จำกัด Plannotator ไว้กับ workspace plan และเพิ่ม `mypi_update_work_plan` สำหรับ session snapshot
- 2026-08-22 — extension รุ่น pointer-only ไม่สร้าง, rewrite, move, index หรือ delete plan file; ถูกขยายเป็นสอง storage mode เมื่อ 2026-08-23
- 2026-08-22 — ไม่กำหนด fallback จากชื่อ `.workbench/`, `workbench/`, `workspace-meta/` หรือ folder convention อื่น
- 2026-08-22 — `workspace-meta/` ไม่ใช่ plan store; ใช้เฉพาะ workspace metadata/contract ที่ประกาศใช้อย่างชัดเจน
- 2026-08-22 — แยก artifact ownership, continuity และ human review เป็นสาม decision อิสระ
- 2026-08-22 — เก็บ session pointer แล้ว inject active path ทุก turn เพื่อให้ recovery หลัง compaction ไม่พึ่ง summary เพียงอย่างเดียว
- 2026-08-09 — ใช้ automatic Plannotator เป็นค่าเริ่มต้น; decision นี้ถูกแทนที่เพราะ continuity ไม่ควรบังคับ human review
- 2026-08-05 — ใช้ Plannotator โดยตรงแทนการเขียน Todo UI ใหม่ เพราะมี Browser review, terminal widget, phase state และ Pi integration อยู่แล้ว

## Change log

- 2026-08-23 11:19 — แยก session-internal AI plan ออกจาก workspace artifact และจำกัด Plannotator ให้ทำงานกับ workspace plan
- 2026-08-22 16:15 — ถอด managed fallback, skeleton schema และ auto-delete ออกจาก extension ให้ artifact owner ควบคุมไฟล์ทั้งหมด
- 2026-08-22 12:51 — แยก `off` ให้ปิดเฉพาะ automatic guidance โดย caller-driven plan ยังใช้งานได้
- 2026-08-22 12:40 — รื้อ auto-Plannotator เป็น caller-routed planning, automatic continuity และ optional review
- 2026-08-09 09:02 — เพิ่ม AI-selected planning, mode controls และ context-risk guidance
- 2026-08-05 12:04 — เลือกใช้ Plannotator สำหรับ plan review และ execution checklist
- 2026-07-27 01:41 — สร้างบันทึกแนวคิด Persistent Todo และ Handoff
