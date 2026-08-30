# Planning Continuity

> **Status:** stable · **Scope:** global

เก็บ session-internal plan snapshotหรือ pointerไป workspace planตาม artifact owner และแยก optional Plannotator reviewออกจาก continuity tracking

- Extension: `extensions/index.ts`
- Command: `/mypi-continuity`
- Tools: `mypi_start_work_plan`, `mypi_update_work_plan`, `mypi_finish_work_plan`, `mypi_use_plannotator`
- Dependency: Runtime Mode; Plannotator communicationผ่าน optional event bus
