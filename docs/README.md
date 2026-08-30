# เอกสาร My Pi

> **Status:** active<br>
> **Created:** 2026-07-27 08:55<br>
> **Updated:** 2026-08-31 03:00<br>
> **Purpose:** แสดงภาพรวมของ design notes และ implementation history ที่ repository `my-pi` เป็นเจ้าของ

`docs/` เป็น project documentation ของ repository นี้ ไม่ใช่ workspace-wide artifact store และไม่ใช่ default path สำหรับ plan, note หรือ output จาก AI tool/skill/harness อื่น

## Plans

| Updated | Created | Status | Document | Purpose |
|---|---|---|---|---|
| 2026-08-30 12:00 | 2026-08-30 09:10 | completed | [จัด My Pi เป็น Capability Packages และ Pinned Releases](plans/capability-packages-and-pinned-releases.md) | `v0.2.0` pinned releaseผ่านและ Worker-profile decisions handoffไป delegated planแล้ว |
| 2026-08-31 01:50 | 2026-08-28 15:32 | complete — local disabled candidate | [ปรับ Pi/Herdr Coordinator เป็น Delegated Autonomy](plans/delegated-autonomy-coordinator.md) | latest guardrail-hardened path 19/19 + reviews PASS; no push/release/activation/Default switch |
| 2026-08-31 03:00 | 2026-08-31 02:00 | review PASS | [Safety Guardrails Four-layer Hardening Review](notes/safety-guardrails-four-layer-hardening-review.md) | workspace/canonical evidence/tool policy/runtime grants audit; 227/227 + 10/10 + 19/19 |
| 2026-08-31 01:35 | 2026-08-31 01:05 | review PASS | [Delegated Production Opt-in Independent Review](notes/delegated-production-optin-independent-review.md) | explicit environment, absent/0 no-op, root stable-only, production false |
| 2026-08-28 15:32 | 2026-08-25 09:19 | superseded | [Pi Coordinator บน Herdr](plans/pi-herdr-coordinator.md) | เก็บ implementation/probe history; authority contract และ Phase 3 เดิมถูกแทนด้วย delegated-autonomy plan |
| 2026-08-23 11:19 | 2026-08-22 12:40 | superseded | [แยก Workflow Plan, Continuity Ledger และ Plannotator Review](plans/flexible-planning-continuity.md) | implementation รุ่น managed fallback; ต่อมาถูกแทนด้วย pointer-only และ dual session/workspace tracking |
| 2026-08-30 10:30 | 2026-08-09 11:10 | complete | [ย้ายและขยาย Azure DevOps extension](plans/azure-devops-extension-crud.md) | เพิ่ม opt-in Work Item CRUD; capabilityปัจจุบันอยู่ `capabilities/project-opt-in/azure-devops/` และ root stable manifestไม่โหลด |
| 2026-08-23 11:19 | 2026-08-09 09:02 | superseded | [ให้ AI ตัดสินใจเปิด Plannotator](plans/ai-auto-plannotator.md) | implementation เดิมที่ผูกงานใหญ่กับ Plannotator; ดู current design ใน Persistent Todo + Handoff |
| 2026-08-22 16:15 | 2026-08-05 12:04 | reference | [ประวัติแผนของ My Pi](plans/README.md) | อธิบายขอบเขตของ project-owned plan history โดยไม่เป็น default path ให้กลไกอื่น |

## Notes

| Updated | Created | Status | Document | Purpose |
|---|---|---|---|---|
| 2026-08-31 01:30 | 2026-08-30 20:00 | acceptance PASS | [Agent-teams Generated-path Real-provider Acceptance](notes/agent-teams-generated-path-real-provider-acceptance.md) | four-layer guardrails + disabled opt-in/dual adapters/REVIEW/HUMAN/crash cleanupผ่าน 19/19 |
| 2026-08-31 00:55 | 2026-08-31 00:20 | review PASS | [Delegated Guardrail Resolver Independent Review](notes/delegated-guardrail-resolver-independent-review.md) | ปิด policy REVIEW fallback + workspace authority Medium; candidate 16/16 |
| 2026-08-30 23:40 | 2026-08-30 23:15 | review PASS | [Delegated Orchestration Phase 2–3 Final Review](notes/delegated-orchestration-phase2-3-final-review.md) | ปิด Docker runtime-contract Medium; final candidateไม่มี High/Medium |
| 2026-08-30 23:00 | 2026-08-30 22:40 | review PASS | [Worker Execution Adapters Independent Review](notes/worker-execution-adapters-independent-review.md) | ปิด wrong-cwd Mediumด้วย manifest/canonical cwd/readiness binding |
| 2026-08-30 19:10 | 2026-08-30 18:30 | complete harness review | [Agent-teams Generated-path Acceptance Harness Review](notes/agent-teams-generated-path-acceptance-harness-review.md) | real-provider/replacement/cleanup harnessผ่าน review; executionรอ trusted machine setup |
| 2026-08-30 18:10 | 2026-08-30 16:40 | complete review | [Worker Machine Setup Independent Review](notes/worker-machine-setup-independent-review.md) | source/revision/rotation/crash/stale-lock correctionsครบ; final re-review PASS |
| 2026-08-30 16:05 | 2026-08-30 15:20 | complete review | [Agent-teams Generated Profile Binding Independent Review](notes/agent-teams-generated-profile-binding-independent-review.md) | initial FAIL ambient env leak/cleanup race; exact-env generation-bound correction `ae489b2` re-review PASS |
| 2026-08-30 14:05 | 2026-08-30 13:30 | complete review | [Agent-teams Worker Profile Adapter Independent Review](notes/agent-teams-worker-profile-adapter-independent-review.md) | initial FAIL unsigned replay/late lease deletion; signed atomic-claim correction `0c64f4e` re-review PASS |
| 2026-08-30 13:05 | 2026-08-30 12:45 | complete review | [Generated Worker Profile Core Independent Review](notes/worker-profile-core-independent-review.md) | initial FAILเรื่อง ambient Default fallback; correction `aba088a`ปิด findingsและ re-review PASS |
| 2026-08-30 08:10 | 2026-08-28 17:05 | complete gate | [Phase 0 Probes — Delegated Autonomy Harness Profiles](notes/delegated-autonomy-phase0-probes.md) | agent-teams Pi-native chain artifacts `7/7`, approvals/dialogs/HUMAN side effects `0`; external lanes manual-only, piewf no-go |
| 2026-08-29 21:43 | 2026-08-29 21:43 | complete review | [Independent agent-teams Atomic Review](notes/agent-teams-atomic-independent-review.md) | verdict PASS-WITH-FOLLOWUPS ต่อ `ead8778`; provenanceและ missing-env findingsถูกแก้ใน `43967a8` และรอ re-review |
| 2026-08-28 19:13 | 2026-08-28 19:07 | complete evaluation | [Independent piewf Phase 0 Evaluation](notes/piewf-phase0-evaluation.md) | ตรวจ source/tests/license/install ของ piewf แยกใน Worker worktree และรับเข้า main หลัง Coordinator verification |
| 2026-08-29 21:23 | 2026-08-28 15:20 | ทิศทางที่ยืนยันให้ศึกษาต่อ | [Delegated Autonomy สำหรับ Coordinator และ Guardrails](notes/delegated-autonomy-guardrails-research.md) | Hermes requirementsถูก wireใน disabled agent-teams candidate boundaryแล้ว |
| 2026-08-28 15:32 | 2026-08-23 22:27 | partially superseded | [Runtime-negotiated Orchestration ผ่าน Pi และ Herdr](notes/runtime-negotiated-herdr-orchestration.md) | Runtime/identity/evidence history ยังใช้ต่อ แต่ authority contract เดิมถูกแทนด้วย bounded mandate |
| 2026-08-23 11:19 | 2026-07-27 02:31 | ดำเนินการบางส่วน | [Extension Review](notes/extensions-review.md) | ประเมิน third-party extensions และแนวทางปรับ Pi setup |
| 2026-08-22 11:57 | 2026-08-21 09:43 | อยู่ระหว่างวิเคราะห์ | [ทิศทางพัฒนา Pi โดยเรียนรู้จาก OMP](notes/pi-omp-context-code-intelligence-tui.md) | สรุป context governance, benchmark และ short-cycle candidates สำหรับ code intelligence, orchestration และ OMP-inspired TUI |
| 2026-08-23 11:19 | 2026-07-27 01:41 | นำมาใช้แล้ว | [Persistent Todo + Handoff](notes/persistent-todo-handoff.md) | แยก AI-only session state ออกจาก workspace plan และ Plannotator review |

## Change log

- 2026-08-31 03:00 — safety guardrailsสี่ชุดผ่าน closure review, full 227/227, runtime 10/10 และ real-provider 19/19
- 2026-08-31 01:50 — ปิดแผนด้วย local disabled candidate; external mutationsทั้งหมดถูก deferตาม human decision
- 2026-08-31 01:40 — disabled production opt-in review/acceptanceผ่าน; root/manual unchanged
- 2026-08-31 01:00 — delegated resolver + generation-bound REVIEWผ่าน review/acceptance; รอ human production decision
- 2026-08-30 23:45 — final Phase 2–3 review PASS หลัง exact Docker runtime contract correction
- 2026-08-30 23:10 — dual execution adaptersผ่าน independent reviewและ real-provider 13/13
- 2026-08-30 21:40 — leader-loss child self-reconciliationและ recovery-worktree retentionผ่าน real-provider 11/11
- 2026-08-30 21:00 — forced Worker crash + immediate same-name retryผ่าน 8/8 และ credential rotation integrationผ่าน
- 2026-08-30 20:10 — operator setupและ generated-path real-provider acceptanceผ่าน 7/7 checks; productionยัง disabled
- 2026-08-30 19:15 — generated-path real-provider acceptance harnessและ redacted failure receiptsผ่าน independent review
- 2026-08-30 18:15 — one-time `/mypi-worker-setup`, signed rotation journalและ receipt-gated recoveryผ่าน independent review
- 2026-08-30 16:10 — patched spawnใช้ generated profileจริง; correction `ae489b2`ปิด ambient env leak/cleanup raceและ independent re-review PASS
- 2026-08-30 14:10 — agent-teams adapter review FAIL unsigned replay/late deletion; correction `0c64f4e` signed lease + atomic claimและ re-review PASS, follow-up faults `0cd4e7b`
- 2026-08-30 13:05 — independent Worker-profile review FAIL ambient fallback; correction `aba088a` + regressionsผ่าน `160/160` และ correction re-review PASS
- 2026-08-30 12:30 — commit generated Worker-profile core `077d5c7` และ authority-bound cleanup correction `9baa988`; local only, รอ independent reviewก่อน agent-teams wiring
- 2026-08-30 12:20 — ผู้ใช้ยืนยันให้ My Piสร้าง Worker profileอัตโนมัติ; generated profile materializer/verifier/cleanupและ real child no-fallback sentinelผ่าน, full suite `158/158`; productionยัง disabled
- 2026-08-30 11:30 — push annotated `v0.2.0`, เปลี่ยน Default Piเป็น exact Git ref, verify clone/commands/toolsและ isolated rollbackผ่าน; พร้อมกลับไป Worker-profile discussion
- 2026-08-30 11:10 — commit capability migrationเป็น atomic checkpoint `ae81d9d`; branchยังไม่ pushและ remoteไม่มี `v0.2.0`, รอ human release decision
- 2026-08-30 11:00 — Phase 5 capability verificationผ่าน: `146/146`, clean `npm ci --omit=dev`, isolated aggregate/RPC/tool/Azure smoke, links, overlay applyและ diff check; เลือก release `0.2.0`
- 2026-08-30 10:30 — implement capability migration: global 9, Azure project-opt-in 1, delegated-orchestration incubator 1; npm workspaces, architecture tests, clean install/RPC smoke, profile rehashและ overlay apply-checkผ่าน
- 2026-08-30 10:00 — capability Phase 0 inventoryครบ: root production closure, proposed owners/lanes, external dependencies, testsและ path/digest breakpoints; baseline `142/142`, ยังไม่ย้ายไฟล์รอ grouping review
- 2026-08-30 09:20 — ยืนยันให้ capabilityทุก deployment/lifecycle laneอยู่ใต้ rootเดียว: `capabilities/global/`, `capabilities/project-opt-in/` และ `capabilities/incubator/`
- 2026-08-30 09:10 — เปิดแผน capability-package/pinned-release migration: stable-only global aggregate, `local/` → `project-opt-in/`, whole-capability incubator, isolated dev profile; พัก delegated Worker profileไว้หารือหลังงาน packaging
- 2026-08-30 08:40 — trusted REVIEW grant registryผ่าน correction review: authoritative combined policy digest, single append transition, consume-once/revoke/expiry/tamper fail closed, full suite `142/142`; productionยัง unwired
- 2026-08-30 08:30 — Phase 1 pure mandate/policy/audit registryผ่าน correction review: ปิด mutable alias + duplicate active replay, full suite `133/133`; production behaviorยัง unchangedและเริ่ม Phase 2
- 2026-08-30 08:10 — เพิ่ม opt-in real-model agent-teams acceptance probe; implement→review→correction→acceptance tasks `5/5`, artifacts `7/7`, approvals/dialogs/screen-polling `0`, HUMAN remote-mutation side effects `0`; Phase 0 gateปิดและเริ่ม pure Phase 1
- 2026-08-29 23:30 — independent reviewer reproduce correction v5ผ่าน self-contained apply-check/profile build/negative startup `6/6`, full suite `115/115`, diff-clean และให้ verdict `PASS`; productionยัง disabled
- 2026-08-29 23:20 — correction v5ส่ง temporary `--session-dir`ให้ runtime-probe childทุกตัว แยก test-harness EPERMจาก boundary outcomeและผ่าน apply-check/negative startup `6/6`
- 2026-08-29 23:10 — correction v4 regenerate overlayเป็น `--unified=0` + explicit `--unidiff-zero`; producer runtime probeผ่าน clean apply-check/negative startup `6/6` และ patchไม่มี whitespace-bearing context
- 2026-08-29 23:00 — re-review v2ให้ `FAIL` เพราะ evidence gap; เพิ่ม committed opt-in runtime probeที่ผ่าน clean apply-check + missing/wrong/replaced/forged/race startup cases `6/6` และล้าง whitespace drift
- 2026-08-29 22:40 — หลัง correction re-review `FAIL` เพิ่ม exact trusted boundary hash, derived leader/Worker contract และ nonce/session-bound structured readiness; forged/replayed markerกับ HUMAN remote mutation probesผ่าน
- 2026-08-29 22:10 — ปิด independent-review findingsของ agent-teamsด้วย pinned Git/entry/whole-source-tree provenance, required managed env และ exact boundary readiness marker; provider/image/daemon/missing-marker/missing-artifact fault chainผ่าน, productionยัง disabled
- 2026-08-29 21:23 — package/wire minimal agent-teams overlay + atomic profile + scoped direct tools + immutable Worker boundary; final single/direct/ceiling-2 runtimeและ verifierผ่าน, full suite `115/115`, productionยัง disabled
- 2026-08-29 20:45 — เพิ่ม pure dangerous-command analyzer/resolver, bounded shell normalization, structured DENY/HUMAN/REVIEW/ALLOW และ short-lived exact review grants; adversarial `15/15`, full suite `106/106`
- 2026-08-29 19:41 — วิเคราะห์ Hermes Agent approval/security source; adopt hardline/context/bind-mount/combined-guard requirementsแต่ reject regex copy, headless auto-approve, broad allowlist และ fail-open scanner
- 2026-08-29 18:17 — เพิ่ม versioned agent-teams Node `24.15.0` image profile + SPDX SBOM; canonical no-provenance digestผ่าน standaloneและ patched single/multi-worker probesบน non-root/network-none/read-only constraints
- 2026-08-29 17:58 — Codex/Claude gateจบเป็น manual-only: generated profilesปิด declared credentialsและผ่าน routine/test/env/external/network แต่ generic host reads fail D5; ย้าย critical pathไป agent-teams/Pi-native lane
- 2026-08-28 22:56 — กำหนด agent-teams contract: My Pi own authority/acceptance, team store own transport, scoped direct tools + immutable Docker Bash และ upstream-minimal-seams strategy
- 2026-08-28 22:54 — เพิ่ม agent-teams cleanup suppression: refresh/inbox loopsไม่ recreate team entryหลัง cleanup; final Docker-strong patch เหลือ packaging/source-of-truth decision
- 2026-08-28 22:48 — Docker-strong agent-teams profile mount เฉพาะ worktreeและ network none: host read/write/network fixturesผ่าน; explicit RPC exitแก้ graceful slot release และ replacement
- 2026-08-28 22:36 — ขยาย agent-teams probes: direct tools/fail-init/ceiling 2/multi-worker replacement ผ่านหลัง ready handshake และ policy fixes; พบ graceful shutdown fallback ช้าและ Bash read isolation ยังไม่ครบ
- 2026-08-28 22:13 — disposable `pi-agent-teams` child profile ใช้ env allowlist, exact resources, worktree ceiling และ no-UI policy/sandbox; routine ผ่านและ fake env/secret/external/network deny โดยไม่มี dialog
- 2026-08-28 22:02 — ประเมินและรัน `tmustier/pi-agent-teams` บน Pi 0.84.3: RPC/worktree flow ผ่าน แต่ fake secret/env, external write และ network ผ่านทั้งหมด จึง no-go as-is; ใช้ codexstar hardening เป็น comparator
- 2026-08-28 19:26 — รัน Codex→Claude chain ผ่าน Herdr: Codex boundary ผ่านแต่ model/lifecycle drift; Claude sandbox deny ผ่านแต่ in-worktree Write ยังเปิด human dialog จึงยังไม่ unattended
- 2026-08-28 19:13 — รับ independent piewf evaluation และ reproduce combined exact-spec drift; source tests 19/19 ผ่านแต่ install/license/runtime blockers ยังคง no-go
- 2026-08-28 19:10 — เพิ่ม piewf gate evidence: 5.8.0 CLI packaging broken, 5.9.0 doctor ไม่เข้ากับ bundled reviewer tools; core subagent/worktree/budget/resume ผ่านแต่ immediate adoption เป็น no-go
- 2026-08-28 17:05 — เริ่ม Phase 0 และบันทึก runtime probes: Codex ต้องใช้ custom permission profile, Claude ต้องใช้ fail-closed sandbox settings, Pi ต้องมี sandboxed Bash และ OpenCode ยัง no-go สำหรับ delegated profile
- 2026-08-28 15:32 — เปิดแผน delegated-autonomy Coordinator, แยก mandate/policy/harness profiles/control loop และ supersede authority/approval contract ของแผน Herdr เดิม
- 2026-08-28 15:20 — บันทึกผลเปรียบเทียบ guardrails และ agent orchestration ของ OpenCode, Claude Code และ Codex CLI พร้อมยืนยันทิศทางรื้อ Coordinator เป็น delegated autonomy ภายใต้ bounded mandate
- 2026-08-25 09:19 — อนุมัติให้พัฒนา Pi Coordinator บน Herdr และเปิดแผนที่เริ่มจาก probe phase พร้อม worker mode แทนการแยก repository
- 2026-08-24 19:36 — เพิ่มหลัก bounded delegation, explicit ownership, correction เดิม, execution/assurance separation และ runtime identity ในแบบ Pi/Herdr orchestration
- 2026-08-23 22:27 — บันทึกข้อกำหนด runtime-negotiated orchestration ผ่าน Pi/Herdr และพัก implementation ไว้รอตัดสินใจ
- 2026-08-23 11:19 — แยก AI-only plan ไปเก็บใน Pi session และให้ explicit `filePath` เป็นเส้นแบ่ง workspace artifact
- 2026-08-22 16:34 — ตรวจ historical `.workbench` references, เพิ่ม warning ใน superseded plans และแก้ benchmark link ที่ยังชี้ path เดิม
- 2026-08-22 16:15 — ย้าย project documentation จาก hidden `.workbench/` มา `docs/` และยกเลิก catch-all workspace policy
- 2026-08-22 12:51 — ปิดแผน flexible planning หลัง implementation และ verification ผ่านครบ
- 2026-08-22 12:40 — เพิ่มแผนรื้อ planning integration ให้แยก workflow artifact, continuity ledger และ Plannotator review
- 2026-08-22 12:40 — ทำเครื่องหมาย auto-Plannotator เดิมเป็น superseded และอัปเดต Persistent Todo + Handoff ตาม workflow ใหม่
- 2026-08-22 11:57 — ยกเลิก workspace-local runtime, ย้าย durable code-intelligence benchmark artifacts และให้ temporary files ใช้ default ของ harness หรือ OS
- 2026-08-21 15:46 — เพิ่ม validation backlog และ short-cycle candidates ในบันทึก Pi/OMP
- 2026-08-21 15:15 — อัปเดตบันทึก Pi/OMP ด้วยผล benchmark code intelligence และ draft upstream issue ของ `pi-lsp-adapter`
- 2026-08-21 09:43 — เพิ่มบันทึกทิศทางพัฒนา Pi จากการประเมิน OMP ครอบคลุม context, compaction, memory, code intelligence, orchestration และ TUI
- 2026-08-09 19:25 — อัปเดต Azure DevOps เป็น project-local deployment จาก source กลางใน repository นี้
- 2026-08-09 12:50 — ปิดแผน Azure DevOps หลัง automated, user acceptance และ post-removal verification ผ่านครบ
- 2026-08-09 12:47 — Azure DevOps acceptance ผ่าน, write ถูก block ตาม read-only และรอ post-removal retest
- 2026-08-09 11:53 — Azure DevOps implementation ผ่าน automated verification และ blocked รอ user acceptance ก่อนลบ local source
- 2026-08-09 11:27 — พักแผน Azure DevOps ไว้รอคำสั่งเริ่ม พร้อมกำหนดให้ผู้ใช้ทำ acceptance test และห้าม AI เรียก Azure CLI
- 2026-08-09 11:10 — เพิ่มแผนย้ายและขยาย Azure DevOps extension พร้อม permission CRUD ราย project
- 2026-08-09 09:10 — ปิดแผน AI-selected Plannotator หลัง implementation และ verification ผ่าน
- 2026-08-09 09:02 — เพิ่มแผนให้ AI ตัดสินใจเปิด Plannotator และอัปเดตสถานะ Persistent Todo + Handoff
- 2026-08-05 12:04 — เพิ่มแนวทางแผนงานใหญ่และอัปเดตสถานะ Plannotator, Todo และ Handoff
- 2026-07-27 09:19 — อัปเดตสถานะ Extension Review หลังเพิ่ม Guardrails
- 2026-07-27 08:55 — สร้าง index และรวบรวมเอกสารที่มีอยู่ใน `.workbench`
