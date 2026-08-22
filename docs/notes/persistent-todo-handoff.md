# Persistent Todo + Handoff

> **Status:** นำมาใช้แล้ว<br>
> **Created:** 2026-07-27 01:41<br>
> **Updated:** 2026-08-22 16:15<br>
> **Purpose:** อธิบายการรักษาสถานะงานใหญ่ข้าม turn, compaction และ session โดยไม่แย่ง ownership ของ plan artifact จากผู้ใช้, skill, workflow หรือ harness

## รูปแบบที่นำมาใช้

- **Artifact ownership** — ผู้ใช้, skill, workflow หรือ harness ที่สร้าง artifact เป็นเจ้าของ path, schema, update policy และ lifecycle
- **Automatic continuity guidance** — `planning-workflow.ts` ให้ AI ประเมินว่างานใหญ่ควรมี continuity file หรือไม่ แต่ไม่เลือก folder หรือสร้างรูปแบบเอกสารให้
- **Pointer-only tracking** — `mypi_start_work_plan` รับ exact workspace-relative Markdown path แล้วเก็บ pointer ใน Pi session โดยไม่สร้างหรือแก้ไฟล์
- **Recovery guidance** — inject active path กลับทุก turn เพื่อให้อ่าน source of truth หลัง compaction/resume
- **Non-owning finish** — `mypi_finish_work_plan` ปิด session pointer เท่านั้น ไม่ archive, move หรือ delete artifact
- **Optional plan review** — ใช้ Plannotator เฉพาะเมื่อ human review, annotation หรือ approval มีประโยชน์ โดย reuse active path ได้

Plan file เป็น source of truth ตาม contract ของ artifact owner ส่วน Pi session เก็บ pointer และ Plannotator เป็น optional UI เท่านั้น

## Workflow

1. AI ประเมิน continuity จากจำนวน phase, dependency, verification และความเสี่ยงจาก compaction โดยไม่ผูกกับ Browser UI
2. ให้ผู้ใช้, skill, workflow, harness หรือ project convention เลือก path และรูปแบบ จากนั้นสร้างหรือแก้ไฟล์ผ่านกลไกของเจ้าของ artifact
3. เรียก `mypi_start_work_plan` ด้วย exact path เพื่อลงทะเบียน pointer
4. อ่านและอัปเดต active plan ตาม contract ของเจ้าของ artifact ไม่เพิ่ม metadata, checklist หรือ index จากกฎของ `my-pi`
5. พิจารณา Plannotator แยกต่างหาก หากต้อง review ให้ submit active path เดิม
6. เมื่อ workflow เจ้าของงานถือว่าเสร็จหรือยกเลิก ให้เรียก `mypi_finish_work_plan` เพื่อหยุด tracking โดย lifecycle ของไฟล์ยังเป็นของเจ้าของเดิม

## ข้อจำกัดและงานที่ยังเหลือ

- ถ้าไม่มี project หรือ harness convention เลย AI ยังต้องเลือก path ที่เหมาะสมเอง แต่ extension จะไม่สร้าง default folder แฝง
- การประเมิน continuity เป็นการตัดสินใจของโมเดลและอาจแนะนำ plan มากหรือน้อยเกินไป ผู้ใช้ปิด automatic guidance ราย session ได้ด้วย `/mypi-continuity off`
- mode override มีผลเฉพาะ session; session ใหม่กลับไปใช้ `automatic`
- หลาย session ที่แก้ plan เดียวกันพร้อมกันยังเสี่ยงชนกัน เจ้าของ artifact ต้องกำหนด coordination
- Progress ของ Plannotator อาศัย Markdown checkbox และ `[DONE:n]`; ใช้ได้เฉพาะเมื่อ format ของ plan รองรับ และยังต้องยืนยันด้วย verification จริง

## Decisions

- 2026-08-22 — extension เก็บเฉพาะ pointer และไม่สร้าง, rewrite, move, index หรือ delete plan file
- 2026-08-22 — ไม่กำหนด fallback จากชื่อ `.workbench/`, `workbench/`, `workspace-meta/` หรือ folder convention อื่น
- 2026-08-22 — `workspace-meta/` ไม่ใช่ plan store; ใช้เฉพาะ workspace metadata/contract ที่ประกาศใช้อย่างชัดเจน
- 2026-08-22 — แยก artifact ownership, continuity และ human review เป็นสาม decision อิสระ
- 2026-08-22 — เก็บ session pointer แล้ว inject active path ทุก turn เพื่อให้ recovery หลัง compaction ไม่พึ่ง summary เพียงอย่างเดียว
- 2026-08-09 — ใช้ automatic Plannotator เป็นค่าเริ่มต้น; decision นี้ถูกแทนที่เพราะ continuity ไม่ควรบังคับ human review
- 2026-08-05 — ใช้ Plannotator โดยตรงแทนการเขียน Todo UI ใหม่ เพราะมี Browser review, terminal widget, phase state และ Pi integration อยู่แล้ว

## Change log

- 2026-08-22 16:15 — ถอด managed fallback, skeleton schema และ auto-delete ออกจาก extension ให้ artifact owner ควบคุมไฟล์ทั้งหมด
- 2026-08-22 12:51 — แยก `off` ให้ปิดเฉพาะ automatic guidance โดย caller-driven plan ยังใช้งานได้
- 2026-08-22 12:40 — รื้อ auto-Plannotator เป็น caller-routed planning, automatic continuity และ optional review
- 2026-08-09 09:02 — เพิ่ม AI-selected planning, mode controls และ context-risk guidance
- 2026-08-05 12:04 — เลือกใช้ Plannotator สำหรับ plan review และ execution checklist
- 2026-07-27 01:41 — สร้างบันทึกแนวคิด Persistent Todo และ Handoff
