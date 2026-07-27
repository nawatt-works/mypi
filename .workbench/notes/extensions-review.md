# Extension Review

> **Status:** รอตัดสินใจ<br>
> **Created:** 2026-07-27 02:31<br>
> **Updated:** 2026-07-27 08:55<br>
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

## Permission Blind Spots

`external-write-gate` ตรวจได้เฉพาะ operation ที่มองเห็นจาก top-level tool call ปัจจุบัน แต่ไม่เห็น I/O ภายใน custom extension หรือ MCP server

- MCP filesystem tools อาจอ่านหรือเขียนนอก workspace โดย gate เห็นเพียง `mcp`
- `fetch_content` อาจอ่าน local video และส่งไปยัง external provider
- PDF extraction อาจเขียนไปยัง `~/Downloads`
- Browser tools สามารถกระทำกับ browser session ที่ล็อกอินอยู่

สิ่งที่ควรเขียนเพิ่มคือ policy layer สำหรับ `mcp`, `fetch_content` และ custom tools ไม่ใช่เขียน MCP/Web/Chrome implementation ใหม่ทั้งหมด

## แนวทางที่เสนอ

- เก็บ `pi-mcp-adapter`
- เก็บ `pi-web-access` แต่ปิด capability ที่ไม่ใช้
- เลือก browser integration เพียงชุดเดียว
- เพิ่ม custom-tool policy ใน permission gate
- หลังตัดสินใจแล้วค่อยย้าย package ที่เลือกมา pin ใน `my-pi/package.json`

## Decisions

- 2026-07-27 — ยังไม่เปลี่ยน setup จนกว่าจะคุยรายละเอียดและเลือก browser integration ที่ต้องการ เพื่อลด tools ที่ทำหน้าที่ซ้ำกัน
- 2026-07-27 — ใช้ third-party implementations ต่อแทนการเขียนใหม่ เพราะ capability และการป้องกันความเสี่ยงครอบคลุมกว่ารุ่นเล็กที่เขียนเอง

## Change log

- 2026-07-27 08:55 — เพิ่มข้อมูลสถานะ วัตถุประสงค์ การตัดสินใจ และประวัติเอกสาร
- 2026-07-27 02:31 — สร้างบันทึกผลประเมิน extensions
