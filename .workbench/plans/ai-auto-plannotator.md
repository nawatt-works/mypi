# ให้ AI ตัดสินใจเปิด Plannotator

> **Status:** complete<br>
> **Created:** 2026-08-09 09:02<br>
> **Updated:** 2026-08-09 09:10<br>
> **Purpose:** เพิ่มกลไกให้ AI เข้า Plannotator plan mode เองเมื่องานซับซ้อนหรือเสี่ยงสูญเสียบริบท โดยผู้ใช้ยังควบคุมได้

## Context

Plannotator ปัจจุบันเข้า plan mode ได้จาก `pi --plan`, `/plannotator`, shortcut หรือ event API แต่โมเดลไม่มี tool สำหรับขอเข้า mode เอง ทำให้ workflow ที่เริ่มจากการถามตอบและค่อยกลายเป็น implementation ขนาดใหญ่ยังต้องให้ผู้ใช้สั่งด้วยตนเอง

## Approach

เพิ่ม companion extension ซึ่งลงทะเบียน tool ให้โมเดลเรียก shared `plannotator:request` event พร้อมคำแนะนำตัดสินใจเฉพาะตอน Plannotator อยู่สถานะ idle รองรับโหมด `automatic`, `suggest` และ `off` โดยเก็บ override ใน session และให้ผู้ใช้ควบคุมผ่าน `/mypi-auto-plan`

## Files to modify

- `extensions/auto-plannotator.ts`
- `package.json`
- `tests/workflow-runtime.test.ts`
- `README.md`
- `.workbench/notes/persistent-todo-handoff.md`
- `.workbench/index.md`

## Reuse

- ใช้ shared event API `plannotator:request` ของ `@plannotator/pi-extension`
- ใช้ durable plan และ execution guidance เดิมจาก `extensions/plannotator-workflow.ts`
- ใช้ `ctx.getContextUsage()` เพื่อแจ้งความเสี่ยงจาก context โดยไม่สร้างตัวจำแนกงานแยกอีกโมเดลหนึ่ง

## Risks

- โมเดลอาจเปิด plan mode มากหรือน้อยเกินไป จึงต้องมีเกณฑ์ชัดเจนและ user override
- การเปลี่ยน phase เกิดกลาง agent run จึงต้องคืนคำแนะนำ planning ใน tool result ไม่พึ่ง system prompt ของ turn ถัดไปเพียงอย่างเดียว
- Plannotator อาจไม่ได้โหลดหรือไม่ตอบ event จึงต้อง timeout และรายงานข้อผิดพลาดแบบไม่ค้าง agent

## Decisions

- ให้โมเดลเป็นผู้ประเมินบริบท ไม่ใช้ keyword/จำนวนไฟล์แบบตายตัว
- ค่าเริ่มต้นเป็น `automatic`; `suggest` ขอการยืนยันก่อนเข้า plan mode และ `off` ปิด tool
- การเปิด plan mode เป็นการตัดสินใจของ AI แต่การอนุมัติแผนใน Browser UI ยังเป็นของผู้ใช้
- เก็บ mode override เป็น session state เพื่อให้ branch/resume ทำงานสอดคล้องกัน โดยค่า default กลับเป็น `automatic`

## Steps

### Phase 1 — Companion extension

- [x] สร้าง pure helpers สำหรับ mode, prompt guidance และผลตอบกลับจาก event
- [x] ลงทะเบียน AI tool, shared-event request และ `/mypi-auto-plan`
- [x] Verification: syntax/runtime import และ unit tests ของ helper ผ่าน

### Phase 2 — Integration และ documentation

- [x] เพิ่ม extension ใน package manifest ตามลำดับหลัง Plannotator
- [x] อัปเดต README และบันทึก workflow ให้ระบุ automatic/suggest/off และ user override
- [x] อัปเดต `.workbench/index.md`
- [x] Verification: `npm test` ผ่านและตรวจ `git diff --check`

## Verification

- `npm test`
- `git diff --check`
- ตรวจว่า package manifest โหลด Plannotator ก่อน companion extension

## Handoff

งานเสร็จและ verification ผ่าน ไม่มี blocker หลังใช้ `/reload` หรือเปิด Pi ใหม่ AI จะเลือกเข้า Plannotator ได้ ค่าเริ่มต้นเป็น `automatic` และเปลี่ยนราย session ด้วย `/mypi-auto-plan`

## Change log

- 2026-08-09 09:10 — เพิ่ม companion extension, tests, package integration และเอกสารครบ พร้อมปิดแผนหลัง verification ผ่าน
- 2026-08-09 09:02 — สร้างแผนและกำหนด default mode, event integration และ user override
