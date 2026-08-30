# ปรับ Pi/Herdr Coordinator เป็น Delegated Autonomy

> **Status:** active — final Phase 2–3 evidence review; production remains disabled<br>
> **Created:** 2026-08-28 15:32<br>
> **Updated:** 2026-08-30 23:10<br>
> **Purpose:** รื้อ authority, permission และ control loop ของ Coordinator ให้ผู้ใช้มอบอำนาจแบบมีขอบเขตครั้งเดียว แล้ว Coordinator สร้าง ควบคุม ตรวจ และแก้ Workers จนจบโดยไม่ต้องให้ผู้ใช้เฝ้า pane

## Context

ผลการใช้จริงและงานวิจัยใน [Delegated Autonomy สำหรับ Coordinator และ Guardrails](../notes/delegated-autonomy-guardrails-research.md) ยืนยันว่า implementation ปัจจุบัน optimize สำหรับ human-supervised delegation:

- ผู้ใช้ต้องอนุมัติ Worker ทุกตัว
- Worker guardrails เปิด dialog แล้วรอผู้ใช้
- Coordinator surface `blocked` กลับให้ผู้ใช้แทนการตัดสินตาม policy
- preview เป็น mandatory gate
- authority guidance ระบุว่าผู้ใช้เลือกทีมและอนุมัติทุกผล

พฤติกรรมนี้ขัดกับเป้าหมายใหม่:

> ผู้ใช้ตกลง goal, scope, constraints และ escalation boundaries กับ Coordinator แล้ว Coordinator ต้องควบคุม execution ต่อเองจนเสร็จ ภายในอำนาจที่ได้รับ

แผนนี้แทนที่ authority และ approval decisions ใน [Pi Coordinator บน Herdr](pi-herdr-coordinator.md) แต่ยัง reuse runtime primitives ที่พิสูจน์แล้ว เช่น Herdr client, worker identity, worktrees, durable session registry, wait, handoff และ artifact verification

ผล disposable probes และคำสั่งที่ทำซ้ำได้บันทึกใน [Phase 0 Probes — Delegated Autonomy Harness Profiles](../notes/delegated-autonomy-phase0-probes.md)

> **Path migration note (2026-08-30):** capabilityนี้ย้ายทั้งชุดไป `capabilities/incubator/delegated-orchestration/` แล้ว References แบบ `extensions/...`, `profiles/...`, `skills/...` และ `tests/...` ด้านล่างบันทึก layout ณ เวลาที่ phaseนั้นเกิด; เมื่อ resume implementationให้ resolve current sourceจาก incubator packageและไม่โหลดผ่าน root stable manifest

## Goal and scope

### Goal

สร้าง Coordinator ที่:

1. รับและเก็บ bounded mandate สำหรับงานปัจจุบัน
2. ตัดสินใจเองว่าจะทำงานเองหรือสร้าง Workers กี่ตัวและลำดับใดภายใน mandate
3. spawn, wait, inspect, correct, stop และ verify Workers โดยไม่ถามผู้ใช้ทุกขั้น
4. ใช้ deterministic policy และ harness-native sandbox/reviewer modes เพื่อลด routine prompts
5. escalate เฉพาะเรื่องที่เกิน mandate หรือเป็น human-only decision
6. เก็บ audit trail และหลักฐานที่ตรวจย้อนหลังได้
7. คง manual mode และ off mode เป็น fallback

### Non-goals ของรอบนี้

- ไม่ออกแบบ Plannotator หรือ `ask user`; ผู้ใช้ให้พักสองหัวข้อนี้ไว้ก่อน
- ไม่สร้าง distributed workflow engine ใหม่ที่เลียนแบบ journal/replay ของ `pi-extensible-workflows`
- ไม่อ้างว่า Herdr เป็น security sandbox
- ไม่รองรับทุก harness ที่ Herdr รู้จักตั้งแต่รุ่นแรก
- ไม่ auto-click permission dialog เดิมโดยไม่มี policy
- ไม่เปิด full-access/bypass mode ให้ Worker บน host ปกติ
- ไม่ให้ Coordinator เปลี่ยน architecture, ขยาย scope, deploy หรือทำ irreversible external action โดยไม่มีอำนาจที่ชัดเจน

## Research conclusions ที่กำหนดแผน

### Harness/runtime ที่ตรวจ

| Component | Version/commit ที่ตรวจ | ข้อสรุปที่ใช้ |
|---|---|---|
| Herdr | `0.8.0` | รองรับ `pi`, `claude`, `codex`, `opencode` และ harness อื่น; เป็น process/pane control plane ไม่ใช่ sandbox |
| Pi | `0.84.3` | จำกัด tools/resources และโหลด explicit extensions ได้; มี sandbox และ Gondolin examples แต่ไม่มี permission-mode กลางใน core |
| OpenCode | `1.18.21` | `--auto` auto-approve สิ่งที่ไม่ explicit deny; agent-specific permission และ task permission |
| Claude Code | `2.1.251` (latest re-probe) | `dontAsk` + exact allowlist ให้ deterministic deny; sandbox/settings และ env isolationยังต้อง explicit |
| Codex CLI | `0.150.1` | แยก sandbox กับ approval; `--approve-for-me` route escalation ไป automatic reviewer |
| `pi-extensible-workflows` | npm `5.8.0`, source `ecadda0` | มี workflows, durable subagents, roles, selectors, budgets, worktrees, replay/resume และ Herdr transport; แต่ release เปลี่ยนเร็วและ repository ยังไม่มี LICENSE file แม้ package metadata/README ระบุ MIT |
| `tmustier/pi-agent-teams` / `codexstar69` | upstream `2c1776d` / fork `58f0a39` | Pi RPC team runtime, task/mailbox, auto-claim, completion wake, worktrees และ UI; MIT ชัดเจน แต่ child profile ปัจจุบัน inherit env, ตัด guardrails และไม่มี hard policy |

### Engine decision

ใช้แนวทาง **incremental + decision gate**:

1. **ระยะต้น:** ปรับ custom Herdr Coordinator ปัจจุบันให้มี mandate, policy และ delegated mode เพราะรองรับ heterogeneous harnesses อยู่แล้วและให้ผลต่อ UX ได้เร็ว
2. **ไม่ขยาย custom layer เป็น workflow engine เต็มรูปแบบ:** budget accounting, deterministic script, journal replay, background durable runs และ reusable workflows ต้องประเมิน `pi-extensible-workflows` ก่อนเขียนซ้ำ
3. **Phase หลัง:** เทียบ `pi-extensible-workflows` กับ patched `pi-agent-teams` ใน profile แยก: piewf เด่น deterministic workflow/budget/resume; agent-teams เด่น long-lived Pi RPC team/task/mailbox/UI
4. ถ้า backend ใดผ่าน security, compatibility และ acceptance ให้ใช้เฉพาะ Pi-native lane และคง custom Herdr adapter สำหรับ external harnesses; ห้ามมีสอง runtime คุม Worker เดียวกัน
5. **ห้ามคัดลอก source จาก `pi-extensible-workflows`** จนกว่า license grant จะชัดเจน ใช้ได้เพียง public API/design evidence ในช่วง evaluation; `pi-agent-teams` ทั้งสอง repo มี MIT LICENSE จึง probe/fork ได้แต่ยังต้องบันทึก provenance

## Decisions

### D1 — Authority เปลี่ยนจาก approval ทุกขั้นเป็น bounded mandate

ผู้ใช้มีอำนาจกำหนด outcome และ boundary ส่วน Coordinator มีอำนาจควบคุม execution ภายใน boundary นั้น

Coordinator ตัดสินใจได้เองภายใน mandate:

- ทำเองหรือ delegate
- จำนวนและชนิด Worker ภายใต้ ceiling
- task decomposition และ ordering
- correction, retry, stop และ replacement
- reviewer/assurance ที่เหมาะกับความเสี่ยง
- routine permission escalation ที่ policy มอบให้
- การรับหรือปฏิเสธผลงานตาม artifact และ verification

### D2 — Operating modes

เปลี่ยน mode เป็น:

| Mode | Behavior |
|---|---|
| `delegated` | Coordinator spawn/ควบคุม Workers เองภายใน mandate; เป็นเป้าหมาย default ของ Herdr session ใหม่ |
| `manual` | คง preview + user confirmation แบบ implementation ปัจจุบัน |
| `off` | ไม่ inject orchestration guidance และไม่เสนอ Workers |

Compatibility:

- ค่าเดิม `automatic` แปลเป็น `manual` ตอน restore เพราะ semantic เดิมคือเสนอทีมอัตโนมัติแต่ spawn ต้องถาม
- `/mypi-orchestrate automatic` เป็น alias ชั่วคราวของ `manual` พร้อม deprecation notice

### D3 — Policy resolution มีสี่ outcomes

```text
ALLOW   — action อยู่ใน boundary และทำได้ทันที
REVIEW  — Coordinator/automatic reviewer ตัดสินได้
DENY    — hard policy ห้าม; ไม่มี reviewer ใด override
HUMAN   — เกิน mandate หรือสงวนไว้ให้ผู้ใช้
```

Worker ไม่ควรเปิด generic user dialog ใน delegated mode

### D4 — Policy precedence

เรียงจากอำนาจสูงไปต่ำ:

```text
hard deny / managed ceiling
  > global user policy
  > trusted project policy
  > run mandate
  > worker profile
  > task-local narrowing
```

ชั้นล่างเพิ่มสิทธิ์เกินชั้นบนไม่ได้ แนวนี้สอดคล้องกับ setup hook/resource ceiling ของ `pi-extensible-workflows` และ explicit deny ของ OpenCode/Claude/Codex

### D5 — Default delegated boundary ต้อง conservative

ค่าเริ่มต้นเมื่อไม่มี override:

- writing Worker ต้องใช้ per-worker worktree
- read/write จำกัดอยู่ใน worktree และ OS temp ของ harness
- secret files และ sensitive environment variables: `DENY`
- local-file upload: `DENY`
- shell network: deny เว้นแต่ profile ระบุ allowlist
- provider/model API traffic และ dedicated web-search tool แยกจาก shell network
- external filesystem mutation: `DENY` โดย default
- `git push`, deploy, publish, remote deletion และ cloud mutation: `HUMAN`
- architecture change, scope expansion และ security tradeoff: `HUMAN`
- test, lint, build, local commit ใน branch ของ Worker: `ALLOW` เมื่อ profile รองรับ
- concurrent Workers: ceiling เริ่มต้น 3; ไม่ใช่เป้าหมายให้ spawn เต็ม
- unsupported/unverified harness profile: ใช้ได้เฉพาะ `manual`

### D6 — Preview เป็น audit/observability

ใน `delegated` mode:

- preview ถูกสร้างเป็น structured audit event โดยอัตโนมัติ
- ไม่เปิด confirmation dialog ถ้า spawn request ผ่าน mandate
- ผู้ใช้ดูย้อนหลังผ่าน status/TUI ได้

ใน `manual` mode preview และ confirmation ทำงานเหมือนเดิม

### D7 — Worker ที่ blocked ต้องไม่โยน routine decision ให้ผู้ใช้

ใน delegated mode:

- Pi Worker policy resolve เป็น allow/deny โดยไม่เปิด dialog
- external harness ใช้ native auto/reviewer mode เพื่อลด routine prompts
- unexpected interactive prompt ถือเป็น profile defect หรือ true human escalation
- Coordinator ห้ามส่ง keys ไปกดผ่าน dialog แบบ generic
- ถ้า prompt ไม่ใช่ human-only boundary ให้ stop/retry ด้วย profile ที่ถูกต้องหรือ deny action แล้วส่ง correction

### D8 — Verification discipline เดิมยังคงอยู่

- lifecycle state และ self-report ไม่ใช่หลักฐานเพียงพอ
- artifact ที่ตกลงไว้ต้องผ่านครบ
- Coordinator ต้องอ่าน diff/report/log จริง
- correction กลับ Worker เดิมก่อนเมื่อยังอยู่ใน ownership เดิม
- assurance แยกจากจำนวน Worker

### D9 — Plannotator และ `ask user` ยังไม่แตะ

รอบ implementation ของแผนนี้ห้ามเปลี่ยน behavior ของสองระบบนี้ เว้นแต่จำเป็นต่อ compile/test และต้องบันทึกเป็น blocker ก่อน

### D10 — `pi-agent-teams` เป็น Pi-native backend candidate แยกจาก Herdr

ใช้ `tmustier/pi-agent-teams` เป็น base candidate เพราะ active กว่า, ใช้ `@earendil-works/*`, มี completion wake/urgent steer/clean branching/cleanup และ community มากกว่า ส่วน `codexstar69` เป็น divergent MIT hardening source สำหรับ worker ceiling, leases, heartbeat, event log, doctor และ process/worktree cleanup

ห้าม install production แบบ as-is เพราะ child spawn inherit `process.env`, ใช้ `--no-extensions -e teams` ซึ่งตัด My Pi guardrails/sandbox, default writing workspace เป็น shared และไม่มี deterministic secret/network/upload policy Phase 0 runtime บน explicit worktree ยืนยันว่า fake `.env`, fake parent env, external `/tmp` write และ shell network ผ่านทั้งหมด แม้ routine RPC/worktree lifecycle ทำงานดี

Disposable child-profile patch ยืนยัน env allowlist, exact tools/extensions, worktree ceiling, deterministic no-UI policy และ fail-closed boundary ต่อมาถูก packageเป็น minimal overlayบน exact upstream commit, atomic profile builder/verifier, scoped direct operations และ single Worker boundaryที่รวม immutable Docker Bash + command/data policy Final overlay apply-check, single/direct/ceiling-2 replacement runtime และ observed verifierผ่าน Independent reviewของ `ead8778` พบ provenanceกับ missing-env fail-open gaps; correction `43967a8` เพิ่ม Git/entry/whole-source-tree verificationและ required managed env แต่ re-reviewให้ `FAIL` เพราะ boundary/digest/markerยัง forge/replayได้ Correction v2จึง bind exact boundary content hash, derive contractทั้ง leader/Worker และใช้ structured readinessที่ bind per-spawn nonce/session/source/tools/env/resources พร้อม provider/image/daemon/missing-marker/missing-artifact/human-only fault probes Re-review v2ยืนยัน security wiringแต่ให้ `FAIL` เพราะ evidenceยังไม่เป็น committed executableและไม่ได้ independently reproduce apply-check Correction v3เพิ่ม opt-in runtime probeที่ execute clean apply-check + negative startup `6/6`; re-reviewยัง `FAIL` เพราะรันจาก reviewer checkoutเก่าและพบ whitespace-bearing contextใน patch Correction v4 regenerate overlayเป็น `--unified=0`, require `git apply --unidiff-zero`, probeรันจาก producer checkoutผ่านและ patchไม่มี whitespace context Re-reviewใน sandboxพบ probe childเขียน global Pi sessions จึงได้ EPERMที่ไม่ใช่ boundary outcome Correction v5ส่ง temporary `--session-dir`ให้ childทุกตัวเพื่อ isolated reproduction Independent reviewerรันจาก self-contained fixturesแล้วได้ apply-check/profile build/negative `6/6`, full suite `115/115`, diff-clean และ verdict `PASS` Real Pi-native chainต่อมาผ่าน implement/review/correction/acceptance tasks `5/5`, artifacts `7/7`, approvals/dialogs `0` และ HUMAN side effects `0` Candidateยัง disabled by defaultและรอ Phase 1–3 authority/adapter wiring

ถ้านำมาใช้ My Pi ยังเป็นเจ้าของ mandate/policy/audit/final verification; agent-teams เป็นเจ้าของ Pi task transport/RPC team lifecycle เท่านั้น และ Herdr ยังดูแล external harnesses

### D11 — Codex/Claude external harnesses เป็น manual-only ใน initial release

Isolated Codex/Claude profilesผ่าน routine/test/environment/declared-credential/external-write/network fixtures และ Codex warm Herdr session track lifecycleได้ แต่ทั้งสองอ่าน unique generic host fileได้ก่อนเพิ่ม exact deny จึงไม่ผ่าน D5 worktree-only read

`@anthropic-ai/sandbox-runtime` เป็น deny-only read policy ไม่ใช่ mount-only view ส่วน Docker/VM ต้อง provision provider auth/toolchainใหม่และเป็น security tradeoffที่ mandateนี้ไม่ได้อนุญาต ดังนั้นห้ามเปิด delegated spawnให้ Codex/Claudeเพียงเพราะ zero-dialog UXผ่าน เก็บ pure builders/verifiersไว้สำหรับ future separately-isolated execution identity และคง Herdr external lanesใน manual mode

### D12 — Dangerous-command policy เป็น defense-in-depthที่ต้อง bind execution context

Hermes Agent `tools/approval.py` ให้ patternที่ใช้ได้: unconditional hardline floor, user denyก่อน bypass, combined findings, context-local approval identity, quote/Unicode/shell normalization, parser budget fail-closed และ Docker `has_host_access` semantics

My Piจะใช้เป็น requirements/adversarial tests ไม่ copy moduleหรือ regexทั้งก้อน Guardrailไม่ใช่ sandbox และ smart LLMไม่ใช่ authority Unknown/headless Workerต้อง fail closedต่างจาก historical Hermes auto-approve Permanent command-name/glob allowlistถูก reject; delegated REVIEWต้อง bind exact command digest + Worker/session + mandate/profile/policy version + canonical resource scope + expiry

Pi Worker Docker mount worktreeจาก hostจึงยังต้องผ่าน command policy ห้ามถือว่า containerเพียงอย่างเดียวทำให้ `rm -rf /workspace`, history destruction หรือ policy-file tamperingปลอดภัย Initial hardline/mandate denyต้องไม่มี bypass ส่วน generated-path cleanupอนุญาตได้ด้วย narrow task-scoped capability

### D13 — ผู้ใช้ไม่สร้าง Worker profileเอง; My Pi materialize จาก verified template

ผู้ใช้ยืนยัน topology และ operator experienceดังนี้:

- Default Piใช้ pinned stable release; Development Piใช้ isolated development profile
- releaseเป็นเจ้าของ immutable, versioned Worker profile templates
- machine setupทำ preflight/image/provider provisioningครั้งเดียวโดย explicit operator action
- ทุก Workerได้ synthetic `HOME`, explicit `PI_CODING_AGENT_DIR`, isolated session directory, minimal settings/trustและ credential projectionของ providerเดียว
- mutable profile materializeแยกต่อ Worker; ห้าม share session/auth refresh stateหรือ fallbackไป `$HOME/.pi/agent`
- ผู้ใช้เลือกเพียง enablement, provider/model, limitsและ retention ไม่เขียน `profile.json`, environment allowlistหรือ digestเอง
- missing/malformed/default-linked profileต้อง fail startup; manual modeเป็น rollback
- custom toolchainต้องเป็น versioned profile packageที่ผ่าน verification ไม่ใช่ machine-local ad hoc config

Credential valuesห้ามเข้า profile digest/audit, Worker tools, Bash containerหรือ child environment inventory Manifestบันทึกได้เฉพาะ provider id/typeและ non-secret provenance Strongest targetคือ short-lived token/broker; initial implementationอาจใช้ minimal provider-specific `auth.json` projection mode `0600`นอก worktreeโดยไม่ copy Default authทั้งไฟล์

Recommended materialization topology:

```text
immutable template
  → private run root
    → per-Worker synthetic HOME
    → per-Worker PI_CODING_AGENT_DIR + auth/settings/trust
    → per-Worker session/temp roots + worktree binding
```

## Target architecture

```text
┌─────────────────────────────────────────────────────────────┐
│ User                                                        │
│ goal + scope + constraints + human-only boundaries          │
└─────────────────────────────┬───────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ Coordinator                                                 │
│ mandate owner · decomposition · control loop · verification │
│                                                             │
│  ┌───────────────┐   ┌───────────────┐   ┌───────────────┐ │
│  │ Mandate store │ → │ Policy engine │ → │ Audit log     │ │
│  └───────────────┘   └───────┬───────┘   └───────────────┘ │
└───────────────────────────────┼─────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────┐
│ Execution backend                                           │
│                                                             │
│  Herdr backend (manual initial)   Pi-native backends (gate) │
│  ├─ Pi worker profile             ├─ agent-teams RPC/tasks  │
│  ├─ Codex auto-review profile     └─ piewf workflow/budgets │
│  ├─ Claude auto profile                                     │
│  └─ OpenCode auto+deny profile                              │
└─────────────────────────────┬───────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ Per-worker boundary                                         │
│ worktree · tools/resources · command · fs · network · secret│
└─────────────────────────────────────────────────────────────┘
```

## State model

### Orchestration mode

```ts
type OrchestrationMode = "delegated" | "manual" | "off";
```

เก็บใน Pi session custom entries เหมือนปัจจุบัน

### Mandate

ขั้นต่ำที่ mechanism ต้องเก็บ:

```ts
type Mandate = {
  version: 1;
  id: string;
  cwd: string;
  goal: string;                 // compact user-visible summary
  definitionOfDone: string[];
  allowedHarnesses: string[];
  maxConcurrentWorkers: number;
  maxAgentLaunches?: number;
  writePolicy: "worktree-only" | "read-only";
  shellNetwork: "deny" | { allowDomains: string[] };
  secrets: "deny";
  uploads: "deny";
  humanOnly: Array<
    | "architecture-change"
    | "scope-expansion"
    | "security-tradeoff"
    | "external-destructive"
    | "push-deploy-publish"
  >;
  createdAt: string;
};
```

Constraints:

- ไม่มี secret values
- goal/DoD ต้องสรุปจากคำสั่งที่ผู้ใช้เห็น ไม่เก็บ private reasoning
- mutation ของ mandate ต้อง append event และห้ามขยายเกิน global/project ceiling
- session resume ต้อง restore mandate ล่าสุด

### Worker profile

```ts
type WorkerProfile = {
  id: string;
  harness: string;
  verified: boolean;
  writing: boolean;
  launchArgs: string[];
  policy: {
    filesystem: "read-only" | "worktree-write";
    shellNetwork: "deny" | "allowlist";
    secrets: "deny";
    uploads: "deny";
    interactivePrompts: "deny" | "automatic-review" | "human-only";
  };
};
```

Profile เป็น adapter-specific และต้องมี runtime probe ก่อน `verified: true`

### Audit event

ต้องบันทึกอย่างน้อย:

- mandate activated/replaced/finished
- spawn proposed/allowed/denied/escalated
- actual harness args แบบ redacted
- observed identity และ profile verification
- Worker policy deny หรือ human escalation
- handoff/correction/stop/retry
- artifacts collected และ verification result
- final outcome

Audit entries อยู่ใน Pi session ไม่สร้าง catch-all workspace artifact

## Harness profiles ที่ต้อง probe

### Pi Worker

เป้าหมาย:

- ไม่มี guardrail dialog ใน delegated worker
- policy file/ID ส่งตอน spawn แบบ atomic ผ่าน extension-owned CLI flag
- Worker โหลด resource set ที่กำหนดแน่นอน
- read-only และ worktree-writing profiles แยกกัน

แนวทาง probe:

1. ขยาย `worker-mode.ts` ให้ own string flag เช่น `--mypi-worker-policy <path-or-id>`
2. emit resolved worker policy ผ่าน `pi.events` ใน `session_start`; extensions อื่น subscribe ตั้งแต่ factory load
3. สร้าง policy file ใต้ OS temp ด้วย mode `0600`, ไม่มี secret และ cleanup เมื่อ Worker จบ
4. ใช้ explicit extension/resource launch เมื่อจำเป็น:
   - `--no-extensions` แล้ว `--extension` เฉพาะ worker policy, guardrail และ Herdr lifecycle integration
   - จำกัด skills/tools/context ตาม profile
5. refactor `guardrails.ts` ให้ analyzer แยกจาก resolver/UI
6. delegated worker resolver:
   - safe in-scope → allow
   - hard deny → block tool พร้อม actionable reason ให้ Worker รายงาน Coordinator
   - human-only → block และ mark escalation; ไม่เปิด dialog ใน Worker pane
7. เปรียบเทียบ isolation options:
   - tool-operation overrides + sandboxed bash เป็น baseline
   - `@anthropic-ai/sandbox-runtime` สำหรับ bash/network enforcement
   - Gondolin micro-VM สำหรับ strong isolation profile ที่ต้อง route built-ins ทั้งหมด

ห้ามอ้างว่า tool-operation guard เป็น OS sandbox

### Codex Worker

Phase 0 ปฏิเสธ shorthand baseline ต่อไปนี้ เพราะยังอ่าน `.env` และ auto-review อนุมัติ external `/tmp` write ได้:

```text
codex --approve-for-me --sandbox workspace-write
```

Candidate ใหม่ใช้ custom permission profile แทน legacy sandbox settings:

```toml
approval_policy = "on-request"
approvals_reviewer = "auto_review"
default_permissions = "mypi_workspace"

[permissions.mypi_workspace]
extends = ":workspace"

[permissions.mypi_workspace.filesystem]
":tmpdir" = "write"
":slash_tmp" = "deny"

[permissions.mypi_workspace.filesystem.":workspace_roots"]
"." = "write"
"**/.env" = "deny"
"**/.env.*" = "deny"

[permissions.mypi_workspace.network]
enabled = false
```

Phase 0 ยืนยันว่า profile นี้ทำ routine workspace write ได้และ deny fake secret, `/tmp` external write และ shell network ได้โดยไม่มี human prompt แต่ protected `.git` ทำให้ local commit ไม่ผ่าน; ค่าเริ่มต้นจึงให้ Coordinator commit หลัง collect

Isolated `CODEX_HOME` re-probe ยืนยัน requested/effective `gpt-5.6-luna`/medium จาก persisted `turn_context`, environment allowlist และ routine/test/declared-credential/external/network fixturesผ่าน Warm Herdr sessionที่ `interactive_ready` แล้วเห็น `working` ระหว่าง delayed turn และ settleหลังจบจริง แต่ unique generic host readผ่านก่อนเพิ่ม exact credential deny จึงยัง fail D5 worktree-only read นอกจากนี้ interactive Codex `0.150.1` ไม่มี `--ignore-user-config`; fresh profileต้องมี isolated `CODEX_HOME`, readiness/session gate และ whole-process read isolationก่อน verified

Probe ต้องยืนยัน:

- routine edit/test ใน worktree ไม่ถามผู้ใช้; commit เป็น separate capability และค่าเริ่มต้นให้ Coordinator ทำหลัง collect
- network และ external write ไม่ผ่านเอง
- `.git`, `.codex`, secrets และ hook trust ไม่ถูก bypass
- auto-review denial ส่งกลับให้ agent หาทางปลอดภัยกว่า
- effective profile มองเห็นจาก status/log
- ห้ามใช้ `--dangerously-bypass-approvals-and-sandbox` หรือ `--dangerously-bypass-hook-trust`

### Claude Worker

Candidate launch baseline:

```text
claude --permission-mode dontAsk --restricted --setting-sources '' --strict-mcp-config \
  --settings <fail-closed-settings-plus-exact-herdr-hook> \
  --tools Read,Edit,Write,Bash --allowedTools Read,Edit,Write,Bash
```

Temporary settings ต้องมี explicit Read/Write denies, `sandbox.enabled`, `allowUnsandboxedCommands: false`, `failIfUnavailable: true`, filesystem denies และ network deny/allowlistตาม mandate Process environment ต้องเป็น allowlist; direct re-probe รอบที่ inherit parent env ถูก reject ก่อนแก้ด้วย `env -i`

Phase 0 direct profile บน Claude `2.1.251` observed model `claude-sonnet-5`, mode `dontAsk`, exact tools, explicit SessionStart hook และผ่าน routine/test/env/declared-credential/external/network fixturesโดยไม่มี prompt Target ไม่ใช้ `--safe-mode` เพราะจะปิด Herdr hook; `--restricted` ตัด ambient settings แล้ว inject exact hook/settingsเอง `sandbox.credentials` ปิด path/env ที่ประกาศแต่ไม่ใช่ generic host read isolation Historical Herdr `auto` attempts ยังเปิด Write dialog ดังนั้น fresh Herdr `dontAsk` spawn ต้องผ่าน interactive proof ก่อน verified

Probe ต้องยืนยัน:

- observed permission mode เป็น `dontAsk` ไม่ fallback เป็น Manual/auto แบบเงียบ
- routine edit/test ใน worktree ไม่ prompt
- explicit denies ยังบังคับ
- background/subagent prompt ไม่ถูกโยนไป terminal อื่น
- trust/hooks/MCP/project settings ไม่ขยายสิทธิ์เกิน profile
- interaction ที่ต้องคนจริงถูกจำแนกเป็น human-only

ถ้า `dontAsk`, sandbox หรือ exact settings unavailable ให้ profile เป็น unverified และ delegated spawn ต้อง fallback ไป Pi/Codex หรือ manual mode

### OpenCode Worker

Candidate launch baseline:

```text
opencode --auto
```

พร้อม explicit deny rules สำหรับ secrets, uploads, external mutation และ remote effects

Probe ต้องยืนยัน:

- config/agent policy ถูก inject แบบ deterministic โดยไม่พึ่ง global mutable config ที่ session อื่นใช้ร่วมกัน
- `--auto` ไม่ชนะ explicit deny
- `permission.task` ไม่เปิด nested subagents เกิน mandate
- approval rules ไม่มี version-specific wildcard/precedence mismatch
- Herdr lifecycle integration ติดตั้งและ observed identity เป็น lifecycle

จนกว่าจะมี deterministic isolated config injection ให้ OpenCode เป็น manual-only

## Coordinator control loop

Guidance และ tools ต้องทำให้ลำดับต่อไปนี้เป็น default behavior เมื่อ mandate active:

```text
1. Interpret mandate and current evidence
2. Decide own work vs delegation
3. Create the smallest useful worker set
4. Spawn without human gate when policy allows
5. Assign bounded tasks and exact artifacts
6. Wait through lifecycle API, not screen polling
7. Collect and inspect real evidence
8. Accept, correct in place, stop, or replace
9. Re-evaluate remaining work and assurance
10. Continue until DoD or human escalation
11. Report final outcome plus audit summary
```

Coordinator ห้ามจบ turn เพียงเพราะ spawn สำเร็จ ถ้ายังสามารถรอและควบคุมงานต่อได้

### Escalation packet

เมื่อจำเป็นต้องกลับมาหาผู้ใช้ ต้องส่งข้อมูลครบในครั้งเดียว:

- decision ที่ต้องการ
- เหตุผลว่าเกิน mandate ตรงไหน
- Worker/action/target ที่เกี่ยวข้อง
- ทางเลือกที่ปลอดภัยและผลกระทบ
- สิ่งที่จะทำต่อหลังผู้ใช้เลือก
- assurance/DoD ที่จะขาดหากไม่อนุมัติ

ช่องทาง UI จริงของ escalation ยังอยู่นอก scope รอบนี้; mechanism ต้องสร้าง packet ที่ render ได้โดยไม่ผูกกับ `ask user`

## Implementation phases

### Phase 0 — Disposable probes และ decision gates

ไม่เปลี่ยน production behavior

- [x] สร้าง fixture repository ใน OS/harness temporary location
- [x] probe Pi read-only และ worktree-write worker profiles โดยไม่มี dialog
  - [x] non-interactive resource profiles + guardrail + sandboxed Bash
  - [x] real Pi-native RPC/task lifecycleผ่าน atomic agent-teams profile; Herdr external laneยัง manual-only
- [x] gate Codex auto-review + custom permission profile → manual-only
  - shorthand baselineถูก reject; isolated direct declared boundariesและ requested/effective modelผ่าน
  - warm Herdr lifecycleผ่าน แต่ generic host read fail D5; ไม่ fresh-spawnจนมี whole-process isolation
- [x] gate Claude deterministic permission profile → manual-only
  - `auto` baselineถูก reject; direct `dontAsk` declared boundariesผ่านไม่มี prompt
  - `sandbox.credentials` ปิดเฉพาะรายการที่ประกาศ; generic host read fail D5
- [x] probe OpenCode isolated policy + `--auto`
  - direct isolated config ใช้ได้ แต่ Bash redirection ข้าม external-directory deny; delegated profile เป็น no-go
- [x] ตรวจว่า Herdr lifecycle integrations ของ target harness เป็น `current`
  - Pi/Claude/Codex current; OpenCode not installed และไม่ใช่ delegated initial target
- [x] ทดสอบ human-only action, hard deny, provider error, timeout และ missing artifact
  - fake secret, external write และ network hard-deny probes ผ่านใน provisional Pi/Codex/Claude profiles
  - agent-teams provider/image/daemon/readiness/artifact faults fail closed; `git push`เป็น HUMANและ side effects `0`
- [x] ทดสอบว่าผู้ใช้ไม่ต้องกด routine permissions ในหนึ่ง implement-review chain
  - Pi-native implement → review → correction → acceptanceผ่าน tasks `5/5`, artifacts `7/7`, routine approvals/dialogs `0`
  - Codex/Claude external harnessesยัง manual-onlyเพราะ D5 generic host-read gap; ผลนี้ไม่เปิด delegated laneให้สอง harness
- [ ] `pi-agent-teams` gate:
  - [x] ตรวจ full Git lineage, license, source architecture และ source smoke tests
  - [x] เลือก `tmustier` เป็น base candidate; ใช้ `codexstar69` เป็น hardening comparator
  - [x] baseline runtime probe บน Pi `0.84.3` สำหรับ env/secret/network/external-write/worktree
    - RPC/worktree/routine flow ผ่าน; fake `.env`, inherited env, external write และ network ผ่านด้วย จึงยืนยัน no-go as-is
  - [x] disposable child profile injection ไม่ inherit env, โหลด exact tools/extensions, force worktree และใช้ deterministic policy/sandbox
    - routine pass; fake env absent; secret/external/network deny; zero dialogs; upstream smoke 329/329
  - [x] probe direct tools, fail-closed init, worker ceiling และ multi-worker replacement
    - Read/Write/Edit boundary ผ่านหลัง policy v2; missing sandbox config ไม่ register Worker; ceiling 2 deny ตัวที่สาม
    - upload-capable tools ถูกตัดออกจาก exact profile
  - [x] เทียบ `codexstar69` hardening แบบราย feature
    - adapt ready handshake/bounded stop และ worker ceiling พร้อมแก้ stopped/error counting
    - defer lease/retry/priority/polling; event log/doctor/mailbox pruning พิจารณาภายหลัง
  - [x] ปิด Bash host read/write/network gap ด้วย Docker-strong disposable profile
    - worktree-only mount, network none, no HOME/socket mounts; host `/tmp` fixture invisible
    - Gondolin ยังไม่ได้ probe เพราะเครื่องไม่มี QEMU และห้าม install system dependencyใน mandateนี้
  - [x] แก้ graceful Worker shutdown ให้ explicit RPC process exit และคืน ceiling slot
  - [x] แก้ lifecycle gaps: explicit Worker RPC exit release slot และ cleanup suppressionไม่ recreate team entry
  - [x] กำหนด Docker-strong/direct-tool/source-of-truth/upstream contract
    - My Pi own authority/audit/acceptance; agent-teams own Pi task transport/RPC; one backend per Worker
    - direct toolsใช้ scoped operations; Bash mount worktree-only container; no runtime image pull
    - upstream minimal seamsก่อนพิจารณา maintained fork
  - [x] สร้าง immutable Node `24.15.0` image digest, versioned profile package และ SPDX SBOM
    - exact digestผ่าน standalone + patched agent-teams single/multi-worker probes; role-specific toolchainsเป็น future profiles
  - [x] เพิ่ม pure dangerous-command policy fixtureก่อน production wiring
    - covered hardline/mandate-deny command-string variantsไม่ bypass; worktree bind mountยัง guard; delegated REVIEWไม่เปิด human dialog
    - adversarial targeted tests `15/15`; exact grant bind context/expiryและ raw commandไม่เข้า analysis
  - [x] package/wire minimal agent-teams overlay + atomic profile + scoped direct tools
    - exact commit/overlay/image/artifact hashes, frozen child profile, observed env keys, forced worktree และ ceilingถูก verify
    - single/direct/multi replacement runtimeผ่าน; verifier true; full suite `115/115`
    - independent review `PASS-WITH-FOLLOWUPS`; correctionแรก pin Git/entry/whole-source-treeและทำ missing/partial profile env fail closed
    - re-review correctionแรก `FAIL` เพราะ trusted boundary/digest/marker bindingยังไม่พอ; correction v2เพิ่ม exact content hash, derived contract และ nonce/session-bound structured readiness
    - provider/image/daemon/missing/forged-marker/missing-artifact/human-only fault probesผ่าน
    - re-review v2 `FAIL` เพราะ negative startup/apply evidenceยังไม่เป็น committed executable; correction v3เพิ่ม opt-in runtime probe
    - re-review v3ยัง `FAIL` เพราะ reviewerรันใน stale checkoutและ patchมี upstream whitespace context; correction v4ใช้ zero-context overlay + explicit `--unidiff-zero`
    - re-review v4 expose test-harness EPERMจาก global Pi session store; correction v5 isolate child sessionsใน temporary root
    - final independent re-review reproduce self-contained apply-check/profile/negative `6/6` + full suite `115/115` และให้ `PASS`
    - real Pi-native implement→review→correction→acceptanceผ่าน artifacts `7/7`, zero routine approval/dialog และ HUMAN side effects `0`
    - candidateยัง disabled by defaultและ scoped host operationsยังมี TOCTOU limitation
- [x] `pi-extensible-workflows` gate → immediate adoption no-go; เก็บ architecture fitไว้ประเมินใหม่หลัง upstreamแก้ blockers:
  - [ ] ขอ license clarification หรือยืนยัน license artifact ที่มีผลผูกพัน
    - npm/source metadata ระบุ MIT แต่ source และ tarball ไม่มี license text
  - [x] probe pin `5.8.0` ใน isolated `PI_CODING_AGENT_DIR`
    - core-only install exact แต่ combined core/CLI/Herdr specs drift เป็น 5.9.0/5.9.0/5.8.0 เพราะ Pi installer เขียน caret ranges
  - [ ] รัน `piewf doctor`
    - 5.8.0 CLI broken เพราะ tarball ขาด `dist/subagents`; 5.9.0 CLI เปิดได้แต่ doctor fail ที่ bundled reviewer tools `find/grep/ls`
  - [ ] probe standalone subagent, `reviewLoop`, worktree, budget, resume และ Herdr fully-inspectable mode
    - standalone, worktree, budget exhaustion และ persistent-session resume ผ่าน
    - `reviewLoop` และ Herdr mode ยังไม่ผ่าน gate
  - [x] บันทึก API churn/migration cost
    - 5.9.0 publish ระหว่าง probe, แก้ packaging แต่เพิ่ม Trajectory gist sharing capability
- [x] สรุป go/no-go แยกสำหรับแต่ละ harness และ piewf backend
  - patched agent-teams: Phase 0 GO สำหรับ Pi-native adapter development; productionยัง disabled
  - Herdr: GO เป็น manual external control plane; delegated external profiles no-goใน initial release
  - Codex/Claude/OpenCode: manual-only/no-go delegatedตาม D5/policy gaps
  - piewf: no-go สำหรับ immediate dependency; architecture fit ยังเป็นบวกหลังแก้ blockers

Exit criteria observed:

- verified Pi-native profileผ่าน full chain; external delegated profile criterion **ไม่ผ่านโดยตั้งใจ** และถูกตัดเป็น manual-only/no-go แทนการลด boundary
- routine Pi-native flowจบได้โดยไม่ต้องเฝ้า: approvals/dialogs/screen polling `0`
- hard boundaryถูกบังคับตามระดับที่อ้าง: HUMAN remote mutation side effects `0`, artifacts verified `7/7`
- Phase 1 เริ่มได้เฉพาะ pure model/registryที่ไม่เปลี่ยน production behavior; external delegated activationยังห้าม

### Phase 1 — Pure mandate และ policy model

Files:

- `extensions/orchestration-policy.ts` — ใหม่; types, validation, precedence, decision engine
- `extensions/orchestration-registry.ts` — เพิ่ม versioned mandate/audit/profile references
- `tests/orchestration-policy.test.ts` — ใหม่
- `tests/orchestration-registry.test.ts`

Tasks:

- [x] นิยาม versioned mandate, ceilings, outcomes, profile refs และ audit events
- [x] สร้าง pure evaluator ที่ไม่เรียก UI
- [x] บังคับ lower layer ให้ narrow-onlyและสร้าง combined policy digest
- [x] restore session entriesแบบ fail-closed; duplicate active Worker replayถูก rejectแต่ release→register reuseได้
- [x] redact secret-bearing fields/launch argsก่อน audit
- [x] property/table tests สำหรับ precedence, hard-deny invariants, stale/malformed stateและ object aliasing

Evidence:

- producer `6ebe29b`; independent review `FAIL` พบ mutable state/history alias + duplicate Worker register replay
- correction `1b403d4` deep-clone registry/audit/profile snapshots, restrict immutable Worker patchesและ fail-close duplicate active registration
- independent correction re-review `PASS`; full suite `133/133`, `git diff --check`ผ่าน
- `extensions/orchestration.ts` และ production entrypointsไม่ถูกแก้; pure modelยังไม่เปลี่ยน runtime behavior

Exit criteria:

- evaluator deterministic และครอบคลุมทุก action class ที่ guardrails ตรวจได้
- malformed/stale mandate fail closed
- session restore ไม่ยกระดับสิทธิ์

### Phase 2 — Refactor Guardrails และ Pi worker profile

Files:

- `extensions/guardrails.ts`
- `extensions/worker-mode.ts`
- `extensions/orchestration.ts`
- อาจเพิ่ม `extensions/worker-policy.ts` หาก separation ชัดกว่า
- `tests/guardrails.test.ts`
- `tests/worker-mode.test.ts`

Tasks:

- [ ] แยก detection (`MutationFinding[]`) ออกจาก policy decision และ UI rendering
- [ ] เพิ่ม structured command findings + bounded normalization/parser seam โดย collect decisionครั้งเดียว
- [ ] hardline/user-policy/mandate denyมาก่อน bypass; unknown/headless fail closed
- [x] bind REVIEW grantกับ command digest, Worker/session, unique mandate id, verified profile, authoritative combined policy digest, cwd/workspace, finding/resource scope และ expiry; trusted session registry consume-once/revoke/restore fail closed
- [ ] ให้ normal interactive session คง behavior เดิมใน manual mode
- [ ] ให้ delegated Worker ไม่เปิด dialog
- [ ] ส่ง policy reference ตอน spawn แบบ atomic และยืนยัน Worker โหลด profileจริง
- [x] เพิ่ม generated per-Worker runtime profile materializer + authority-bound verifier + identity-bound cleanup โดยไม่รับ Default fallback
- [x] สร้าง synthetic `HOME`, explicit `PI_CODING_AGENT_DIR`/session dir, minimal settingsและ explicit untrusted-project state
- [x] project minimal provider credentialเพียง providerเดียวโดย secretไม่เข้า manifest/digest/env/tools
- [ ] แยก read-only/worktree-write profilesใน execution adapter (template contractรองรับทั้งสอง modeแล้ว)
- [ ] จำกัด active tools/extensions/skills ตาม profile
- [ ] เพิ่ม OS sandboxed bash baseline และบันทึก limitation ของ direct tools
- [x] cleanup generated profileต้อง match canonical root + disk manifest identity; run-level retention/reaperยัง deferถึง adapter wiring

REVIEW registry evidence:

- producer `c5457e5`; independent review `FAIL` พบ partial appendที่อาจ consumeซ้ำและ worker-selectable 64-hex policy namespace
- correction `23c4b1b` ใช้ authoritative appendเดียวต่อ grant transition, append failureทำ registry fail closed, bind requestกับ `AuthorityProfileRef.policyDigest`, reject duplicate profile refsและ mandate-id reuse
- independent correction re-review `PASS`; grant issue/consume-once/replay/revoke/expiry/tamper/HUMAN-DENY testsผ่าน, full suite `142/142`
- registryยัง pure/unwired; production executionและ manual UI behaviorยังไม่เปลี่ยน

Exit criteria:

- Pi Worker ทำ routine implementation/test/commit ใน worktree โดยไม่ blocked
- secret/upload/external write scenarios ถูก deny โดยไม่มีไฟล์หรือข้อมูลรั่ว
- profile marker และ observed identity ตรวจได้จาก Coordinator

### Phase 3 — Delegated spawn และ control loop

Files:

- `extensions/orchestration.ts`
- `extensions/orchestration-registry.ts`
- `skills/herdr-orchestration/SKILL.md`
- `README.md`
- tests ที่เกี่ยวข้อง

Tasks:

- [ ] เปลี่ยน command modes เป็น delegated/manual/off พร้อม migration alias
- [ ] เพิ่ม tool สำหรับ activate/replace/finish mandate โดยไม่เปิด UI
- [ ] spawn ตรวจ policy ก่อน side effect
- [ ] delegated spawn ข้าม confirmation แต่ append preview/audit
- [ ] manual spawn คง confirmation เดิม
- [ ] guidance ประกาศ authority ใหม่และ control-loop completion rule
- [ ] status แสดง mandate, ceilings, workers, escalations และ assurance
- [ ] unexpected blocked state สร้าง profile defect/escalation packet ไม่ถามผู้ใช้ซ้ำแบบ routine
- [ ] correction/retry/stop ถูกนับใน limits

Exit criteria:

- natural-language task หนึ่งงานทำ implement → review → correction → verify ได้ใน Coordinator turn โดยผู้ใช้ไม่ต้องกด spawn หรือ routine guardrail
- action เกิน mandate ไม่รันและสร้าง escalation packet

### Phase 4 — Native harness adapters

Files:

- แยก adapter จาก `extensions/orchestration.ts` เช่น `extensions/harness-profiles.ts`
- `tests/harness-profiles.test.ts`
- runtime fixture/probe scripts ใช้ temporary path ของ harness

Tasks:

- [ ] Codex verified profile
- [ ] Claude verified profile
- [ ] OpenCode profile เมื่อ isolated config injection พร้อม
- [x] pure builders pin/validate Codex `0.150.1` และ Claude `2.1.251`; real help/config startup probesผ่าน
- [x] detect unsupported version/removed help flags ใน profile layerก่อนสร้าง pane
- [x] pure verifiersแยก requested จาก observed/effective model/mode/tools/config digest/readiness/lifecycle
- [ ] wire profile artifacts/environment injection และ deny launchจริงเมื่อ effective profileยืนยันไม่ได้

Exit criteria:

- adapter ทุกตัวมี version probe, launch args, safety assertions และ failure behavior
- ไม่มี adapter ใช้ bypass/full-access flag

### Phase 5 — Parallel ownership และ fan-in

Reuse worktree/ownership discipline จากแผนเดิม

- [ ] batch spawn ภายใต้ max concurrency
- [ ] writing Worker ทุกตัวมี exact disjoint scope
- [ ] shared files และ unresolved design decisions ทำ serial
- [ ] Coordinator รวมผลเอง
- [ ] collision detection ก่อน fan-in
- [ ] partial failure ไม่ทำให้รับ sibling artifact แบบไม่ตรวจ
- [ ] assurance evaluator ใช้ producer/verifier identity เดิม

Exit criteria:

- parallel read-heavy และ disjoint-write scenarios ผ่าน
- overlapping write scope ถูกปฏิเสธก่อน execution

### Phase 6 — `pi-extensible-workflows` adoption gate

หลัง Phase 0 evidence เท่านั้น

ถ้า **go**:

- [ ] เพิ่ม exact pinned dependency
- [ ] เขียน package extension ใน `mypi-workflow-orchestrator` หรือรวมเฉพาะส่วนที่ ownership ชัด
- [ ] map mandate ceiling ไป role/resource selectors และ budgets
- [ ] ใช้ piewf durable subagents/workflows สำหรับ Pi-native lanes
- [ ] ใช้ `@piewf/herdr` สำหรับ inspectability แทน custom Pi pane plumbing
- [ ] คง custom Herdr backend เฉพาะ heterogeneous external harnesses
- [ ] กำหนด source of truth เดียวต่อ run ห้าม registry สองชุดแข่งกัน

ถ้า **no-go**:

- [ ] จำกัด custom layer ไว้ที่ control loop ที่จำเป็น
- [ ] ไม่เพิ่ม journal/replay/budget engine เองโดยไม่มีแผนแยกและเหตุผลใหม่
- [ ] ใช้ standalone subprocess/Herdr lifecycle แบบปัจจุบันพร้อม documented limitations

### Phase 7 — Real acceptance และ migration completion

Acceptance scenarios:

1. Pi Worker implement + test + local commit
2. Codex Worker ภายใต้ auto-review
3. Claude Worker ภายใต้ `dontAsk` + exact allowlist/sandbox
4. read-only research/review Worker
5. correction ขณะ Worker active
6. unexpected permission escalation
7. secret read และ upload attempt
8. external write/network attempt
9. architecture/scope escalation
10. provider failure, timeout, Worker exit, missing artifact
11. parallel disjoint ownership
12. resume Coordinator session ระหว่างมี Workers

Success metric หลัก:

- routine implement-review chain: **0 user approvals หลัง mandate active**
- human-only action: **0 side effects ก่อนผู้ใช้ตัดสิน**
- artifact acceptance: **100% agreed artifacts verified**
- external/secret/upload denial fixtures: **0 leaked bytes / 0 created targets**
- no polling loops และ no generic auto-click

## Migration plan

### Existing state

- registry entries เดิมยังอ่านได้
- Worker tools เดิมยัง callable ใน manual mode
- worktrees และ branches ไม่ถูกลบหรือย้าย
- `automatic` mode restore เป็น `manual`

### Documentation lifecycle

- [Pi Coordinator บน Herdr](pi-herdr-coordinator.md) เปลี่ยน status เป็น `superseded` แต่คง implementation/probe history
- [Runtime-negotiated Orchestration](../notes/runtime-negotiated-herdr-orchestration.md) เปลี่ยนเป็น `partially superseded`; runtime primitives และ evidence discipline ยังใช้ แต่ authority/approval contract ถูกแทนที่
- `docs/README.md` ชี้ plan นี้เป็น active

### Rollback

ทุก phase ต้องสามารถกลับไป `manual` mode ได้โดยไม่ rewrite session history:

- policy/profile failure → delegated spawn ถูกปิดสำหรับ profile นั้น
- user command `/mypi-orchestrate manual`
- existing manual confirmation path ยังอยู่จน real acceptance ผ่านครบ
- ห้ามลบ legacy code ก่อน delegated acceptance และ migration tests ผ่าน

## Verification matrix

| Area | Unit | Integration | Real runtime |
|---|---|---|---|
| Policy precedence | table/property tests | session restore + narrowing | mandate expansion attempt |
| Spawn authority | delegated/manual/off | fake Herdr side effects | no-dialog spawn chain |
| Pi guardrails | finding + resolver tests | Worker policy load | secret/upload/external fixtures |
| Harness profiles | arg/config validation | CLI help/version probe | routine + escalation task |
| Worker lifecycle | registry reconciliation | wait/handoff/collect | timeout, exit, blocked |
| Evidence | artifact/ref tests | diff/test verification | missing/scope-drift cases |
| Parallel | scope intersection tests | worktree batch | disjoint and overlap scenarios |
| Migration | old entry fixtures | resumed old session | rollback to manual |

## Risks and cautions

1. **Coordinator reviewer ไม่ใช่ security boundary** — model อาจตัดสินผิด ต้องมี deterministic denies และ sandbox แยก
2. **Pi direct tools** — sandboxed bash อย่างเดียวไม่ครอบ read/write/edit; strong profile ต้อง route operations หรือใช้ VM/container
3. **Harness mode fallback** — Claude/OpenCode/Codex อาจเปลี่ยน flag/availability; ต้องยืนยัน effective profile ไม่ใช่เชื่อ args
4. **Prompt injection** — web/content input อาจชักจูง Worker ให้ exfiltrate; secrets/uploads/network ต้อง enforce นอก prompt
5. **External harness config leakage** — temporary settings ต้อง isolated และ cleanup; ห้ามแก้ global config ระหว่าง session
6. **Cost runaway** — custom Herdr backend ยังไม่มี exact cross-harness accounting; ใช้ launch/concurrency limits ก่อน และไม่อ้าง cost hard limit
7. **Approval loops** — auto reviewer deny ซ้ำต้องมี circuit breaker และ correction scope ที่หดลง
8. **Piewf churn** — versions 5.5–5.8 มี breaking changesถี่; ต้อง pin และมี compatibility suite
9. **Piewf license** — package metadata/README ระบุ MIT แต่ source checkout ไม่มี LICENSE file; เป็น blocker ต่อ dependency adoption จนชัดเจน
10. **Dual source of truth** — ถ้าใช้ piewf ร่วมกับ custom registry ต้องแบ่ง run ownership ชัด ห้ามทั้งสองควบคุม agent เดียวกัน
11. **External harness host reads** — Codex/Claude profilesปิด declared credentialsได้แต่ generic host readsยังไม่ใช่ worktree-only isolation; credential registryต้อง explicit และ strong profileต้องใช้ whole-process container/VM

## Open questions และค่าเริ่มต้นที่แนะนำ

| Question | Recommended starting decision |
|---|---|
| Mandate อยู่ที่ไหน | Pi session entries; global/project files เก็บเฉพาะ ceilings เมื่อมี use case จริง |
| Delegated เป็น default หรือไม่ | default สำหรับ Herdr session ใหม่หลัง acceptance; manual เป็น rollback |
| Coordinator review แบบไหน | deterministic policy ก่อน; harness-native reviewer สำหรับ ambiguous boundary; human เฉพาะ HUMAN |
| Budget | จำกัด concurrent/launch count ก่อน; cost budget เฉพาะ backend ที่วัดได้จริง |
| Pi isolation | worktree + restricted resources + sandboxed bash baseline; strong profile ใช้ Gondolin/container |
| External harnesses | Codex ก่อน, Claude ถัดไป, OpenCode หลัง isolated config injection ผ่าน |
| Piewf | evaluation gate ไม่ใช่ immediate dependency |
| Human escalation UI | สร้าง neutral escalation packet ก่อน; UI design พักตามคำขอ |

## Definition of Done

ถือว่าแผนนี้ implement สำเร็จเมื่อ:

- ผู้ใช้สามารถมอบหมายงานให้ Coordinator แล้วออกจากหน้าจอได้
- Coordinator สร้างและควบคุม Workers ต่อจนถึง DoD โดยไม่ต้องให้ผู้ใช้กด routine approvals
- Worker ทุกตัวทำงานภายใต้ verified profile และ exact ownership
- secrets, uploads, external mutation และ remote destructive actionsไม่ผ่าน boundary ที่กำหนด
- human-only decisions หยุดก่อน side effect และให้ข้อมูลตัดสินใจครบ
- Coordinator ตรวจ artifacts และ verification จริงก่อนรับงาน
- manual mode ยังใช้ rollback ได้
- docs, migration, tests และ real acceptance ครบ
- ไม่มีการอ้าง security guarantee เกิน enforcement ที่ตรวจได้

## Phase 2 progress — generated Worker profile core

- เพิ่ม `extensions/worker-profile-runtime.ts` เป็น pure/incubator materializer, verifierและ cleanup; ยังไม่มี production entrypoint
- private runtime hierarchyใช้ non-recursive canonical children, mode `0700`; files `0600`
- manifest/profile digestไม่มี credential values และ verifierต้องรับ Coordinator-held expected digestก่อน follow path
- credential projectionมี providerเดียว; ambient key/token/auth variablesถูก strip และ child Bash/toolsไม่ได้รับ secret
- exact launch argsปิด extension/skill/prompt/theme/context discovery, pin tools/provider/model/sessionและ explicit extensions
- unit/sentinel tests `12/12` รวม real child Piที่ไม่เห็น Default/project canaries; full suite `158/158`
- producer checkpoint `077d5c7`; self-review correction `9baa988` bind cleanupกับ runtime root + expected profile digestและหยุดอ่าน untrusted filesก่อน path/permission gateผ่าน
- independent reviewให้ `FAIL` เพราะ ambient `defaultAgentDir` fallbackและ missing exact-argv/unrelated-cleanup tests
- correction `aba088a`ลบ fallback, require authority pathและเพิ่ม regressions; targeted `14/14`, full suite `160/160`
- independent correction reviewให้ **PASS**; เก็บ auditที่ [Generated Worker Profile Core Independent Review](../notes/worker-profile-core-independent-review.md)

## Agent-teams Worker profile adapter progress

- adapter `0bd7069` materialize exact child profileจาก single-use leaseและคง production unwired
- independent reviewให้ `FAIL` สอง High: unsigned lease replayข้าม identityและ lease-delete failureหลัง profileพร้อม
- correction `0c64f4e`ใช้ signed identity/nonce/TTL-bound lease, pinned Ed25519 public key, durable consume markerและ atomic claimก่อน materialization; cleanup errorsไม่ถูก suppress
- independent correction reviewให้ **PASS**; follow-up `0cd4e7b`เพิ่ม run/future/TTL/wrong-key/post-claim failure regressions
- auditอยู่ที่ [Agent-teams Worker Profile Adapter Independent Review](../notes/agent-teams-worker-profile-adapter-independent-review.md)
- setup/brokerที่ออก leaseยังไม่ implement; adapterและ coreยังไม่มี production import

## Patched spawn/readiness binding progress

- producer `78e9db7` bind exact adapter/runtime hashes, machine runtime contract, signed lease provisioning, generated argv/environment, readiness identityและ lifecycle cleanupเข้า zero-context overlay
- initial independent reviewให้ `FAIL` สอง Medium: ambient `LC_*` secret inheritanceและ cleanup generation race
- correction `ae489b2`ใช้ exact generated environmentเท่านั้น, cleanup keyedด้วย profile digest + object identityและเพิ่ม ambient-secret runtime probe
- independent correction reviewให้ **PASS**; follow-up `5e6ff5d`ปรับ negative testsให้ตรง current contract
- legacy real-provider acceptance probeถูก blockด้วย exit `78`; historical Phase 0 chainไม่ใช่ acceptanceของ wiringใหม่
- auditอยู่ที่ [Agent-teams Generated Profile Binding Independent Review](../notes/agent-teams-generated-profile-binding-independent-review.md)
- runtime/fault probes `10/10`, patched upstream typecheck/lintผ่าน และ production importยังไม่มี

## Worker machine setup progress

- `85beb57`เพิ่ม atomic/idempotent setup, verify, rotate, recoverและ incubator-only `/mypi-worker-setup`
- corrections `0b8423a`, `bd8a924`, `1465c8d`, `348eab8` bind source/setup/revision, serialize rotate/issue, เพิ่ม signed crash journal, stale-lock recovery, receipt-gated operator recoverและ parent-directory fsync
- independent reviewหลายรอบปิด Medium findingsทั้งหมด; final verdict **PASS**
- auditอยู่ที่ [Worker Machine Setup Independent Review](../notes/worker-machine-setup-independent-review.md)
- full suiteล่าสุดก่อน final fsync correction `192/192`; final targeted setup/profile tests `22/22`; runtime probes `10/10`
- productionยัง disabledและ real-provider acceptanceยัง exit `78`

## Generated-path acceptance harness progress

- `82ac9d2`เพิ่ม `/mypi-worker-acceptance`, pinned source runnerและ real-provider artifact flowผ่าน patched leader → generated Worker
- corrections `df78477`, `48f9edd`, `51c6006`ยืนยัน same-name replacement generation, fresh-session verify receiptและ redacted inspectable failure envelopesทุก runner stage
- independent correction reviewสุดท้าย **PASS**; auditอยู่ที่ [Agent-teams Generated-path Acceptance Harness Review](../notes/agent-teams-generated-path-acceptance-harness-review.md)
- full suite `193/193`, runtime/fault probes `10/10`, absent-machine blocker exit `78`
- operator setupสำเร็จ; initial acceptance expose missing upstream lock, worktree/runtime overlapและ backend-tool readiness mismatch
- corrections `cb05e2f`, `5340500`เพิ่ม exact acceptance dependency lock, sibling private worktree root, full tool readinessและ measured evidence
- generated-path real-provider run `5340500` **PASS**: 7/7 checks, interactive requests `0`, generated profile removed, no reusable credential state
- `d09c982`, `567826a`เพิ่ม exact PID SIGKILL, generation-bound cleanup, immediate same-name retry serializationและ rotation integration
- crash acceptance **PASS 8/8** profile `dcf7b3d0…`; active rotate block → stale revision reject → new revision spawnผ่าน
- `d5273ed`, `637f0b0`เพิ่ม parent-loss watchdog + exact self-clean, canonical nonsecret marker, orderly-shutdown classificationและ retained recovery worktree
- generated-path acceptance **PASS 11/11** profile `368d561e…`; leader-loss pathไม่มี reusable credential state
- `89b91b6`, `6ef5705`แยก `read-only-v1`/`worktree-write-v1`, bind exact managed path, canonical cwd, generated manifestและ structured readiness; independent correction review **PASS**
- final generated-path acceptance **PASS 13/13** profile `49aa101f…`; interactive requests `0`, no reusable credential state, full suite `198/198`, runtime probes `10/10`
- execution-adapter auditอยู่ที่ [Worker Execution Adapters Independent Review](../notes/worker-execution-adapters-independent-review.md)
- evidenceอยู่ที่ [Agent-teams Generated-path Real-provider Acceptance](../notes/agent-teams-generated-path-real-provider-acceptance.md)
- productionยัง disabled

## Exact next action

1. ขอ independent final Phase 2–3 evidence reviewทั้ง generated profile, machine authority, crashes, leader-lossและ dual execution adapters
2. หลัง profile pathผ่าน จึงแยก guardrail detection → resolution → UI และ wire delegated resolver
3. รัน production-path acceptanceอีกครั้งหลัง resolver wiring โดย productionยัง disabled
4. ขอ human decisionก่อน production import, push, release/tagหรือ Default Pi switch

External push, release/tagและ Default Pi switchเป็น human-only mutationsและยังไม่ทำ

ห้ามโหลด agent-teams candidate, production-wire delegated Workerหรือข้าม manual Herdr confirmationจน Phase 2–3 production-path acceptanceผ่าน
