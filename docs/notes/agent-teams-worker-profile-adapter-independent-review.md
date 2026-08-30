# Independent Review — Agent-teams Worker Profile Adapter

> **Status:** complete correction review — PASS<br>
> **Created:** 2026-08-30 13:30<br>
> **Updated:** 2026-08-30 14:05<br>
> **Scope:** adapter `0bd7069`, correction `0c64f4e`, follow-up tests `0cd4e7b`<br>
> **Reviewer:** Codex CLI `0.151.0`, `gpt-5.4`, ephemeral/read-only/ignore-user-config/ignore-rules

Reviewเป็น static independent sandboxและไม่แก้ source Producerรัน full suite `166/166` ก่อน initial review, `167/167` หลัง correction และ targeted adapter follow-ups `7/7`

## Initial verdict — FAIL

### High — lease replayข้าม Worker/run

Adapterเดิมยืนยันเฉพาะ pathname `<runtimeRoot>/credential-leases/<runId>/<workerId>.auth.json` แต่ lease contentไม่มี issuer signatureหรือ identity binding การ copy credential payloadเดียวไป pathของ Workerอื่นจึงสร้าง profileใหม่ได้

### High — lease deletion failureหลัง profileพร้อม

Adapterเดิม verify generated profileก่อนลบ lease หาก `rm()`ล้มเหลวจะพยายาม cleanupแต่ suppress cleanup error จึงอาจเหลือ profileที่มี `auth.json`และ launch contractแม้ APIคืน failure

### Missing tests

- cross-worker/run/same-worker replay
- lease-consumption + cleanup failure
- TOCTOUระหว่าง verificationและ consumption

## Correction `0c64f4e`

- lease envelope schema v1 bind `leaseId`, run, Worker, provider, readiness nonce digest, issued/expiryและ credential
- Ed25519 signatureตรวจด้วย public keyที่ pathแน่นอนใต้ private runtime rootและ authority-supplied SHA-256
- TTLสูงสุด 5 นาทีและ clock-skew ceiling
- durable consumed markerใช้ `flag: "wx"` ป้องกัน lease ID replayหลัง cleanup
- claimเกิดก่อน profile materialization: สร้าง markerแล้ว atomic rename leaseไป claimed root
- success returnเกิดหลัง claimed leaseถูกทำลายเท่านั้น
- failure pathไม่ suppress cleanup; profile/claim cleanup failureรวมใน `AggregateError`
- secretsอยู่เฉพาะ signed lease/temporary claim/generated `auth.json`; ไม่เข้า return, manifest, digest, argvหรือ environment

## Correction verdict — PASS

ไม่พบ High/Medium fail-open issueใหม่

Reviewerยืนยันว่า:

- copied leaseข้าม Worker/run failที่ signed identity/nonce
- same lease ID replay failที่ durable consumed marker
- signing-key substitution failจาก pinned public-key digest/signature
- claimเกิดก่อน profileและ failureไม่คืน usable profile
- productionยัง disabledและ adapterไม่ถูก spawn path import

## Follow-up tests `0cd4e7b`

เพิ่มตาม reviewer suggestions:

- explicit run mismatch
- future-datedและ TTL overflow
- wrong signing key
- failureหลัง atomic claimแต่ก่อน successต้องไม่มี original lease, claimed leaseหรือ Worker profile และ consumed markerยังอยู่

ข้อจำกัดที่ยังตั้งใจไว้: setup/brokerผู้ออก signed leasesยังไม่ implement และ patched agent-teams spawnยังไม่ bind adapter
