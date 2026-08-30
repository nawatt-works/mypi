# Independent Review — Worker Machine Setup

> **Status:** correction review PASS<br>
> **Created:** 2026-08-30 16:40<br>
> **Updated:** 2026-08-30 18:10<br>
> **Scope:** `85beb57..348eab8`<br>
> **Reviewer:** Codex CLI `0.151.0`, `gpt-5.4`, read-only sandbox

## Producer

`85beb57`เพิ่ม idempotent setup/verify/rotate/recover serviceและ incubator-only `/mypi-worker-setup` สำหรับ private runtime hierarchy, Ed25519 authorityและ provider credential projectionโดยไม่รับ secretผ่าน argv/environment/audit

## Review sequence

Initial reviewพบ Medium:

1. lease issuanceไม่ re-verify projected credentialกับ explicit source profile/setup digest
2. rotationแข่งกับ issuanceได้และ leaseไม่ bind machine revision

`0b8423a`เพิ่ม shared authority lock, spawn-time machine verificationและ signed lease fields `machineSetupDigest` + `credentialRevision`

Correction reviewพบ Mediumเรื่อง rotation temp artifactsหลัง crashและ recovery pathไม่พร้อมใช้งาน

`bd8a924`เพิ่ม signed transaction journal, credential/manifest revision recoveryและ fsyncไฟล์

Correction-v3พบ Mediumเรื่อง stale lock/PID reuseและไม่มี operator recovery command

`1465c8d`เพิ่ม bounded stale-lock reclaimและ receipt-gated `/mypi-worker-setup recover`

Final reviewพบ Mediumว่าต้อง fsync parent `transactions/` หลังสร้าง/ลบ transaction directory

`348eab8`เพิ่ม parent-directory fsyncและ signed-journal reconstructionเมื่อ `machine.next.json`สูญหาย

## Final verdict — PASS

ไม่พบ High/Mediumคงเหลือ Reviewerยืนยัน:

- spawn re-verify source credential + setup digestภายใต้ authority lock
- rotateและissue serializeร่วมกัน
- signed lease bind setup digest/revision
- signed journalรองรับ credential-first, manifest-firstและ committed-before-return crash states
- stale/PID-reuse lockมี bounded recovery
- operator recoveryใช้ trusted session receipt ไม่เชื่อ runtime digestเอง
- pinned hashesตรง `profile.json`
- root packageไม่โหลด incubatorและ acceptanceยัง exit `78`

Lowที่ยังเปิด: initial one-time setup renameยังไม่ fsync parent treeครบ และ lock operationที่ยัง liveเกิน 5 นาทีอาจถูก bounded reclaim ทั้งสองกรณียังอยู่ใน incubator/production-disabled boundary
