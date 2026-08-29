# Delegated Autonomy สำหรับ Coordinator และ Guardrails

> **Status:** ทิศทางที่ผู้ใช้ยืนยันให้ศึกษาต่อ<br>
> **Created:** 2026-08-28 15:20<br>
> **Updated:** 2026-08-29 19:41<br>
> **Purpose:** บันทึก pain points, root cause และผลเปรียบเทียบ OpenCode, Claude Code และ Codex CLI เพื่อใช้รื้อ Pi/Herdr Coordinator จากระบบที่ถามอนุมัติทุกขั้นเป็นการมอบอำนาจแบบมีขอบเขต

## บริบทและความคาดหวังของผู้ใช้

เมื่อใช้ Herdr Coordinator และ Workers จริง ผู้ใช้พบ friction สามกลุ่ม:

1. Coordinator ยังไม่ทำหน้าที่เสมือนหัวหน้าทีมที่แตกงาน สร้างลูกทีม ควบคุม แก้ไข และประเมินผลงานให้เอง แต่ทำหน้าที่เป็นผู้เสนอ Worker แล้วรอผู้ใช้ตัดสินใจแทบทุกขั้น
2. Guardrails ของ Worker ทำให้ผู้ใช้ต้องเฝ้าอนุมัติในแต่ละ pane แม้ว่าผู้ใช้คาดหวังว่าจะตกลงเป้าหมายและแผนกับ Coordinator แล้วปล่อยให้ Coordinator คุมงานจนเสร็จ
3. Plannotator และ `ask user` มี friction ที่เกี่ยวข้อง แต่ผู้ใช้ให้พักหัวข้อนี้ไว้ก่อน แผนรอบถัดไปจึงไม่ควรผูกการรื้อ guardrails/orchestration กับการออกแบบสองส่วนนี้

ภาพการทำงานที่ต้องการคือ:

```text
ผู้ใช้กำหนด goal, scope, constraints และสิ่งที่ต้อง escalate หนึ่งครั้ง
                              │
                              ▼
Coordinator ได้รับ bounded mandate
  ├─ แตกงานและเลือกว่าจะทำเองหรือใช้ Workers
  ├─ สร้าง/หยุด/แก้ task ของ Workers ภายในเพดานที่ตกลง
  ├─ ตัดสิน permission escalation ระดับ routine แทนผู้ใช้
  ├─ ตรวจ artifact, diff และ verification
  ├─ ส่ง correction หรือสร้าง reviewer ตามหลักฐาน
  └─ กลับมาหาผู้ใช้เมื่อเกิน mandate หรือเมื่อได้ผลลัพธ์สุดท้าย
```

ผู้ใช้ไม่ควรต้องเฝ้า pane เพื่ออนุมัติ action ปกติที่อยู่ในขอบเขตงานซึ่งตกลงไว้แล้ว

## Root cause ใน `my-pi` ปัจจุบัน

ปัญหาไม่ใช่เพียง approval dialog มากเกินไป แต่เป็น **authority contract ที่ไม่ตรงกับความคาดหวัง**

### Contract ปัจจุบัน

- `extensions/orchestration.ts` inject guidance ว่า “user decides who joins and approves every result” และให้ Coordinator เสนอทีมแล้วรอผู้ใช้อนุมัติ
- `mypi_spawn_worker` ระบุใน tool contract ว่าต้องถามผู้ใช้ทุกครั้ง และปฏิเสธ non-interactive execution
- `extensions/worker-mode.ts` ปิด interactive tools บางตัว แต่ตั้งใจคง guardrails ที่ถามผู้ใช้ไว้ แล้ว bridge `blocked` กลับให้ Coordinator แสดงต่อผู้ใช้
- `skills/herdr-orchestration/SKILL.md` ระบุว่า user เป็นผู้เลือกทีมและ Coordinator ห้าม approve แทน
- `docs/plans/pi-herdr-coordinator.md` ตัดสินใจไว้ชัดว่า Worker ต้องคง guardrails เดิม, ห้าม auto-approve/auto-deny และทุก spawn ต้องผ่าน preview + user confirmation

Contract นี้สร้างระบบแบบ **human-supervised delegation** ไม่ใช่ **delegated autonomy**

### ความไม่สอดคล้องกับแนวคิด orchestrator เดิม

`/Users/developer/my-project/mypi-workflow-orchestrator/README.md` กำหนดเป้าหมายไว้ว่า:

- มี AI orchestrator หลักคุมการทำงาน
- workflow กำหนดและ reuse ได้
- step เลือก model, skill และ capacity ได้
- orchestration เป็นกลไกหลัก ไม่ใช่เพียง UI สำหรับเสนอ subagent

เอกสาร `docs/notes/runtime-negotiated-herdr-orchestration.md` เดิมยังมีตัวอย่าง policy ที่เหมาะกับ delegated autonomy มากกว่า implementation ปัจจุบัน คือให้ผู้ใช้เข้ามาเฉพาะ:

- destructive operation
- architecture change
- scope expansion
- security tradeoff

แต่ระหว่าง implementation มีการเลือกรัด MVP ให้ถามทุก spawn และทุก Worker guardrail ซึ่งปลอดภัยแบบ fail-closed แต่โยน coordination cost ทั้งหมดกลับไปให้ผู้ใช้

## สิ่งที่ตรวจสอบ

ตรวจเมื่อ 2026-08-28 จากเอกสารทางการและ CLI ที่ติดตั้งในเครื่อง:

| Product | Version ที่ตรวจในเครื่อง |
|---|---|
| OpenCode | `1.18.21` |
| Claude Code | `2.1.248` |
| Codex CLI | `0.150.1` |

เอกสารและ behavior ของผลิตภัณฑ์เหล่านี้เปลี่ยนเร็ว จึงต้อง revalidate ก่อนนำรายละเอียด version-specific ไป implement

## OpenCode

### Permission model

OpenCode ใช้กฎ `allow`, `ask`, `deny` ตาม tool/resource และให้กฎเฉพาะ agent override กฎ global ได้ กฎรองรับ path, shell command, URL, agent/subagent และ external directory

ค่าเริ่มต้นในเอกสาร V1 ค่อนข้าง permissive:

- action ส่วนใหญ่ `allow`
- external directory และ doom loop จึงค่อย `ask`
- `.env` ถูกป้องกันแยกจาก read ปกติ

CLI ที่ติดตั้งรองรับ `--auto`:

```text
--auto  auto-approve permissions that are not explicitly denied
```

ดังนั้น auto mode เปลี่ยน action ที่เดิมจะ `ask` ให้ผ่าน แต่ explicit `deny` ยังคงบังคับใช้

### Agent orchestration

- primary agent เรียก subagent อัตโนมัติจาก description ได้
- `permission.task` กำหนดได้ว่า agent ใดเรียก subagent ตัวใดได้เอง, ต้องถาม หรือห้าม
- subagent แต่ละชนิดมี permission profile ของตัวเอง
- read-only explorer/reviewer ใช้ deny การแก้ไฟล์แทนการรอผู้ใช้ตอบทุกครั้ง
- approval รองรับ once และ always; policy ที่บันทึกไม่สามารถชนะ explicit deny

### บทเรียนสำหรับ `my-pi`

- การสร้าง Worker เป็น permission action ชนิดหนึ่ง ไม่จำเป็นต้องเป็น hard-coded user gate
- permission ควร resolve จาก policy และ Worker role/capability
- unknown action อาจ `ask`, แต่ auto/coordinator mode สามารถเปลี่ยน reviewer ได้โดยไม่ลบ deny rules

แหล่งข้อมูล:

- <https://opencode.ai/docs/permissions/>
- <https://opencode.ai/docs/agents/>
- <https://opencode.ai/v2/docs/permissions/>

## Claude Code

### Permission modes

Claude Code มีหลาย operating modes แทน policy เดียว:

| Mode | ผลโดยสรุป |
|---|---|
| `default` / Manual | อ่านได้ งานแก้ไขและคำสั่งสำคัญถามผู้ใช้ |
| `acceptEdits` | อนุญาต file edits และ filesystem commands ทั่วไปใน working scope |
| `plan` | สำรวจแบบ read-only ก่อนอนุมัติแผน |
| `auto` | classifier model แยกต่างหากประเมิน action แทนผู้ใช้ |
| `dontAsk` | action ที่ไม่ได้ pre-approve ถูก deny อัตโนมัติ |
| `bypassPermissions` | ข้าม permission checks; เหมาะเฉพาะ isolation ภายนอก |

Explicit deny/ask rules ยังคงสร้าง hard boundary หรือ human checkpoint ได้ โดย permission mode เป็น baseline ไม่ใช่การลบ policy

### Auto mode

Auto mode ใช้ classifier แยกจาก main agent เพื่อตรวจว่า action:

- อยู่ในคำขอและ trust boundary ที่ผู้ใช้กำหนดหรือไม่
- มีลักษณะ destructive, credential probing หรือ data exfiltration หรือไม่
- กำลังส่งข้อมูลไป infrastructure ที่ไม่รู้จักหรือไม่
- พยายามลดทอน security controls หรือหลบ oversight หรือไม่

Action ปกติใน working directory ทำต่อได้ ส่วน action ที่ classifier block จะถูก deny หรือ fallback ไป human prompt ตาม mode และความสามารถของ session มี circuit breaker เมื่อถูกปฏิเสธซ้ำเพื่อไม่ให้ agent วนหาทางข้าม policy

### Subagents และ Agent Teams

- Claude เลือกใช้ subagent อัตโนมัติได้
- subagent มี `permissionMode`, tool allowlist/denylist, model, effort, turn limit และ worktree isolation ของตัวเอง
- ถ้าไม่กำหนด permission mode จะสืบทอดจาก parent
- `AskUserQuestion` ถูกถอดออกจาก tool pool ของ subagent
- Agent Teams มี lead, teammates, shared task list และ mailbox
- เมื่อ Agent Teams เปิดอยู่ lead สร้าง teammate ผ่าน Agent tool โดยไม่ถามผู้ใช้ยืนยันทุกตัว
- lead แจกงาน, teammates self-claim งานที่ไม่ blocked, ส่งข้อความหากัน และ lead สังเคราะห์ผล
- background agents ทำงานต่อได้โดยไม่ต้องมี terminal เปิด และมีสถานะ Needs input เฉพาะกรณีที่ต้องการคนจริง ๆ

### บทเรียนสำหรับ `my-pi`

- Coordinator ควรเป็น control loop ที่ได้รับ mandate ไม่ใช่ tool caller ที่หยุดหลัง spawn
- Worker ควรไม่มี generic `ask user`; ควรส่ง unresolved decisions กลับ Coordinator
- permission classifier/reviewer สามารถลด prompt fatigue โดยยังคง hard denies
- shared task state, dependency และ completion notification ลดการ polling และการเฝ้า pane

แหล่งข้อมูล:

- <https://code.claude.com/docs/en/permission-modes>
- <https://code.claude.com/docs/en/permissions>
- <https://code.claude.com/docs/en/subagents>
- <https://code.claude.com/docs/en/agent-teams>
- <https://code.claude.com/docs/en/agent-view>

## Codex CLI

### แยก sandbox ออกจาก approval

Codex แยกสองแกน:

1. sandbox/permission profile กำหนดว่า process ทำอะไรได้จริง
2. approval policy กำหนดว่าใครตัดสินเมื่อ action ต้องข้าม boundary

ตัวอย่าง Auto preset คือ `workspace-write` + `on-request`:

- อ่าน/แก้ไฟล์/รันคำสั่งภายใน workspace ได้เอง
- network ปิดโดย default
- นอก writable roots หรือ network จึงสร้าง approval request

`--ask-for-approval never` ปิด prompt ได้โดยยังคง sandbox อยู่ ต่างจาก `danger-full-access` หรือ `--dangerously-bypass-approvals-and-sandbox` ที่ขยาย trust boundary จริง

Codex รุ่นที่ตรวจยังมี permission profiles เช่น `:read-only`, `:workspace`, `:danger-full-access` และ custom filesystem/network rules ซึ่งแยก deny สำหรับ `.env` หรือ protected paths ออกจาก write permission กว้างของ workspace ได้

### Auto-review / Approve for me

CLI ที่ติดตั้งมี:

```text
--approve-for-me  Route approval requests through automatic review using the workspace-write sandbox
```

Config ที่เทียบเท่าคือ:

```toml
approval_policy = "on-request"
approvals_reviewer = "auto_review"
```

flow คือ:

1. main agent ทำงานใน sandbox เดิม
2. เมื่อจะข้าม boundary จะสร้าง approval request
3. reviewer agent แยกต่างหากประเมินแทนผู้ใช้
4. approve แล้วงานเดินต่อ หรือ deny พร้อมเหตุผลและสั่งให้ main agent หาทางที่ปลอดภัยกว่า
5. ถ้าไม่มีทางปลอดภัยหรือเป็น action ที่ policy สงวนไว้ จึงหยุดและถามผู้ใช้

Auto-review เปลี่ยน reviewer แต่ **ไม่เพิ่ม writable roots, network หรือ filesystem access** และมี rejection circuit breaker เพื่อหยุดการวนหลบ policy

### Subagents

- Codex เปิด subagent workflows เป็นค่าเริ่มต้นในรุ่นปัจจุบัน
- main agent ทำ orchestration: spawn, route follow-up, wait, collect และ consolidate
- subagent สืบทอด sandbox และ permission mode ของ parent
- custom agent override เป็น read-only หรือกำหนด model/reasoning effort เฉพาะงานได้
- เอกสารแนะนำ parallel สำหรับ read-heavy lanes และระวัง write-heavy conflicts

### บทเรียนสำหรับ `my-pi`

- รูปแบบที่ตรงกับความต้องการมากที่สุดคือ **reviewer swap under the same sandbox**
- routine work ควรอยู่ใน boundary จึงไม่เกิด approval request ตั้งแต่แรก
- Coordinator/reviewer ควรตัดสิน escalation ที่ policy อนุญาต ส่วน hard boundary ยัง enforce แยกต่างหาก
- ถ้ามี approval noise มากเกินไป ควรแก้ boundary/profile ให้ครอบคลุม safe workflow ไม่ใช่สอน reviewer ให้กดผ่านทุกอย่าง

แหล่งข้อมูล:

- <https://developers.openai.com/codex/agent-approvals-security>
- <https://developers.openai.com/codex/concepts/sandboxing/auto-review>
- <https://developers.openai.com/codex/permissions>
- <https://developers.openai.com/codex/subagents>
- <https://developers.openai.com/codex/config-reference>

## Hermes Agent dangerous-command security

ผู้ใช้ส่ง implementation และ security guideมาให้พิจารณาก่อนเริ่ม agent-teams production wiring ตรวจจาก `main` snapshot commit `b1ff8722a53ee223485ac9804945acf07ef5c601` วันที่ 2026-08-29; repository ระบุ MIT license

### โครงสร้างที่มีประโยชน์

`tools/approval.py` แยกการตัดสิน commandเป็นหลายชั้น:

1. **Hardline floor** — block catastrophic operationsก่อน yolo/off/allowlist และไม่มี override
2. **User deny rules** — deny globที่มาก่อน bypass settings
3. **Dangerous patterns** — recoverable/destructive actionsที่ส่งเข้า smart/manual approval
4. **Permanent/session approvals** — reuse approvalตาม scope
5. **Combined guard** — รวม Tirith + pattern findingsเป็น decisionเดียว เพื่อลด replayที่ผ่าน guardหนึ่งแต่ข้ามอีก guardหนึ่ง

รายละเอียด implementationที่ควรนำมาเป็น requirements/test ideas:

- freeze process-level bypassตอน module import เพื่อไม่ให้ skillเปลี่ยน environmentกลาง sessionแล้วข้าม policy
- ใช้ context-local identity แยก session/turn/tool-call แทน process-global environmentใน concurrent execution
- normalize ANSI, null bytes, Unicode, shell wrappers, quoted text, command substitutions และ command positionsก่อน classify
- parser complexity/sizeเกิน budgetให้ blockแบบ fail-closed
- protected policy/config filesต้องถูกปิดทั้ง direct file toolsและ terminal routes มิฉะนั้นเป็น “unpaired door”
- Dockerที่ bind-mount host pathไม่ถือว่า isolated: sourceใช้ `has_host_access` เพื่อไม่ skip guard เพราะ `rm -rf /workspace` ยังทำลาย host worktreeได้
- timeout/no-human branchesต้องมี explicit outcome และ audit identity; lifecycle contextห้ามอนุมานจาก ambient environmentที่เปลี่ยนข้าม threadได้
- observer payload redactก่อนส่ง plugin และ correlationต้องผูกกับ real session/turn/tool call

### สิ่งที่ไม่ควร copy ตามตรง

- moduleมีขนาดและ shell edge casesสูงมาก จึงไม่ควรคัดลอก regex/implementationทั้งก้อนเข้า `my-pi`; เหมาะเป็น requirementsและ adversarial test corpusมากกว่า
- Hermesระบุเองว่า deny/pattern layerเป็น guardrailสำหรับ honest-but-wrong agent ไม่ใช่ sandboxสำหรับ adversarial process ตรงกับการตัดสินเดิมว่า My Pi guardrailห้ามอ้างเป็น enforceable boundary
- dangerous-command pathใน sourceปัจจุบันยังรักษา historical non-interactive auto-approveบาง branch ซึ่งไม่ตรงกับ delegated Worker ของ My Pi; unknown/headless Workerต้อง fail closedแทน
- `smart` auxiliary LLMอาจช่วยจัดลำดับ REVIEW แต่ห้ามเป็น authorityที่ชนะ deterministic deny, mandate ceiling หรือ sandbox
- permanent command allowlist เช่น command name/globกว้างเกินไปสำหรับ delegated autonomy; My Piต้องใช้ scoped capabilityที่ bind worker, mandate, path/resource, operation, expiry และ policy version
- Tirith default `fail_open: true` และ first-use auto-installไม่ผ่าน initial profile contractของ My Pi หากประเมินภายหลังต้อง pin binary/checksum/provenance, pre-provision และ fail closed
- security guideกับ sourceมี driftอย่างน้อยหนึ่งจุด: guideยก pipe remote URLเข้า shellไว้ใน hardline table แต่ source commentและ patternsจัด `curl|sh` เป็น recoverable `DANGEROUS_PATTERNS`; production policyต้องอ้าง executable tests/source revision ไม่อ้างตารางเอกสารอย่างเดียว

### ผลต่อ `my-pi`

`extensions/guardrails.ts` ปัจจุบันเน้น secret reads, external writes/uploads และ path-aware mutations ยังไม่มี command-risk taxonomyสำหรับ `rm -rf .`, `git reset --hard`, `git clean -fdx`, fork bomb, device writes, shutdown หรือ policy-file tampering

ก่อน wire patched agent-teams production profile ต้องเพิ่ม command-policy seamที่:

```text
normalize + bounded parse
          │
          ▼
collect findings once
          │
          ├─ hard invariant / mandate deny ───────────────→ DENY
          ├─ human-only external/irreversible boundary ──→ HUMAN
          ├─ bounded destructive workspace operation ────→ REVIEW
          └─ safe operation inside exact profile ─────────→ ALLOW
```

Initial Pi Workerไม่มี human prompt REVIEWต้องกลับ Coordinatorพร้อม command digestและ structured findings; Coordinatorอนุญาตได้เฉพาะ capabilityที่ mandateให้ไว้ และ decision tokenต้อง bind command digest, Worker/session, profile/policy version, resource scope และ expiry ห้ามใช้ generic replay/force flag

Containerช่วยลด blast radiusแต่ worktreeเป็น host bind mount จึงยังต้อง block worktree wipe/history destructionตาม role การลบ generated pathsควรอนุญาตแบบ canonical path + task-scoped rule ไม่ใช่ allow `rm` ทั้ง command family

แหล่งข้อมูล:

- [`tools/approval.py` at `b1ff8722`](https://github.com/NousResearch/hermes-agent/blob/b1ff8722a53ee223485ac9804945acf07ef5c601/tools/approval.py)
- [Security guide at `b1ff8722`](https://github.com/NousResearch/hermes-agent/blob/b1ff8722a53ee223485ac9804945acf07ef5c601/website/docs/user-guide/security.md)
- [MIT license at `b1ff8722`](https://github.com/NousResearch/hermes-agent/blob/b1ff8722a53ee223485ac9804945acf07ef5c601/LICENSE)

## Pattern ร่วมที่พบ

ทั้งสามระบบใช้โครงสร้างใกล้เคียงกัน:

```text
Enforceable boundary
  ├─ known-safe action       → ทำต่ออัตโนมัติ
  ├─ reviewable escalation  → policy/classifier/reviewer ตัดสิน
  └─ hard boundary          → deny หรือ human escalation
```

ต่างจาก `my-pi` ปัจจุบัน:

```text
Best-effort static path analysis
  └─ พบสิ่งที่น่าสงสัย → เปิด dialog ให้ผู้ใช้
```

สิ่งที่ขาดคือ:

- mandate/autonomy scope ระดับ run
- policy resolver ที่ให้ผล `allow | review | deny | human`
- Coordinator เป็น reviewer ของ Worker
- enforceable sandbox หรือ capability profile ต่อ Worker
- orchestration control loop ที่เดินต่อหลัง spawn/collect/correction
- resource/budget limits และ audit trail ที่ตรวจย้อนหลังได้

## Direction ที่ตกลงให้ศึกษาต่อ

### 1. Bounded mandate ต่อหนึ่งงาน

ผู้ใช้ควรตกลงครั้งเดียวอย่างน้อย:

- goal และ Definition of Done
- write roots / worktree policy
- network และ secret policy
- harness/model/cost/concurrency ceilings
- action ที่ Coordinator ตัดสินเองได้
- action ที่ต้อง human escalation เช่น scope expansion, architecture change, deploy/push, irreversible external mutation หรือ security tradeoff

### 2. Permission outcomes สี่ระดับ

```text
ALLOW   — ทำได้ทันทีใน boundary
REVIEW  — ส่งให้ Coordinator หรือ automatic reviewer
DENY    — policy ห้ามเด็ดขาด
HUMAN   — เกิน mandate ต้องให้ผู้ใช้ตัดสิน
```

`ask user` ไม่ควรเป็น default outcome ของ Worker

### 3. Coordinator เป็น reviewer และ owner ของ execution

Coordinator ควรมีอำนาจภายใน mandate ที่จะ:

- spawn/stop/reuse Workers
- assign/correct/reassign งาน
- อนุมัติ routine escalations ของ Worker
- ปฏิเสธและสั่งหาทางที่ปลอดภัยกว่า
- เลือก assurance/reviewer ตามความเสี่ยง
- ตรวจ artifact และ verification ก่อนรับผล

### 4. Sandbox/capability boundary ต่อ Worker

- writing Worker ใช้ isolated worktree
- read-only role ไม่มี mutation capability
- secrets เป็น hard deny โดย default
- network เป็น deny/allowlist โดย default
- harness-native sandbox/permission flags ถูกกำหนดตอน spawn แบบ atomic
- Pi guardrail เป็น policy/routing layer ไม่อ้างว่าเป็น security sandbox

### 5. Preview เป็น observability ไม่ใช่ mandatory gate

Preview ควรบันทึก:

- เหตุผลที่สร้าง Worker
- harness/model/effort
- task scope และ ownership
- permission profile
- worktree/branch
- budget และ expected artifacts

ผู้ใช้ตรวจย้อนหลังหรือเปิด manual mode ได้ แต่ Coordinator mode ไม่ควรหยุดรอ approval ถ้าทุกอย่างอยู่ใน mandate

## สิ่งที่ไม่ควรทำ

- ไม่ให้ Coordinator auto-click dialog เดิมโดยไม่มี policy หรือ sandbox
- ไม่ใช้ Worker self-report เป็นหลักฐานว่า action ปลอดภัยหรืองานเสร็จ
- ไม่ปิด guardrail ทั้งหมดเพื่อแก้ prompt fatigue
- ไม่ให้ reviewer instructions แทน enforceable filesystem/network boundary
- ไม่เปิด `danger-full-access` ให้ Worker ที่ไม่อยู่ใน container/VM/OS sandbox
- ไม่ผูกการรื้อรอบนี้กับ Plannotator หรือ `ask user` ซึ่งผู้ใช้ให้พักไว้ก่อน

## Open questions สำหรับการวางแผน implementation

1. mandate ควรอยู่ใน Pi session state อย่างเดียวหรือมี project/user policy config เพิ่มเติม
2. Coordinator review จะใช้ deterministic policy ก่อน แล้วใช้ model reviewerเฉพาะกรณี ambiguous หรือไม่
3. จะ normalize native permission/sandbox ของ Pi, Codex, Claude และ OpenCode เป็น capability profile กลางระดับใดโดยไม่ซ่อนข้อแตกต่าง
4. action ใดเป็น hard deny ที่ Coordinator ไม่มีสิทธิ์ override
5. human escalation จะส่งผ่านช่องทางใดโดยไม่ผูกกับ `ask user` รอบนี้
6. control loop จะเดินต่ออย่างไรเมื่อ Worker blocked, denied, timeout, failed หรือส่ง artifact ไม่ครบ
7. concurrency, budget และ correction limits ควรบังคับที่ extension หรือ workflow runtime
8. implementation ปัจจุบันส่วนใดควร migrate, deprecate หรือเก็บเป็น `manual` compatibility mode

## Next step

ดำเนินการต่อผ่าน [ปรับ Pi/Herdr Coordinator เป็น Delegated Autonomy](../plans/delegated-autonomy-coordinator.md) ซึ่งแยก policy engine, harness profiles, sandbox boundaries, Coordinator control loop, migration และ verification matrix ไว้แล้ว โดยเริ่มจาก disposable probes ก่อนเปลี่ยน production behavior
