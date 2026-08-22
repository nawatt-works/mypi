# Workspace Guidelines

## Artifact ownership และตำแหน่งไฟล์

- ใช้ path, รูปแบบ และ lifecycle ที่ผู้ใช้, tool, skill, workflow หรือ AI harness ซึ่งเป็นเจ้าของ artifact กำหนดไว้
- ห้ามย้าย ทำสำเนา เปลี่ยน schema เพิ่ม metadata/index หรือลบ artifact ของกลไกอื่น เพียงเพื่อให้เข้ากับ convention ของ workspace นี้
- ห้ามอนุมานว่า `.workbench/`, `workbench/`, `workspace-meta/`, `docs/` หรือชื่อ folder ทั่วไปอื่นเป็นที่เก็บ artifact โดยอัตโนมัติ
- `docs/` เก็บเฉพาะเอกสารของ repository `my-pi` ที่ maintain อยู่ใน project นี้ ไม่ใช่ folder กลางสำหรับ notes, plans หรือ output จาก AI ทุกตัว
- `workspace-meta/` ใช้ได้เมื่อ repository นำ metadata type หรือ contract ระดับ workspace มาใช้อย่างชัดเจนเท่านั้น ไม่ใช้เป็น catch-all สำหรับ notes, plans, prompts, generated output หรือ temporary files
- ไฟล์ชั่วคราวใช้ตำแหน่ง default ของ harness หรือ OS เว้นแต่เครื่องมือเจ้าของไฟล์จะกำหนดเป็นอย่างอื่น

## แผนงานใหญ่และการส่งต่องาน

- หากงานยังใหญ่หรือเสี่ยงสูญเสียสถานะจาก context compaction ให้ใช้ planning/continuity mechanism ของ tool, skill, workflow หรือ harness ที่กำลังทำงานอยู่
- เมื่อมีกลไกระบุ plan path หรือรูปแบบไว้ ให้ใช้ค่าดังกล่าวตามเดิม หากไม่มี path หรือ convention เลย AI/harness ที่ทำงานนั้นเลือกตำแหน่งที่เหมาะสมภายใน workspace ได้เอง โดยไม่ทำให้ตำแหน่งนั้นกลายเป็นกฎกลางของ project
- `planning-workflow.ts` มีหน้าที่เก็บ pointer ของ active plan ใน Pi session และเตือนให้อ่านต่อหลัง compaction เท่านั้น ไม่เป็นเจ้าของตำแหน่ง เนื้อหา รูปแบบ หรือการลบไฟล์
- การใช้ Plannotator เป็นเรื่อง review/approval แยกจากการมี continuity ledger งานใหญ่อาจต้องมี ledger โดยไม่ต้องเปิด Plannotator
- การอัปเดต progress, checklist, handoff และ verification ให้เป็นไปตาม contract ของ artifact owner ไม่บังคับ schema กลางจาก workspace นี้

## ภาษา

- ใช้ภาษาไทยเป็นภาษาเริ่มต้นในการพูดคุยกับผู้ใช้
- เอกสาร เนื้อหา และข้อความที่ AI สร้างขึ้นต้องใช้ภาษาไทยเป็นหลัก
- ชื่อเฉพาะ ศัพท์เทคนิค identifiers, source code, commands และข้อความที่ต้องตรงกับระบบ สามารถคงภาษาเดิมไว้ได้
- หากผู้ใช้ระบุภาษาอื่นอย่างชัดเจน ให้ปฏิบัติตามภาษาที่ผู้ใช้ร้องขอสำหรับงานนั้น

## Pi Extension Commands

- Command ที่เพิ่มโดย extension ซึ่งเขียนขึ้นเองใน `extensions/` ต้องใช้ prefix `mypi-`
- ชื่อ slash command ต้องอยู่ในรูป `/mypi-<command>` เช่น `/mypi-updates`
- กติกานี้ไม่ครอบคลุม command จาก Pi เองหรือ third-party packages
