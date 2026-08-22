# Workspace Guidelines

## `.workbench/` — พื้นที่ทำงานร่วมกัน

- ใช้เก็บเอกสารประกอบที่มนุษย์กับ AI ต้องกลับมาอ่านหรือทำงานต่อ เช่น แผนงาน, research, decisions และบันทึกการทำงาน
- จัดเอกสารเป็นโฟลเดอร์ตามหัวข้อหรือวัตถุประสงค์ และตั้งชื่อไฟล์ให้สื่อความหมาย
- ก่อนสร้างไฟล์ใหม่ ให้ค้นหาเอกสารหัวข้อเดียวกันและปรับไฟล์เดิมเมื่อเหมาะสม เพื่อลดข้อมูลซ้ำหรือขัดแย้งกัน
- เอกสารแต่ละไฟล์ควรเริ่มด้วยหัวข้อ ตามด้วย `Status`, `Created`, `Updated` และ `Purpose` แบบสั้น ๆ โดยใช้เวลาท้องถิ่นรูปแบบ `YYYY-MM-DD HH:mm`
- เปลี่ยน `Updated` เมื่อแก้สาระสำคัญ ไม่จำเป็นต้องเปลี่ยนเมื่อแก้คำผิดหรือจัดรูปแบบ
- บันทึกการตัดสินใจพร้อมเหตุผลไว้ในหัวข้อ `Decisions` เมื่อมี และเพิ่ม `Change log` เฉพาะการเปลี่ยนแปลงสาระสำคัญ โดยเรียงรายการใหม่ไว้ด้านบน
- ดูภาพรวมจาก `.workbench/index.md` และอัปเดต index เมื่อเพิ่ม ย้าย เปลี่ยนสถานะ หรือเปลี่ยนวัตถุประสงค์ของเอกสาร
- ไม่ใช้ YAML frontmatter หรือ schema ซับซ้อน ให้เน้นความชัดเจน อ่านย้อนหลังง่าย และดูแลต่อได้

## แผนงานใหญ่และการส่งต่องาน

- หาก skill, workflow หรือผู้ใช้กำหนด path ของ plan artifact ให้ใช้ path และรูปแบบนั้นเป็นหลัก ห้ามย้ายหรือทำสำเนาเข้า folder กลางโดยพลการ
- หากงาน implementation ยังใหญ่แม้ผู้ใช้แบ่ง scope แล้ว หรือมีหลาย phase/verification จนเสี่ยงสูญเสียสถานะจาก context compaction ให้สร้าง continuity ledger ก่อนลงมือและอัปเดตหลังจบแต่ละช่วง
- เมื่อไม่มี caller-owned path ให้ใช้ managed ledger ใต้ `.workbench/continuity/`; ledger ชนิดนี้เป็น working state ไม่ต้องเพิ่มใน `.workbench/index.md` และให้ลบเมื่อผลลัพธ์กับ verification เสร็จครบ
- ใช้ `.workbench/plans/` เป็น fallback สำหรับ durable project plan ที่ไม่มี workflow-specific location เท่านั้น
- การใช้ Plannotator เป็นเรื่อง review/approval แยกจากการมี continuity ledger งานใหญ่อาจต้องมี ledger โดยไม่ต้องเปิด Plannotator
- แบ่งงานเป็น phase และ Markdown checklist พร้อมวิธี verification ทำเครื่องหมายเสร็จเมื่อผลลัพธ์และ verification ผ่านแล้วเท่านั้น
- ก่อนหยุดงานหรือหลังเปลี่ยน decision ให้อัปเดต completed work, blocker, verification และ exact next action ใน active plan/ledger เพื่อให้ resume หลัง compaction ได้
- อัปเดต `.workbench/index.md` เฉพาะ durable artifact ที่เพิ่ม ย้าย เปลี่ยนสถานะ หรือเปลี่ยนวัตถุประสงค์ ไม่รวม managed continuity ledger

## ภาษา

- ใช้ภาษาไทยเป็นภาษาเริ่มต้นในการพูดคุยกับผู้ใช้
- เอกสาร เนื้อหา และข้อความที่ AI สร้างขึ้นต้องใช้ภาษาไทยเป็นหลัก
- ชื่อเฉพาะ ศัพท์เทคนิค identifiers, source code, commands และข้อความที่ต้องตรงกับระบบ สามารถคงภาษาเดิมไว้ได้
- หากผู้ใช้ระบุภาษาอื่นอย่างชัดเจน ให้ปฏิบัติตามภาษาที่ผู้ใช้ร้องขอสำหรับงานนั้น

## Pi Extension Commands

- Command ที่เพิ่มโดย extension ซึ่งเขียนขึ้นเองใน `extensions/` ต้องใช้ prefix `mypi-`
- ชื่อ slash command ต้องอยู่ในรูป `/mypi-<command>` เช่น `/mypi-updates`
- กติกานี้ไม่ครอบคลุม command จาก Pi เองหรือ third-party packages
