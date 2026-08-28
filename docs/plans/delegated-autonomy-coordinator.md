# ปรับ Pi/Herdr Coordinator เป็น Delegated Autonomy

> **Status:** active — Phase 0 runtime probes<br>
> **Created:** 2026-08-28 15:32<br>
> **Updated:** 2026-08-28 19:10<br>
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
| Claude Code | `2.1.248` | `auto` ใช้ classifier; subagents/teams ทำ orchestration และ permission inheritance |
| Codex CLI | `0.150.1` | แยก sandbox กับ approval; `--approve-for-me` route escalation ไป automatic reviewer |
| `pi-extensible-workflows` | npm `5.8.0`, source `ecadda0` | มี workflows, durable subagents, roles, selectors, budgets, worktrees, replay/resume และ Herdr transport; แต่ release เปลี่ยนเร็วและ repository ยังไม่มี LICENSE file แม้ package metadata/README ระบุ MIT |

### Engine decision

ใช้แนวทาง **incremental + decision gate**:

1. **ระยะต้น:** ปรับ custom Herdr Coordinator ปัจจุบันให้มี mandate, policy และ delegated mode เพราะรองรับ heterogeneous harnesses อยู่แล้วและให้ผลต่อ UX ได้เร็ว
2. **ไม่ขยาย custom layer เป็น workflow engine เต็มรูปแบบ:** budget accounting, deterministic script, journal replay, background durable runs และ reusable workflows ต้องประเมิน `pi-extensible-workflows` ก่อนเขียนซ้ำ
3. **Phase หลัง:** ทดสอบ `pi-extensible-workflows` ใน profile แยก ถ้า license, compatibility และ acceptance ผ่าน ให้ใช้เป็น Pi-native execution backend และคง custom Herdr adapter เฉพาะ external harnesses
4. **ห้ามคัดลอก source จาก `pi-extensible-workflows`** จนกว่า license grant จะชัดเจน ใช้ได้เพียง public API/design evidence ในช่วง evaluation

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
│  Herdr backend (initial)          Pi workflow backend (gate)│
│  ├─ Pi worker profile             ├─ piewf subagents        │
│  ├─ Codex auto-review profile     ├─ workflows/reviewLoop   │
│  ├─ Claude auto profile           └─ budgets/replay/resume  │
│  └─ OpenCode auto+deny profile                              │
└─────────────────────────────┬───────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ Per-worker boundary                                         │
│ worktree · tools/resources · filesystem · network · secrets │
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
claude --permission-mode auto --restricted --safe-mode --strict-mcp-config \
  --settings <temporary-fail-closed-sandbox-settings>
```

Temporary settings ต้องมี explicit Read denies, `sandbox.enabled`, `allowUnsandboxedCommands: false`, `failIfUnavailable: true`, filesystem denies และ network deny/allowlist ตาม mandate Phase 0 ยืนยันว่า `auto --restricted --safe-mode` โดยไม่มี sandbox settings ยังอ่าน secret, เขียน external path และใช้ network ได้

Probe ต้องยืนยัน:

- auto mode พร้อมใช้งานจริง ไม่ fallback เป็น Manual แบบเงียบ
- routine edit/test ใน worktree ไม่ prompt
- explicit denies ยังบังคับ
- background/subagent prompt ไม่ถูกโยนไป terminal อื่น
- trust/hooks/MCP/project settings ไม่ขยายสิทธิ์เกิน profile
- interaction ที่ต้องคนจริงถูกจำแนกเป็น human-only

ถ้า auto mode unavailable ให้ profile เป็น unverified และ delegated spawn ต้อง fallback ไป Pi/Codex หรือ manual mode

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
- [ ] probe Pi read-only และ worktree-write worker profiles โดยไม่มี dialog
  - [x] non-interactive resource profiles + guardrail + sandboxed Bash
  - [ ] Herdr interactive lifecycle profile
- [x] probe Codex auto-review + custom permission profile
  - shorthand `--approve-for-me --sandbox workspace-write` ถูก reject
  - custom profile ผ่าน routine/secret/external/network probes; local commit ถูก deny
- [x] probe Claude `auto` และ fallback behavior
  - `auto` อย่างเดียวถูก reject
  - explicit fail-closed sandbox settings ผ่าน routine/secret/external/network probes
- [x] probe OpenCode isolated policy + `--auto`
  - direct isolated config ใช้ได้ แต่ Bash redirection ข้าม external-directory deny; delegated profile เป็น no-go
- [ ] ตรวจว่า Herdr lifecycle integrations ของ target harness เป็น `current`
  - Pi/Claude/Codex current; OpenCode not installed
- [ ] ทดสอบ human-only action, hard deny, provider error, timeout และ missing artifact
  - fake secret, external write และ network hard-deny probes ผ่านใน provisional Pi/Codex/Claude profiles
- [ ] ทดสอบว่าผู้ใช้ไม่ต้องกด routine permissions ในหนึ่ง implement-review chain
- [ ] `pi-extensible-workflows` gate:
  - [ ] ขอ license clarification หรือยืนยัน license artifact ที่มีผลผูกพัน
    - npm/source metadata ระบุ MIT แต่ source และ tarball ไม่มี license text
  - [x] pin `5.8.0` ใน isolated `PI_CODING_AGENT_DIR`
  - [ ] รัน `piewf doctor`
    - 5.8.0 CLI broken เพราะ tarball ขาด `dist/subagents`; 5.9.0 CLI เปิดได้แต่ doctor fail ที่ bundled reviewer tools `find/grep/ls`
  - [ ] probe standalone subagent, `reviewLoop`, worktree, budget, resume และ Herdr fully-inspectable mode
    - standalone, worktree, budget exhaustion และ persistent-session resume ผ่าน
    - `reviewLoop` และ Herdr mode ยังไม่ผ่าน gate
  - [x] บันทึก API churn/migration cost
    - 5.9.0 publish ระหว่าง probe, แก้ packaging แต่เพิ่ม Trajectory gist sharing capability
- [ ] สรุป go/no-go แยกสำหรับแต่ละ harness และ piewf backend
  - piewf: no-go สำหรับ immediate dependency; architecture fit ยังเป็นบวกหลังแก้ blockers

Exit criteria:

- มี verified profile อย่างน้อย Pi หนึ่งแบบและ external harness หนึ่งแบบ
- routine flow จบได้โดยไม่ต้องเฝ้า
- hard boundary ถูกบังคับจริงตามระดับที่อ้าง

### Phase 1 — Pure mandate และ policy model

Files:

- `extensions/orchestration-policy.ts` — ใหม่; types, validation, precedence, decision engine
- `extensions/orchestration-registry.ts` — เพิ่ม versioned mandate/audit/profile references
- `tests/orchestration-policy.test.ts` — ใหม่
- `tests/orchestration-registry.test.ts`

Tasks:

- [ ] นิยาม mode, mandate, ceilings, outcomes และ audit events
- [ ] สร้าง pure evaluator ที่ไม่เรียก UI
- [ ] บังคับ lower layer ให้ narrow-only
- [ ] restore/migrate session entries เดิม
- [ ] redact launch config ก่อน audit
- [ ] property/table tests สำหรับ precedence และ hard-deny invariants

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
- [ ] ให้ normal interactive session คง behavior เดิมใน manual mode
- [ ] ให้ delegated Worker ไม่เปิด dialog
- [ ] ส่ง policy reference ตอน spawn แบบ atomic และยืนยัน Worker โหลด profile จริง
- [ ] แยก read-only/worktree-write profiles
- [ ] จำกัด active tools/extensions/skills ตาม profile
- [ ] เพิ่ม OS sandboxed bash baseline และบันทึก limitation ของ direct tools
- [ ] cleanup temporary policy artifacts

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
- [ ] runtime validate flags กับ installed CLI version
- [ ] detect unsupported/removed flags ก่อนสร้าง pane
- [ ] record requested profile แยก observed/effective profile
- [ ] deny delegated launch เมื่อ effective permission mode ยืนยันไม่ได้

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
3. Claude Worker ภายใต้ auto classifier
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

## Exact next action

ดำเนิน Phase 0 ส่วนที่เหลือตามลำดับ:

1. ให้ Worker จบ independent `pi-extensible-workflows` report หลังผู้ใช้ deny external temp redirect แล้วตรวจเทียบกับ Coordinator evidence
2. รัน provisional Pi/Codex/Claude profiles ผ่าน Herdr lifecycle จริง
3. รัน implement → review → correction chain โดยไม่มี routine approval
4. ทดสอบ provider error, timeout, missing artifact และ human-only escalation
5. สรุป go/no-go แล้วจึงเริ่ม Phase 1 pure mandate/policy model

ห้ามแก้ production behavior ก่อนสรุปผล probe และอัปเดต decisions/profile verification ในแผนนี้
