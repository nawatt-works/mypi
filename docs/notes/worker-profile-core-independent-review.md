# Independent Review — Generated Worker Profile Core

> **Status:** complete correction review — PASS<br>
> **Created:** 2026-08-30 12:45<br>
> **Updated:** 2026-08-30 13:05<br>
> **Scope:** commits `077d5c7`, `9baa988`, correction `aba088a`; generated Worker profile materializer/verifier/cleanupและ tests<br>
> **Reviewer:** Codex CLI `0.151.0`, `gpt-5.4`, ephemeral/read-only/ignore-user-config/ignore-rules

Reviewรันแบบ static independent sandboxซึ่งอ่านเฉพาะ repositoryและแก้ไฟล์ไม่ได้ Sandboxปิด OS-temp writes จึง rerun testsไม่ได้; producerรัน targeted tests `14/14` และ full suite `160/160` แยกนอก reviewer sandbox

## Initial verdict — FAIL

1. Verdict: FAIL

2. Findings

- High: Ambient Default Pi fallback is still present, which violates the stated no-fallback contract. In `materializeWorkerProfile`, `defaultAgentDir` is optional and silently falls back to `join(homedir(), ".pi", "agent")`. `verifyMaterializedWorkerProfile` repeats the same ambient fallback. Exploit scenario: if the coordinator omits `defaultAgentDir`, these routines start making trust/isolation decisions against the user’s ambient `~/.pi/agent` instead of an authority-supplied path. That reintroduces Default Pi state into the security boundary and can cause overlap checks and verification to bind to the wrong directory.

3. Missing tests or unverifiable claims

- Missing regression test for the no-fallback contract because every existing caller supplied `defaultAgentDir`.
- Missing exactness test for launch arguments; presence-only assertions did not prove exact/headless-only argv.
- The arbitrary-delete cleanup bug from `077d5c7` appeared addressed by `9baa988`, but there was no direct self-consistent forged-manifest test in an unrelated private hierarchy.
- Dynamic runtime claims were not independently verified because the reviewer sandbox denied `mkdtemp`.

## Correction

Commit `aba088a`:

- ทำ `defaultAgentDir` เป็น required authority inputทั้ง materializeและverify; ไม่มี `homedir()` fallback
- เพิ่ม missing-argument regressionทั้งสอง API
- เพิ่ม exact argv assertion
- เพิ่ม self-consistent forged profile/manifestนอก authorized runtime hierarchyและยืนยัน cleanupไม่ลบ
- targeted testsผ่าน `14/14`; full suiteผ่าน `160/160`

## Correction verdict — PASS

ไม่พบ High/Medium fail-open issue เพิ่มเติมใน scope ที่ตรวจ

### Closure status

- **Closed — no Default fallback:** materializationและverification require explicit canonical Default agent directory; omission failก่อนสร้าง/อ่าน profile
- **Closed — authority before path follow:** verifierเทียบ expected profile digestและ recomputeก่อนใช้ manifest paths จากนั้นตรวจ exact layout/ownership/permissionsก่อน parse files
- **Closed — exact argv/resources:** testsเทียบ argvทั้ง array; real child sentinelเห็นเฉพาะ generated extension/providerและไม่เห็น Default/project canaries
- **Closed — cleanup hierarchy:** cleanup derive exact `<runtimeRoot>/runs/<run>/workers/<worker>` จาก authority inputและ reject self-consistent forged hierarchy
- **Closed — one-provider/no-secret surfaces:** `auth.json`มี providerเดียว; secretไม่อยู่ manifest/digest/argv/environment
- **Closed — production unwired:** utilityอยู่ใน incubator exportเท่านั้นและไม่ถูก root stableหรือ agent-teams spawn pathโหลด

### Reviewer limitations

- static reviewเท่านั้น; reviewer sandboxเขียน OS tempไม่ได้
- ไม่อ่านไฟล์นอก repository, ไม่แตะ secretsและไม่แก้ source
- producer test result `160/160`ไม่ได้ reproduceโดย reviewer แต่ producer command outputถูกตรวจแยกใน Coordinator session
