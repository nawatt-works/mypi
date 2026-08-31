# Dependency Update Assessment Skill

> **Status:** stable capability implementation · unreleased after `v0.3.0`<br>
> **Scope:** `capabilities/global/dependency-updates`<br>
> **Mutation authority:** assessment-only

## Purpose

`/mypi-updates` ตรวจพบ candidate versionsเท่านั้น ส่วน skill `dependency-update-assessment` ประเมินว่า exact candidateกระทบ packaging, Pi resources, tools/commands/skills, config/state, security authority, peer compatibility, generated Worker isolationและ direct/transitive lockfileอย่างไร ก่อนเสนอแก้ pin

Skillใช้ verdictต่อ package:

- `CURRENT`: direct registry JSONยืนยันว่า exact pinปัจจุบันตรง candidate
- `SAFE_TO_PROPOSE`: authoritative evidenceและ disposable gatesครบ จึงเสนอ patchได้แต่ยังไม่ apply
- `HOLD`: evidenceหรือ verificationไม่ครบ/กำกวม
- `REJECT`: candidateชน required contractหรือ authority policy
- `HUMAN`: evidence/ขั้นถัดไปต้องใช้ credential, external mutation, releaseหรือ Default switch

Assessmentห้ามแก้ repositoryจริง, รัน candidate lifecycle scripts, commit/tag/pushหรือเปลี่ยน Default/settings การ apply exact pinต้องมี approvalแยกและ rerun gatesหลังเปลี่ยน manifest/lock

## Evaluation corrections

Evalรอบแรกพบสอง calibration defects:

1. modelใช้ `SAFE_TO_PROPOSE` กับ no-op versionทั้งที่ registry/disposable evidenceไม่ครบ
2. promptที่ไม่ระบุ packageทำให้ modelเลือก workspace dependencyเอง

แก้โดยเพิ่ม `CURRENT`, บังคับ direct `npm view ... --json` หรือ equivalent `registry.npmjs.org` document, กำหนด hard prerequisitesทั้งหมดสำหรับ `SAFE_TO_PROPOSE`, ห้ามใช้ web page/search/publisher profileแทน registry JSON และห้าม invent package scope

Iterationถัดมายืนยันว่าเมื่อ direct registry JSONไม่พร้อม ทั้งสาม managed adaptersถูกจัด `HOLD`แทนการ overclaim และ prompt release-boundaryไม่เลือก packageเอง

## Wiring and verification

- capability/root `pi.skills` register `skill:dependency-update-assessment`
- clean-install smoke require skill discovery
- `/mypi-updates` runtime messageระบุ detection-onlyและ routeไป skill
- focused skill/reference/eval/runtime/boundary tests: PASS
- independent final review: **PASS**, no High/Medium

Tag `v0.3.0` ไม่ได้รวม skillนี้ งานนี้เป็น unreleased commitถัดจาก tag ห้าม move tagเดิม
