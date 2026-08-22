# Extension Review

> **Status:** ดำเนินการบางส่วน<br>
> **Created:** 2026-07-27 02:31<br>
> **Updated:** 2026-08-22 11:57<br>
> **Purpose:** บันทึกผลประเมิน third-party extensions และแนวทางปรับ Pi setup

## ข้อสรุป

### `pi-mcp-adapter`

- คุณภาพสูงและเหมาะกับ Pi แบบ context-efficient
- ใช้ proxy tool เดียวและค้นหา MCP tools เมื่อต้องใช้
- รองรับ lazy connection, metadata cache, OAuth, output guard และ MCP lifecycle
- ควรใช้ของเดิม ไม่คุ้มเขียนใหม่
- ควรปิด direct tools และ sampling ถ้าไม่ได้ใช้งาน

### `pi-web-access`

- คุณภาพดี แต่มี capability และ fallback จำนวนมาก
- ส่ง tool หลักให้ model เพียงไม่กี่ตัว แต่มี runtime surface ขนาดใหญ่
- ควรใช้ของเดิมและปิด curator, browser cookies, GitHub clone, YouTube และ video หากไม่ต้องใช้
- การเขียนรุ่นเล็กเองเหมาะเฉพาะกรณีที่ต้องการเพียง search/fetch และยอมลด SSRF protection, extraction fallback, citations และ paging

### `@narumitw/pi-chrome-devtools`

- เป็น native Pi extension ที่เล็กและเหมาะกับงานพื้นฐาน
- รองรับ list/select page, navigate, JavaScript evaluation และ screenshot
- ถ้าต้องการ console, network, click/fill, Lighthouse หรือ performance tracing ให้พิจารณาใช้ official `chrome-devtools-mcp` ผ่าน `pi-mcp-adapter`
- หากเน้น UI testing ให้พิจารณา Playwright MCP
- ไม่ควรเปิด browser tools สองชุดพร้อมกัน

### `@plannotator/pi-extension`

- นำมาใช้แล้วที่เวอร์ชัน `0.25.1` สำหรับ plan review และ code review
- ใช้ Browser UI ตอนตรวจและอนุมัติแผน และใช้ terminal widget ตอน execution
- เสริมด้วย `plannotator-workflow.ts` เพื่อให้แผนอยู่ใน `.workbench/plans/` และมี verification กับ handoff ตามกติกา workspace
- ต้องโหลด `plannotator-workflow.ts` หลัง Plannotator เพื่อให้คำแนะนำของโปรเจกต์ต่อท้าย phase system prompt ได้

## Guardrails Coverage

เปลี่ยนชื่อ `external-write-gate.ts` เป็น `guardrails.ts` เพื่อให้ตรงกับขอบเขตที่ครอบคลุมมากกว่า external file writes

### ป้องกันเพิ่มแล้ว

- ตรวจ nested `mcp({ tool, args })` และ direct custom tools ที่มีลักษณะอ่านหรือแก้ filesystem
- ถามก่อน `fetch_content` อัปโหลด local video ไปยัง external AI provider
- ถามก่อน PDF URL ที่ลงท้าย `.pdf` เขียนผล extraction ไปยัง `~/Downloads`
- ตรวจ `chrome_devtools_screenshot.savePath` เมื่อระบุ path นอก workspace
- ตรวจ shell upload/download ที่ระบุ path เช่น `curl`, `wget`, `scp` และ `rsync`
- ถามก่อนอ่าน sensitive environment variables และขยายรูปแบบ secret files ที่รู้จัก
- ยอมให้ managed temporary files ที่ tool สร้างเองและไม่ได้ระบุ output path เช่น screenshot หรือ GitHub clone cache ใต้ `/tmp`
- ใช้ temporary root ที่ harness หรือ OS กำหนด โดยไม่แก้ `TMPDIR`, `TMP` หรือ `TEMP`
- ยอม temporary root จาก `os.tmpdir()` และ `/dev/null` แบบเจาะจง ส่วน path ภายนอกอื่นยังใช้ approval flow เดิม

### ข้อจำกัดที่ยังเหลือ

- Guardrails เห็นเฉพาะชื่อ tool และ arguments ก่อน execute หาก MCP server, extension หรือ local script ซ่อน side effect ไว้ภายในจะตรวจไม่ได้
- PDF ที่ URL ไม่มีนามสกุล `.pdf` แต่ server ตอบ `Content-Type: application/pdf` ยังเขียน `~/Downloads` ก่อนที่ guardrails จะรู้ผล
- Slash commands และ startup hooks ของ third-party extensions ไม่ผ่าน `tool_call`
- Browser actions มีความหมายตามหน้าเว็บ การถามทุก navigation/click จะรบกวนมากเกินไป จึงควรใช้ isolated browser profile เมื่อต้องการ hard boundary
- การรับประกันว่าเขียนไม่ได้จริงต้องใช้ OS sandbox/container เพิ่มเติม ไม่สามารถทำด้วย Pi extension เพียงตัวเดียว

## แนวทางที่ยังต้องตัดสินใจ

- เก็บ `pi-mcp-adapter`
- เก็บ `pi-web-access` แต่ปิด capability ที่ไม่ใช้
- เลือก browser integration เพียงชุดเดียวและพิจารณา isolated profile
- หลังตัดสินใจแล้วค่อยย้าย package ที่เลือกมา pin ใน `my-pi/package.json`

## Decisions

- 2026-08-22 — ยกเลิก workspace-local runtime เพราะ harness และ tools จำนวนหนึ่งจัดการ temporary lifecycle เองอยู่แล้ว ให้ใช้ default temporary root ของแต่ละ harness และย้าย extension caches ตามไปด้วย
- 2026-08-05 — นำ Plannotator มาใช้แทนการพัฒนา Plan/Todo UI ใหม่ และเก็บ handoff ถาวรใน `.workbench/`
- 2026-08-05 — ใช้ `.runtime/tmp` เป็น default temp พร้อม block system temp ที่ AI ระบุเอง; decision นี้ถูกแทนที่เมื่อ 2026-08-22
- 2026-07-27 — ไม่ถามทุก browser navigation/click เพราะสร้าง prompt noise สูง ให้ใช้ isolated browser profile เมื่อต้องการขอบเขตที่เข้มงวด
- 2026-07-27 — เปลี่ยนชื่อ custom policy extension เป็น Guardrails เพราะครอบคลุม secrets, uploads, MCP และ custom tools มากกว่า external writes
- 2026-07-27 — ยังไม่เปลี่ยน setup จนกว่าจะคุยรายละเอียดและเลือก browser integration ที่ต้องการ เพื่อลด tools ที่ทำหน้าที่ซ้ำกัน
- 2026-07-27 — ใช้ third-party implementations ต่อแทนการเขียนใหม่ เพราะ capability และการป้องกันความเสี่ยงครอบคลุมกว่ารุ่นเล็กที่เขียนเอง

## Change log

- 2026-08-22 11:57 — ถอด workspace-local runtime และเปลี่ยน guardrails กับ extension caches ให้ใช้ temporary root ของ harness หรือ OS
- 2026-08-05 12:04 — เพิ่มผลประเมินและการนำ Plannotator มาใช้ พร้อมนโยบาย `.runtime/tmp`, `/dev/null` และ explicit system temp
- 2026-07-27 09:19 — เพิ่ม Guardrails สำหรับ MCP, custom tools, local uploads, PDF output, Chrome screenshot และ shell/environment risks พร้อมบันทึกข้อจำกัดที่ยังเหลือ
- 2026-07-27 08:55 — เพิ่มข้อมูลสถานะ วัตถุประสงค์ การตัดสินใจ และประวัติเอกสาร
- 2026-07-27 02:31 — สร้างบันทึกผลประเมิน extensions
