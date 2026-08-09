# Persistent Todo + Handoff

> **Status:** นำมาใช้แล้ว<br>
> **Created:** 2026-07-27 01:41<br>
> **Updated:** 2026-08-09 09:02<br>
> **Purpose:** กำหนด workflow สำหรับติดตามงานใหญ่และส่งต่อบริบทข้าม session โดยใช้ Plannotator ร่วมกับ `.workbench/`

## รูปแบบที่นำมาใช้

- **AI-selected planning** — ใช้ `auto-plannotator.ts` ให้ AI ประเมินความซับซ้อนและเข้า plan mode เอง โดยผู้ใช้เลือก `automatic`, `suggest` หรือ `off` ต่อ session ได้
- **Plan review** — ใช้ `@plannotator/pi-extension` เปิด browser เพื่อตรวจ แก้ และอนุมัติแผนก่อน implementation
- **Live Todo** — ใช้ checklist widget ของ Plannotator แสดงงานที่เสร็จแล้วและงานที่เหลือใน terminal
- **Durable plan** — เก็บ Markdown plan ที่ `.workbench/plans/<ชื่องาน>.md`
- **Handoff** — บันทึก blocker, decisions, verification และ next action ลงในแผนเดียวกัน

Plannotator เป็น UI และตัวติดตามสถานะขณะทำงาน ส่วน `.workbench/` เป็น source of truth ที่อ่านต่อได้โดยไม่พึ่ง session หรือ extension เพียงตัวเดียว

## Workflow

1. ในโหมด `automatic` AI ประเมินว่าการ implementation ต้องมี durable plan หรือไม่; ผู้ใช้ยังบังคับด้วย `pi --plan`, `/plannotator` หรือข้อความกำกับได้
2. หากเข้า plan mode AI สร้างหรือแก้แผนเดิมใต้ `.workbench/plans/` โดยแบ่ง phase และ checklist
3. ผู้ใช้ตรวจและอนุมัติผ่าน Browser UI เสมอก่อน execution
4. ระหว่าง execution ให้ terminal widget แสดง checklist และอัปเดตเฉพาะเมื่อ verification ผ่าน
5. เมื่อจบ phase หรือหยุดกลางทาง ให้อัปเดต `Status`, `Updated`, `Decisions` และ `Handoff`
6. อัปเดต `.workbench/index.md` เมื่อเพิ่มแผนหรือเปลี่ยนสถานะหรือวัตถุประสงค์

## ข้อจำกัดและงานที่ยังเหลือ

- Progress ของ Plannotator อาศัย Markdown checkbox และ `[DONE:n]` จึงต้องยืนยันด้วยผล verification ไม่ใช่เชื่อ marker เพียงอย่างเดียว
- Plannotator เก็บ phase state ใน Pi session แต่ handoff ข้าม session ที่เชื่อถือได้ยังอาศัยข้อมูลในไฟล์แผน
- การประเมินว่าจะใช้ plan เป็นการตัดสินใจของโมเดล จึงอาจเปิดมากหรือน้อยเกินไป ผู้ใช้ใช้ `/mypi-auto-plan suggest|off` หรือกำกับเป็นข้อความได้
- mode override ของ `/mypi-auto-plan` มีผลเฉพาะ session; session ใหม่กลับไปใช้ `automatic`
- ยังไม่มีคำสั่ง `/mypi-resume` ที่ค้นหาแผน active ล่าสุดและโหลด handoff ให้อัตโนมัติ
- หลาย session ที่แก้แผนไฟล์เดียวกันพร้อมกันยังเสี่ยงชนกัน ควรแยก plan file ต่อชื่องาน
- ยังไม่ล้างหรือ archive แผนอัตโนมัติ ผู้ใช้และ AI เปลี่ยนสถานะเอกสารตาม lifecycle ของงาน

## Decisions

- 2026-08-09 — ให้ AI เรียก companion tool เพื่อเข้า Plannotator เองแทน keyword classifier เพราะโมเดลเห็นบริบทและการเปลี่ยนจาก discussion ไป implementation ได้ดีกว่า
- 2026-08-09 — ใช้ `automatic` เป็นค่าเริ่มต้น แต่คง Browser approval และเพิ่ม `suggest`, `off` กับ explicit user override เพื่อลดการเปิด plan เกินจำเป็น
- 2026-08-09 — inject context usage warning ตั้งแต่ 60% เพื่อให้โมเดลพิจารณาสร้าง durable state ก่อน compaction โดยไม่บังคับเปิดจากเปอร์เซ็นต์เพียงอย่างเดียว
- 2026-08-05 — ใช้ Plannotator โดยตรงแทนการเขียน Todo UI ใหม่ เพราะมี Browser review, terminal widget, phase state และ Pi integration อยู่แล้ว
- 2026-08-05 — เก็บ durable plan และ handoff ใน `.workbench/plans/` เพื่อให้ทำงานต่อได้แม้ไม่มี state จาก session เดิม
- 2026-08-05 — ใช้ checklist ร่วมกับ verification และ `[DONE:n]`; marker เพียงอย่างเดียวไม่เพียงพอสำหรับถือว่างานเสร็จ
- 2026-08-05 — ยังไม่สร้าง extension handoff แยกจนกว่าจะมีความต้องการ `/mypi-resume` หรือพบว่าการอ่านแผนเดิมไม่เพียงพอ
- 2026-07-27 — วางแนวทางให้ Todo และ Handoff อยู่ใน extension เดียวกัน เพื่อให้สถานะงานและบริบทส่งต่อใช้ข้อมูลชุดเดียวกัน
- 2026-07-27 — ยังไม่เริ่มพัฒนาจนกว่าจะตกลงรูปแบบข้อมูล การโหลดเข้า context และพฤติกรรมเมื่อมีหลาย session

## Change log

- 2026-08-09 09:02 — เพิ่ม AI-selected planning, mode controls, context-risk guidance และอัปเดต workflow/ข้อจำกัด
- 2026-08-05 12:04 — เลือกใช้ Plannotator ร่วมกับ `.workbench/plans/` และกำหนด workflow, ข้อจำกัด และ handoff ที่ต้องบันทึก
- 2026-07-27 08:55 — เพิ่มข้อมูลสถานะ วัตถุประสงค์ การตัดสินใจ และประวัติเอกสาร
- 2026-07-27 01:41 — สร้างบันทึกแนวคิด Persistent Todo และ Handoff
