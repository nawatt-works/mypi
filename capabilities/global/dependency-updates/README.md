# Dependency Updates

> **Status:** stable · **Scope:** global

ตรวจ dependency ของ stable My Pi aggregate แบบ background และตามคำสั่ง โดยไม่ขวาง startup

- Extension: `extensions/index.ts`
- Command: `/mypi-updates`
- Skill: `dependency-update-assessment` สำหรับตรวจ changelog/tarball, Pi resources, config/security/authority, peer compatibilityและ disposable install/testก่อนเสนอแก้ exact pin
- Skillประเมินเท่านั้น ไม่แก้ manifest/lock, รัน lifecycle scripts, commit/tag/pushหรือ switch Default Piโดยไม่มี approvalแยก
- Dependency: `@nawatt-works/mypi-runtime-mode`
- Network check ปิดเมื่อ `PI_OFFLINE` และใช้ cache ใต้ OS temporary directory
