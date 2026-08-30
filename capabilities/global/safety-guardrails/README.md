# Safety Guardrails

> **Status:** stable · **Scope:** global

ตรวจ sensitive reads, local uploads และ filesystem mutationsภายนอก workspace ก่อน tool execution Manual modeถามผู้ใช้เมื่อมี UI และ fail closedใน non-interactive mode

- Extension/export: `extensions/index.ts`
- Dependency: Herdr blocked-state bridge
- เป็น defense-in-depth ไม่ใช่ OS sandbox
