# Code Intelligence Benchmark

> **Status:** เก็บไว้เพื่อทำซ้ำ<br>
> **Created:** 2026-08-21 09:43<br>
> **Updated:** 2026-08-22 16:34<br>
> **Purpose:** เก็บ benchmark harness, fixture และผลหลักที่ใช้ประกอบการประเมิน code-intelligence extensions โดยไม่พึ่งไฟล์ชั่วคราวของ AI harness

## ขอบเขต

ชุดนี้เปรียบเทียบ `pi-ast-grep`, `lsp-pi`, `pi-lsp-adapter`, `pi-lsp` และ `@narumitw/pi-lsp` กับ fixture TypeScript เดียวกัน ผลวิเคราะห์และข้อสรุปอยู่ใน [ทิศทางพัฒนา Pi โดยเรียนรู้จาก OMP](../../docs/notes/pi-omp-context-code-intelligence-tui.md)

## วิธีรัน

ติดตั้ง dependencies ภายในโฟลเดอร์นี้ แล้วเลือกหนึ่ง mode:

```sh
npm ci
node run-benchmark.mjs ast
node run-benchmark.mjs lsp-pi
node run-benchmark.mjs adapter
node run-benchmark.mjs pi-lsp
node run-benchmark.mjs narumi
```

ผลลัพธ์จะเขียนทับไฟล์ชื่อเดียวกับ mode ใต้ `results/` ส่วน `node_modules`, process caches และ checkout ของ upstream projects ให้ปล่อยไว้ในตำแหน่งชั่วคราวที่ harness หรือ OS กำหนด

## Decisions

- 2026-08-22 — เก็บเฉพาะ harness, fixture, dependency lockfile และผล JSON หลักเป็น durable artifacts; ไม่เก็บ `node_modules`, upstream checkout, compiler cache หรือ stdout/stderr ซ้ำซ้อน

## Change log

- 2026-08-22 16:34 — แก้ reference ของผลวิเคราะห์หลังย้าย project documentation จาก `.workbench/` ไป `docs/`
- 2026-08-22 11:55 — ย้าย durable benchmark artifacts ออกจากพื้นที่ชั่วคราวเดิมก่อนยกเลิกนโยบาย workspace-local runtime
