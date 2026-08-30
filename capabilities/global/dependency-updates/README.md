# Dependency Updates

> **Status:** stable · **Scope:** global

ตรวจ dependency ของ stable My Pi aggregate แบบ background และตามคำสั่ง โดยไม่ขวาง startup

- Extension: `extensions/index.ts`
- Command: `/mypi-updates`
- Dependency: `@nawatt-works/mypi-runtime-mode`
- Network check ปิดเมื่อ `PI_OFFLINE` และใช้ cache ใต้ OS temporary directory
