# Delegated Orchestration

> **Status:** candidate · **Scope:** incubator · **Production:** disabled

รวม manual Herdr orchestrationเดิมกับ delegated-autonomy mandate/policy/REVIEW registries, harness profiles, scoped tools, patched agent-teams profile, probesและ `herdr-orchestration` Skillไว้เป็น capabilityเดียวตาม whole-capability promotion policy

Root stable manifestห้ามโหลด packageนี้จน Worker profile, credential isolation, production wiringและ acceptance gatesผ่านครบ

- Pi entry candidate: `extensions/orchestration.ts`
- Skill: `skills/herdr-orchestration/SKILL.md`
- Agent-teams artifacts: `profiles/pi-agent-teams/node-worker-v1/`
- Generated Worker profile core: `extensions/worker-profile-runtime.ts`
- Unit/runtime/acceptance: `tests/`

## Generated Worker profile checkpoint

My Piเป็นผู้ materialize profileแยกต่อ Workerจาก immutable template; ผู้ใช้ไม่สร้างหรือแก้ profileเอง Core checkpointปัจจุบันสร้าง private synthetic `HOME`, explicit `PI_CODING_AGENT_DIR`/session/temp roots, minimal settings, explicit untrusted-project stateและ `auth.json`ที่มี credentialของ providerเดียว พร้อม exact no-discovery launch args

Verifier bindกับ Coordinator-held profile digestก่อน follow pathใด ๆ, ตรวจ canonical/private paths, exact resources/settings/trust/credential projection, strip ambient secret environmentและปฏิเสธ Default/worktree overlap, symlink, unexpected artifactsหรือ missing state Cleanupต้อง match manifest identity

Real child-Pi sentinelยืนยันว่า generated profileเห็นเฉพาะ explicit extension/providerและไม่โหลด Default/project canaries

`extensions/agent-teams-worker-profile.ts` สร้าง exact child args/environmentจาก core, บังคับ trusted extensionsอยู่นอก worktreeและรับ credentialผ่าน signed single-use per-run/per-Worker lease Leaseถูก claimก่อน materializationและถูกทำลายก่อน Workerพร้อม

`extensions/worker-machine-setup.ts` เป็น idempotent setup/verify/rotate/recover service สร้าง private runtime hierarchy, Ed25519 lease authorityและ provider credential sourceนอก worktreeจาก credentialของ profileที่เรียกอย่าง explicit โดยไม่เก็บ secretใน manifest/digest/argv/environment/audit `/mypi-worker-setup`อยู่เฉพาะ incubator entrypoint, ใช้ TUI confirmationและรับเฉพาะ action `setup|verify|rotate|recover` ไม่รับ pathหรือ secretเป็น argument

Patched candidate bind generated profileเข้ากับ spawn/readinessแล้ว แต่ real-provider acceptanceของ pathใหม่ยังถูก blockด้วย exit `78` และ production activationยัง disabled
