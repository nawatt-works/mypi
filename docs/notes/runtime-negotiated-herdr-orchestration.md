# Runtime-negotiated Orchestration ผ่าน Pi และ Herdr

> **Status:** รอตัดสินใจพัฒนา<br>
> **Created:** 2026-08-23 22:27<br>
> **Updated:** 2026-08-23 22:27<br>
> **Purpose:** บันทึกข้อกำหนดและขอบเขตของ Pi Coordinator ที่ใช้ Herdr ควบคุม AI harness workers โดยกำหนดทีม ขั้นตอน และ artifact handoff ระหว่างสนทนา

## สรุปแนวคิด

ใช้ Pi เป็น Orchestrator/Coordinator ที่ผู้ใช้ร่วมวางแผนด้วย ส่วน Herdr เป็น runtime สำหรับสร้างและควบคุม process, pane, agent session และ Git worktree ของ AI harness เช่น Pi, Codex CLI และ Claude Code

ระบบต้องไม่กำหนดรายชื่อ Worker, บทบาท, workflow หรือ output schema ตายตัวใน extension, skill หรือไฟล์ config ผู้ใช้เป็นผู้มีอำนาจเลือก Worker และอนุมัติทิศทาง ขณะที่ Orchestrator อาจเสนอทีม ลำดับงาน และ artifact ที่เหมาะกับโจทย์ระหว่างสนทนา

Workflow จึงเกิดขึ้นตอน runtime และเปลี่ยนได้ตามหลักฐานที่ Workers สร้างขึ้น ไม่จำกัดอยู่ที่ `Implement → Audit → Fix` ตัวอย่างเช่น Orchestrator อาจเริ่มจาก Researcher แล้วจึงพิจารณาว่าต้องใช้ Planner, Developer, Tester, Auditor, Security Reviewer หรือ Worker แบบอื่นต่อหรือไม่

## Working decisions

- ผู้ใช้กำหนดหรืออนุมัติว่าจะใช้ Worker ใดและ AI harness ใด
- Orchestrator อาจเสนอ Worker และลำดับงานจากบริบท แต่ไม่ถือว่า role ใดต้องมีเสมอ
- extension และ skill ต้องใช้ primitive กลาง ไม่ hardcode ความหมายของ `developer`, `auditor`, `researcher` หรือ role อื่น
- ไฟล์ config เก็บเฉพาะ runtime defaults, policy, limits และ capability ที่อนุญาต ไม่เก็บ workflow สำเร็จรูป
- Worker, task, input, expected output และผู้รับช่วงต่อจะตกลงกันเป็นรายกรณีระหว่างสนทนา
- Artifact แต่ละชนิดใช้ path, schema และ lifecycle ของผู้ใช้, workflow, skill หรือ harness ที่เป็นเจ้าของ ห้ามบังคับย้ายเข้า directory กลาง
- ไม่มี result contract กลางสำหรับ Worker ทุกตัว Orchestrator กำหนด task-local handoff contract ตามลักษณะงาน
- Orchestrator ต้องตรวจ artifact, diff หรือ verification จริง ไม่ถือข้อความสรุปของ Worker เป็นหลักฐานเพียงอย่างเดียว
- ยังไม่เริ่ม implementation จนกว่าผู้ใช้จะตัดสินใจ

## ขอบเขตของไฟล์ config

Config มีไว้บอกว่า Coordinator เรียก Herdr อย่างไร ใช้ harness ใดได้ และต้องหยุดขออนุมัติเมื่อใด ตัวอย่างแนวคิดต่อไปนี้ยังไม่ใช่ schema ที่อนุมัติแล้ว:

```yaml
version: 1

runtime:
  driver: herdr
  allowed_harnesses:
    - pi
    - codex
    - claude

defaults:
  startup_timeout_ms: 30000
  task_timeout_ms: 600000
  keep_user_focus: true

worktrees:
  enabled: true
  isolation: per-worker

limits:
  max_concurrent_workers: 3
  max_active_worktrees: 5

approvals:
  require_user_for:
    - destructive-operation
    - architecture-change
    - scope-expansion
    - security-tradeoff
```

Config ต้องไม่บังคับให้มี Worker ชื่อใด ไม่กำหนดลำดับ step และไม่กำหนด path กลางสำหรับ artifacts ตำแหน่ง config, schema จริง, precedence ระหว่าง user/project config และวิธี validate ยังเป็นเรื่องที่ต้องออกแบบก่อน implementation

ห้ามเก็บ token, credential หรือ secret value ลง config หากต้องอ้าง credential ให้บันทึกเพียงชื่อ environment variable หรือกลไก secret owner ที่ระบบรองรับ

## Runtime planning

ก่อนสร้าง Worker ผู้ใช้กับ Orchestrator คุยกันเพื่อกำหนดเป้าหมาย ข้อจำกัด และงานถัดไป Orchestrator อาจเก็บ working state ไว้ใน Pi session หากเป็นเพียง state สำหรับทำงานต่อ หรือใช้ workspace plan เฉพาะเมื่อผู้ใช้หรือ workflow ต้องการ artifact และระบุ path/format ชัดเจน

การสร้างแผน runtime ไม่ทำให้แผนนั้นกลายเป็น config และไม่ทำให้ artifact ถูกย้ายหรือแปลง schema เพื่อให้ Coordinator อ่านได้

ตัวอย่างลำดับที่เกิดขึ้นระหว่างสนทนา:

```text
ผู้ใช้ ↔ Pi Orchestrator
            │
            ├─ ตกลงให้มี Researcher ผ่าน Claude Code
            │   └─ Herdr สร้าง session/worktree และส่ง task
            │       └─ Worker เขียนรายงานตาม path ที่ตกลงใน task
            │
            ├─ Orchestrator ตรวจและอ่านรายงาน
            │
            ├─ ผู้ใช้อนุมัติ Developer ผ่าน Codex CLI
            │   └─ Orchestrator บอกให้อ่านรายงานเดิมและ implement
            │       └─ Worker ส่งมอบ branch/commit/diff และหลักฐานทดสอบ
            │
            └─ Orchestrator ประเมินหลักฐานแล้วจึงเสนอขั้นถัดไป
```

Orchestrator สามารถเพิ่ม ลด เปลี่ยน หรือย้อนกลับไปหา Worker เดิมได้ตามผลลัพธ์ โดยต้องเคารพ approval policy และจำนวนรอบสูงสุดที่ตกลงไว้

## Task-local handoff contract

แต่ละครั้งที่มอบหมายงาน Orchestrator ต้องระบุเฉพาะสิ่งที่งานนั้นต้องใช้ ไม่บังคับ schema เดียวกับทุก Worker อย่างน้อยควรสื่อสาร:

- เป้าหมายและขอบเขตของงาน
- input artifacts, branch, commit, source path หรือข้อสรุปที่ต้องอ่าน
- ข้อจำกัดและสิ่งที่ห้ามทำ
- expected output สำหรับงานนั้น รวมถึง path เมื่อจำเป็น
- verification หรือหลักฐานที่ต้องแนบ
- เงื่อนไขที่ต้องหยุดถามแทนการเดา
- วิธีแจ้ง Orchestrator เมื่อเสร็จ ติดขัด หรือต้องการข้อมูลเพิ่ม

ตัวอย่างงานวิจัย:

```text
ศึกษาแนวทาง authentication จาก requirements และ source ปัจจุบัน
บันทึกรายงานฉบับเต็มใน path ที่ระบุสำหรับงานนี้
รายงานทางเลือก หลักฐาน ความเสี่ยง และคำถามที่ยังตอบไม่ได้
ห้ามแก้ implementation
เมื่อเสร็จให้แจ้ง path และสรุปสั้น ๆ กลับมา
```

ตัวอย่างงานถัดไป:

```text
อ่านรายงานวิจัยที่ระบุและ implement เฉพาะ scope ที่อนุมัติ
ส่งมอบผ่าน branch/commit ตาม worktree contract
รัน verification ที่กำหนดและบันทึกผลใน artifact ที่ตกลงสำหรับงานนี้
หากต้องเปลี่ยน architecture หรือ scope ให้หยุดและแจ้ง Orchestrator
```

## Artifact-mediated coordination

Artifact เป็นตัวกลางหลักในการส่งต่องานระหว่าง Workers แต่ชนิดและรูปแบบขึ้นกับงาน เช่น:

| งาน | Artifact ที่อาจใช้ |
|---|---|
| Research | Markdown report, source list, benchmark output |
| Planning | specification, decision record, dependency map |
| Implementation | Git branch, commit, diff, source code |
| Testing | test log, reproduction fixture, verification report |
| Audit | findings report, annotated diff, risk assessment |
| Design | diagram, mockup, schema, ADR |

Orchestrator ต้องส่ง exact artifact reference ให้ Worker ถัดไป เช่น path, branch หรือ commit และบอกว่าจะอ่านเพื่ออะไร ห้ามคาดเดาตำแหน่งจากชื่อ folder ทั่วไป

เมื่อ Worker รายงานว่าเสร็จ Orchestrator ควร:

1. ตรวจว่า Worker อยู่ในสถานะพร้อมส่งมอบ ไม่ใช่ `blocked` หรือยังทำงานอยู่
2. ตรวจว่า artifact ที่ตกลงมีอยู่และเข้าถึงได้
3. อ่านเนื้อหา ตรวจ Git diff หรือรัน verification ที่เหมาะกับความเสี่ยง
4. ประเมินว่า artifact เพียงพอ ถูกต้อง และอยู่ใน scope หรือไม่
5. เลือกว่าจะส่งกลับ Worker เดิม ส่งต่อ Worker ใหม่ ถามผู้ใช้ หรือจบงาน
6. ส่ง exact inputs และ task-local handoff contract ให้ผู้รับช่วงต่อ

สถานะ lifecycle จาก Herdr เช่น `working`, `blocked`, `idle` และ `done` ใช้ควบคุม process ได้ แต่ไม่แทนการตรวจคุณภาพของ artifact

## ขอบเขตของ Coordinator implementation

Coordinator layer ที่จะพัฒนาภายหลังควรมี primitive อย่างน้อย:

- ตรวจและอ่าน runtime configuration
- ตรวจว่า Pi อยู่ใน Herdr-managed pane ก่อนใช้ control commands
- สร้าง pane, agent session และ worktree ตามที่ตกลง
- เริ่ม AI harness ที่ผู้ใช้เลือกผ่าน `herdr agent start`
- ส่ง task และติดตาม lifecycle ผ่าน `prompt`, `wait`, `get` และ `read`
- ส่งข้อความกลับ Worker session เดิมเมื่อมีงานต่อเนื่อง
- เก็บ mapping ระหว่าง runtime task, Herdr agent, pane, worktree และ artifact references
- ตรวจ limits, approval gates, timeout และ blocked state
- ให้ Orchestrator อ่านและประเมิน artifact ก่อนตัดสินใจขั้นถัดไป

ระบบไม่ควรสร้าง autonomous workflow engine ที่ตัดสินใจทุกอย่างแทนผู้ใช้ และ Herdr ไม่ใช่ OS security boundary หาก Workers มี trust level ต่างกันต้องใช้ container, VM หรือ OS user ที่แยกสิทธิ์เพิ่มเติม

## สถานะระบบปัจจุบัน

- โปรเจกต์เลือก Pi เป็นแกนหลักและใช้ external orchestration ผ่าน Herdr/worktrees
- `extensions/herdr-integration.ts` ติดตั้งและตรวจ official Pi lifecycle reporter รวมทั้ง bridge สถานะรอผู้ใช้ไปยัง Herdr
- Herdr ที่ตรวจระหว่างการสนทนาเป็นเวอร์ชัน `0.8.0` และรองรับ `pi`, `codex`, `claude` รวมถึง harness อื่นผ่าน `agent start`
- Official Pi integration อยู่ในสถานะ `current (v8)` ขณะตรวจ
- Codex และ Claude lifecycle integrations ยังไม่ได้ติดตั้งขณะตรวจ
- extension ปัจจุบันยังไม่มี Coordinator logic, runtime task model, artifact handoff หรือ worker-control loop

## Non-goals สำหรับรุ่นแรก

- ไม่ hardcode รายชื่อหรือจำนวน Worker
- ไม่ hardcode workflow graph หรือ role semantics
- ไม่บังคับ result schema กลาง
- ไม่สร้าง directory กลางสำหรับ artifact ทุกชนิด
- ไม่ย้ายหรือทำสำเนา artifact ของ harness อื่นเพื่อให้เข้ากับ convention ของ `my-pi`
- ไม่ถือ terminal transcript เป็น source of truth เมื่อมี artifact หรือ Git state ที่ตรวจได้
- ไม่ทำ distributed workflow engine ที่รับประกัน durable state machine แบบ Temporal
- ไม่ใช้ Herdr เป็น security sandbox

## เรื่องที่ต้องตัดสินใจก่อนเริ่มพัฒนา

1. Config เป็นระดับ user, project หรือรองรับทั้งสองระดับ และ precedence เป็นอย่างไร
2. ตำแหน่งและชื่อ config ที่ extension เป็นเจ้าของควรเป็นอะไร
3. Runtime task/worker mapping ต้องรอดเฉพาะ Pi session หรือรอด process restart ด้วย
4. ผู้ใช้ต้องอนุมัติทุก Worker ก่อน spawn หรือสามารถให้ autonomy เป็นรายงานได้
5. Artifact references จะเก็บเป็น session state, workspace plan pointer หรือกลไกเฉพาะของ Coordinator
6. Worktree lifecycle ใครเป็นผู้สร้าง ปิด และลบ รวมถึงต้องยืนยันจุดใด
7. รองรับ parallel workers และ fan-in ตั้งแต่ MVP หรือเริ่มจากงานลำดับเดียวก่อน
8. จะติดตั้ง lifecycle integrations ของ Codex/Claude อัตโนมัติหลังยืนยัน หรือให้ผู้ใช้จัดการเอง
9. ขอบเขตคำสั่งและ tools ของ Coordinator ควรเป็น Pi extension, Pi skill หรือใช้ทั้งสองชั้น
10. ต้องมี dry-run/preview ระดับใดก่อนสร้าง pane, worktree และ agent process

## จุดเริ่มต้นเมื่ออนุมัติให้พัฒนา

เริ่มจาก design/validation ก่อน production behavior:

1. ตกลง config ownership, path และ minimal schema
2. กำหนด runtime task model ที่ไม่ผูกกับ role หรือ workflow
3. กำหนด task-local handoff prompt และ artifact-reference model
4. ทำ disposable probe ให้ Pi ใต้ Herdr สร้าง Worker หนึ่งตัว ส่งงาน เขียน artifact และอ่านกลับ
5. ทดสอบ `done`, `blocked`, timeout, missing artifact และ Worker exit
6. สรุปผลแล้วตัดสิน scope ของ MVP ก่อนสร้าง Coordinator extension เต็มรูปแบบ

## Change log

- 2026-08-23 22:27 — บันทึกข้อกำหนด runtime-negotiated orchestration, dynamic Workers และ artifact-mediated handoff โดยพัก implementation ไว้รอผู้ใช้ตัดสินใจ
