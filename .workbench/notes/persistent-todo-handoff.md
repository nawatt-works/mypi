# Persistent Todo + Handoff

> **Status:** นำมาใช้แล้ว<br>
> **Created:** 2026-07-27 01:41<br>
> **Updated:** 2026-08-22 12:51<br>
> **Purpose:** กำหนด workflow สำหรับให้ AI รักษาสถานะงานใหญ่ข้าม turn, compaction และ session โดยแยกจาก ownership ของ artifact และ human review

## รูปแบบที่นำมาใช้

- **Artifact routing** — workflow, skill หรือผู้ใช้เป็นเจ้าของ plan path และ schema เมื่อระบุมาชัดเจน
- **Automatic continuity** — `planning-workflow.ts` ให้ AI สร้าง/register workspace-backed ledger เมื่องานยังใหญ่หรือเสี่ยงสูญเสียสถานะจาก compaction
- **Managed fallback** — เมื่อไม่มี caller path ให้สร้าง ledger ใต้ `.workbench/continuity/`, ใช้ ignore policy ของแต่ละ workspace และลบหลังปิดงานที่ verify แล้ว
- **Optional plan review** — ใช้ `@plannotator/pi-extension` เฉพาะเมื่อ human review, annotation หรือ approval มีประโยชน์ โดย reuse active plan file
- **Live Todo** — เมื่อใช้ Plannotator ให้ checklist widget แสดงงานที่เสร็จและเหลือใน terminal
- **Recovery pointer** — เก็บ active plan path ใน Pi session entry และ inject กลับทุก turn เพื่อให้อ่าน source of truth หลัง compaction/resume

Plan file เป็น source of truth ของ execution state ส่วน Pi session เก็บ pointer และ Plannotator เป็น optional UI ไม่ใช่เจ้าของตำแหน่ง artifact

## Workflow

1. AI ประเมิน continuity จากจำนวน phase, dependency, verification และความเสี่ยงจาก compaction โดยไม่ผูกกับการเปิด Browser UI
2. หาก caller ระบุ path ให้ register path เดิม; หากไม่ระบุให้สร้าง managed ledger และเติม steps ก่อน implementation
3. อ่าน active plan ก่อนทำงานต่อ และอัปเดต completed work, decisions, blockers, verification กับ exact next action หลังแต่ละ material phase
4. พิจารณา Plannotator แยกต่างหาก หากต้อง review ให้เข้า plan mode และ submit active path เดิม
5. ปิด ledger เมื่อผลลัพธ์และ verification ครบ Managed ledger ถูกลบ ส่วน caller-owned artifact คงอยู่
6. เพิ่ม `.workbench/index.md` เฉพาะ durable artifact ไม่รวม managed continuity ledger

## ข้อจำกัดและงานที่ยังเหลือ

- Progress ของ Plannotator อาศัย Markdown checkbox และ `[DONE:n]` จึงต้องยืนยันด้วยผล verification ไม่ใช่เชื่อ marker เพียงอย่างเดียว
- การประเมิน continuity เป็นการตัดสินใจของโมเดลและอาจสร้าง ledger มากหรือน้อยเกินไป ผู้ใช้ปิด automatic guidance ราย session ได้ด้วย `/mypi-continuity off` โดย caller-driven plan ยังใช้งานได้
- mode override มีผลเฉพาะ session; session ใหม่กลับไปใช้ `automatic`
- หลาย session ที่แก้ caller-owned plan เดียวกันพร้อมกันยังเสี่ยงชนกัน เจ้าของ workflow ต้องแยก path หรือจัด coordination
- หาก process หยุดก่อนเรียก finish managed ledger จะคงอยู่เพื่อ resume; ยังไม่มี garbage collection สำหรับ ledger ที่ถูกทิ้งถาวร

## Decisions

- 2026-08-22 — แยก artifact ownership, continuity และ human review เป็นสาม decision อิสระ; caller path มี precedence สูงสุด
- 2026-08-22 — ใช้ managed ledger เฉพาะเมื่อไม่มี caller path และลบอัตโนมัติเฉพาะไฟล์ที่ extension สร้างเอง
- 2026-08-22 — เก็บ session pointer แล้ว inject active path ทุก turn เพื่อให้ recovery หลัง compaction ไม่พึ่ง summary เพียงอย่างเดียว
- 2026-08-09 — ให้ AI เรียก companion tool เพื่อเข้า Plannotator เองแทน keyword classifier เพราะโมเดลเห็นบริบทและการเปลี่ยนจาก discussion ไป implementation ได้ดีกว่า
- 2026-08-09 — ใช้ automatic Plannotator เป็นค่าเริ่มต้น; decision นี้ถูกแทนที่เมื่อ 2026-08-22 เพราะ continuity ไม่ควรบังคับ human review
- 2026-08-09 — inject context usage warning ตั้งแต่ 60%; ปัจจุบันใช้เป็นสัญญาณสร้าง continuity เท่านั้น ไม่บังคับเปิด Plannotator
- 2026-08-05 — ใช้ Plannotator โดยตรงแทนการเขียน Todo UI ใหม่ เพราะมี Browser review, terminal widget, phase state และ Pi integration อยู่แล้ว
- 2026-08-05 — เก็บ durable plan และ handoff ใน `.workbench/plans/` เพื่อให้ทำงานต่อได้แม้ไม่มี state จาก session เดิม
- 2026-08-05 — ใช้ checklist ร่วมกับ verification และ `[DONE:n]`; marker เพียงอย่างเดียวไม่เพียงพอสำหรับถือว่างานเสร็จ
- 2026-08-05 — ยังไม่สร้าง extension handoff แยกจนกว่าจะมีความต้องการ `/mypi-resume` หรือพบว่าการอ่านแผนเดิมไม่เพียงพอ
- 2026-07-27 — วางแนวทางให้ Todo และ Handoff อยู่ใน extension เดียวกัน เพื่อให้สถานะงานและบริบทส่งต่อใช้ข้อมูลชุดเดียวกัน
- 2026-07-27 — ยังไม่เริ่มพัฒนาจนกว่าจะตกลงรูปแบบข้อมูล การโหลดเข้า context และพฤติกรรมเมื่อมีหลาย session

## Change log

- 2026-08-22 12:51 — แยก `off` ให้ปิดเฉพาะ automatic guidance โดย caller-driven plan ยังใช้งานได้ และระบุว่า ignore policy เป็นของแต่ละ workspace
- 2026-08-22 12:40 — รื้อ auto-Plannotator เป็น caller-routed planning, automatic continuity ledger และ optional review
- 2026-08-09 09:02 — เพิ่ม AI-selected planning, mode controls, context-risk guidance และอัปเดต workflow/ข้อจำกัด
- 2026-08-05 12:04 — เลือกใช้ Plannotator ร่วมกับ `.workbench/plans/` และกำหนด workflow, ข้อจำกัด และ handoff ที่ต้องบันทึก
- 2026-07-27 08:55 — เพิ่มข้อมูลสถานะ วัตถุประสงค์ การตัดสินใจ และประวัติเอกสาร
- 2026-07-27 01:41 — สร้างบันทึกแนวคิด Persistent Todo และ Handoff
