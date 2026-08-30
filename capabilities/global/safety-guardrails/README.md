# Safety Guardrails

> **Status:** stable · **Scope:** global

ตรวจ sensitive reads, local uploads และ filesystem mutationsภายนอก workspace ก่อน tool execution Manual modeถามผู้ใช้เมื่อมี UI และ fail closedใน non-interactive mode

- Detection: `extensions/detector.ts` — pure `MutationFinding[]`
- Resolution/session state: `extensions/resolution.ts`
- Manual UI rendering: `extensions/ui.ts`
- Stable entrypoint: `extensions/index.ts` ใช้ manual resolverเดิมโดย default
- Delegated compositionต้อง inject trusted resolverแบบ explicit; Worker inputเลือก resolverเองไม่ได้
- Dependency: Herdr blocked-state bridge
- เป็น defense-in-depth ไม่ใช่ OS sandbox
