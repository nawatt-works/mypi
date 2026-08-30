# Runtime Mode

> **Status:** stable · **Scope:** global

ระบุ Pi session ที่ Coordinator สร้างด้วยชื่อ `mypi-worker:*`, ปิด interactive tools ที่ไม่มีผู้ใช้เฝ้า และให้ helper `isWorkerMode()` แก่ capability อื่น

- Extension: `extensions/index.ts`
- Command: `/mypi-worker-status`
- Verification: package-local/aggregate Worker-mode tests
