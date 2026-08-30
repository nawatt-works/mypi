# Independent Review — Agent-teams Generated Profile Binding

> **Status:** correction review PASS<br>
> **Created:** 2026-08-30 15:20<br>
> **Updated:** 2026-08-30 16:05<br>
> **Scope:** producer `78e9db7`, correction `ae489b2`, test follow-up `5e6ff5d`<br>
> **Reviewer:** Codex CLI `0.151.0`, `gpt-5.4`, read-only sandbox

## Producer scope

- bind immutable adapter/runtime module hashesและ machine runtime authority refsเข้า `AgentTeamsProfile`
- issue Ed25519 signed leaseจาก private credential sourceแล้ว atomic provision generated profileก่อน `TeammateRpc.start`
- launchด้วย generated argv/environmentและ pin provider/model/thinking
- readiness bind boundary/runtime contract, generated profile digest, lease ID, nonce, team/Worker, source, toolsและ environment keys
- cleanup generated profileเมื่อ startup, stopหรือ process close
- regenerate zero-context overlay/source/profile hashes
- production importยังไม่มี และ real-provider acceptanceถูก blockจน machine setupพร้อม

## Initial verdict — FAIL

### Medium — ambient `LC_*` secret inheritance

`TeammateRpc.start`ยังเรียก environment builderกับ live `process.env` ทำให้ `LC_API_KEY`/`LC_SECRET_TOKEN`ผ่าน prefix allowlistเข้า childได้ Readinessคำนวณ expected key setจาก environmentที่ leakแล้วจึงยอมรับแทน fail closed

### Medium — cleanup generation race

Cleanup mapและ profile map keyด้วย Worker nameเท่านั้น หาก respawnชื่อเดิมก่อน cleanup generationเก่าเสร็จ generationเก่าอาจลบ map entryใหม่ จากนั้น cleanupของ generationใหม่กลายเป็น no-opและทิ้ง generated `auth.json`

### Lower severity

- private runtime path helpersยังมี same-UID check/use TOCTOU; private ownership/modeทำให้เป็น Low
- legacy real-provider acceptance probeยังใช้ pre-binding APIและไม่ทดสอบ pathใหม่

## Correction `ae489b2`

- `TeammateRpc.start`ส่ง exact `opts.env`เท่านั้นและ require `HOME`/`PATH`; ไม่ merge ambient process environment
- runtime probeตั้ง `LC_SECRET_TOKEN`ใน parentและพิสูจน์ว่า childไม่เห็น key/value
- cleanup keyedด้วย generated profile digest
- close callback capture exact materialized Worker generation
- map deletionเกิดเมื่อ current object identityตรง generationที่ cleanupเท่านั้น
- concurrent cleanup generationเดียวถูก serialize
- historical acceptance probeถูกแทนด้วย explicit exit `78` blockerจน one-time setupและ new-path acceptanceพร้อม จึงไม่อ้าง evidenceเก่าเป็น wiring acceptance

## Correction verdict — PASS

ไม่พบ High/Medium findingคงเหลือ Reviewerยืนยัน exact generated environment path, generation-bound cleanup, readiness bindingและ production-disabled state

Follow-up `5e6ff5d`ปรับ negative profile testsให้ใช้ current required runtime/provider/key contractครบ

## Verification

- upstream patched source `npm run check`: PASS
- clean zero-context overlay apply: PASS
- runtime/fault probe `10/10`: PASS
- targeted profile/adapter tests `14/14`: PASS
- full repository suiteหลัง producer `171/171`: PASS

## Remaining gate

ยังไม่มี one-time machine setup/credential provisioning commandและยังไม่มี real-provider acceptanceบน generated-profile production path ดังนั้น candidateต้อง disabledต่อไป
