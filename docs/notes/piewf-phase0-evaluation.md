# Phase 0 evaluation: `pi-extensible-workflows` 5.8.0 adoption gate

วันที่ประเมิน: 2026-08-28  
ผู้ประเมิน: Pi worker (`phase0/piewf-evaluation`)  
ขอบเขต: read-heavy; เขียนเฉพาะไฟล์นี้

## Executive decision

**ผลตัดสินตอนนี้: NO-GO สำหรับการรับ `pi-extensible-workflows` เข้าเป็น backend ของ delegated-autonomy coordinator ใน Phase 6 ตอนนี้**

เหตุผลหลัก:
1. **license artifact ยังไม่พอ**: metadata/README ระบุ MIT แต่ source checkout และ tarball evidence ที่ตรวจไม่มี `LICENSE` file
2. **exact isolated install/pin ยังไม่นิ่ง**: `pi install npm:...@5.8.0` ใน temp profile ที่ทดลองติดตั้งจริงได้ version drift เป็น `5.9.0` สำหรับ core/CLI
3. **isolated doctor/load path ที่ลองจริงยังไม่ยืนยัน core surface**: `piewf doctor --json` รันได้ แต่รายงาน `functions: []`, `roles: []`, และไม่มี core workflow extension surface ที่คาด
4. **API churn สูง**: ช่วง `5.5.0` → `5.9.0` ออกถี่และมี breaking changes หลายรอบในช่วงไม่กี่วัน
5. **dual-source-of-truth risk สูง**: ถ้ารับเข้ามาโดยยังไม่ตัด ownership ของ run registry/audit/worker lifecycle ให้เหลือแหล่งเดียว จะชนกับ registry/control loop ของ coordinator แผนปัจจุบัน

**สิ่งที่ยังเป็นบวก**: source/test evidence ของ `5.8.0` แสดงว่า feature หลักที่ต้องการมีจริงและมี coverage ได้แก่ `reviewLoop`, standalone subagents, worktree, budget/resume, และ `@piewf/herdr` fully-inspectable mode

## แหล่งที่อ่าน

- Plan: `docs/plans/delegated-autonomy-coordinator.md` (อ่านครบ โดยเฉพาะ Phase 0 และ Phase 6)
- Source checkout: `/private/tmp/pi-github-repos/6b91ca6e3e3f04824896ae46ef87017caac368f0b8119d1ea7d1ad1d5abb6662`
- Files สำคัญใน source:
  - `README.md`
  - `CHANGELOG.md`
  - `packages/core/package.json`
  - `packages/core/README.md`
  - `packages/core/subagents/README.md`
  - `packages/core/starter/review-loop.ts`
  - `packages/cli/src/doctor.ts`
  - `packages/extensions/herdr/README.md`
  - `packages/extensions/herdr/index.ts`

## Environment ที่สังเกตได้

```text
pi 0.84.3
node v24.15.0
npm 11.12.1
herdr 0.8.0
source checkout HEAD ecadda08c8b6466d7acc66f4ec8507b56dd2fbf4
```

คำสั่ง:

```sh
pi --version
node --version
npm --version
herdr --version
cd /private/tmp/pi-github-repos/6b91ca6e3e3f04824896ae46ef87017caac368f0b8119d1ea7d1ad1d5abb6662
git rev-parse HEAD
git log --oneline -1
```

## 1) License evidence

### Observed evidence

1. source checkout ที่ให้มาไม่มีไฟล์ license:

```sh
find /private/tmp/pi-github-repos/6b91ca6e3e3f04824896ae46ef87017caac368f0b8119d1ea7d1ad1d5abb6662 -maxdepth 2 \( -iname 'LICENSE' -o -iname 'LICENSE.*' -o -iname 'COPYING' -o -iname 'COPYING.*' \) | sort
```

ผลลัพธ์: **ไม่มี output**

2. metadata ระบุ MIT:
- root `package.json`: `"license": "MIT"`
- `packages/core/package.json`: `"license": "MIT"`
- `packages/cli/package.json`: `"license": "MIT"`
- root `README.md` และ `packages/core/README.md` มี section `License` เป็น `MIT`

3. npm registry metadata ระบุ MIT:

```sh
npm view pi-extensible-workflows@5.8.0 version license dist.integrity dist.shasum --json
npm view @piewf/cli@5.8.0 version license dist.integrity dist.shasum --json
npm view @piewf/herdr@5.8.0 version dist.integrity dist.shasum --json
```

ตัวอย่าง output:

```json
{"version":"5.8.0","license":"MIT",...}
```

4. dry-run tarball ของ core จาก source 5.8.0 ไม่แสดง `LICENSE` ในรายการไฟล์:

```sh
cd /private/tmp/pi-github-repos/6b91ca6e3e3f04824896ae46ef87017caac368f0b8119d1ea7d1ad1d5abb6662
npm pack --workspace=packages/core --dry-run
```

Observed output สำคัญ:

```text
npm notice 📦  pi-extensible-workflows@5.8.0
npm notice Tarball Contents
npm notice 36.0kB CHANGELOG.md
npm notice 2.6kB README.md
...
npm notice 4.2kB package.json
...
npm notice total files: 172
```

### Inference

- ตอนนี้มี **license claim** ใน metadata/README แต่ยังขาด **license artifact ที่ผูกพันได้ชัดใน source/tarball evidence ที่ตรวจตรงนี้**
- สำหรับ dependency adoption ในโค้ด production ของ coordinator ควรถือเป็น **blocker จนกว่าจะมี `LICENSE` file หรือคำชี้แจงที่ bind กับ artifact/release ชัดเจน**

## 2) Exact isolated install/setup

มี 2 เส้นที่ลอง

### A. install จาก npm registry ลง temp `PI_CODING_AGENT_DIR`

คำสั่ง:

```sh
agent_dir=$(mktemp -d)
PI_CODING_AGENT_DIR="$agent_dir" pi install 'npm:pi-extensible-workflows@5.8.0' --no-approve
PI_CODING_AGENT_DIR="$agent_dir" pi install 'npm:@piewf/cli@5.8.0' --no-approve
PI_CODING_AGENT_DIR="$agent_dir" pi install 'npm:@piewf/herdr@5.8.0' --no-approve
PI_CODING_AGENT_DIR="$agent_dir" pi list
```

Observed output สำคัญ:

```text
Installed npm:pi-extensible-workflows@5.8.0
Installed npm:@piewf/cli@5.8.0
Installed npm:@piewf/herdr@5.8.0
```

และ `settings.json` ใน temp profile เป็น:

```json
{
  "packages": [
    "npm:pi-extensible-workflows@5.8.0",
    "npm:@piewf/cli@5.8.0",
    "npm:@piewf/herdr@5.8.0"
  ]
}
```

แต่ package ที่ถูกติดตั้งจริงใน `npm/node_modules` เป็น:

```text
pi-extensible-workflows/package.json: 5.9.0
@piewf/cli/package.json: 5.9.0
@piewf/herdr/package.json: 5.8.0
```

ตรวจด้วย:

```sh
cd "$agent_dir/npm"
npm ls --depth=0 --json
```

Observed output:

```json
{
  "dependencies": {
    "@piewf/cli": {"version":"5.9.0"},
    "@piewf/herdr": {"version":"5.8.0"},
    "pi-extensible-workflows": {"version":"5.9.0"}
  }
}
```

### B. install จาก source checkout `ecadda0` ลง temp `PI_CODING_AGENT_DIR`

คำสั่ง:

```sh
src=/private/tmp/pi-github-repos/6b91ca6e3e3f04824896ae46ef87017caac368f0b8119d1ea7d1ad1d5abb6662
agent_dir=$(mktemp -d)
PI_CODING_AGENT_DIR="$agent_dir" pi install "$src/packages/core" --no-approve
PI_CODING_AGENT_DIR="$agent_dir" pi install "$src/packages/cli" --no-approve
PI_CODING_AGENT_DIR="$agent_dir" pi install "$src/packages/extensions/herdr" --no-approve
PI_CODING_AGENT_DIR="$agent_dir" pi list
```

Observed output:
- `settings.json` เก็บเป็น local package paths ไปที่ source checkout
- ไม่มี `npm/node_modules` ถูก materialize ใน temp agent dir จาก path install เส้นนี้

### Inference

- ถ้าต้องการ **pin exact 5.8.0 แบบ reproducible ตอนนี้** เส้น npm install ผ่าน `pi install npm:...@5.8.0` ที่ลอง **ยังไม่น่าเชื่อถือ** เพราะ observed drift เป็น `5.9.0`
- เส้น local-path install ช่วยผูกกับ source checkout `ecadda0` ได้ แต่ไม่ใช่ proof ว่า release install ผ่าน normal npm path จะนิ่ง
- adoption gate ควรต้องมี **install recipe เดียวที่ pin ได้จริงและตรวจซ้ำได้** ก่อน

## 3) `piewf doctor`

### Observed evidence

#### 3.1 รัน bin จาก temp npm install ตรง ๆ ครั้งแรกไม่ผ่าน

คำสั่ง:

```sh
PI_CODING_AGENT_DIR="$agent_dir" "$agent_dir/npm/node_modules/.bin/piewf" doctor --json
```

Observed output สำคัญ:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@earendil-works/pi-coding-agent' imported from .../@piewf/cli/dist/src/cli.js
```

จากนั้นจึงต้อง symlink peer packages จาก Pi installation หลักเข้ามาใน temp `npm/node_modules` เพื่อให้ bin รันได้

#### 3.2 doctor หลังแก้ peer resolution แล้วรันได้ แต่ไม่เห็น core workflow surface ที่คาด

คำสั่งที่รันได้:

```sh
PI_CODING_AGENT_DIR="$agent_dir" "$agent_dir/npm/node_modules/.bin/piewf" doctor --json
```

Observed fields สำคัญ:

```json
{
  "activeTools": ["bash", "edit", "read", "write"],
  "piExtensions": [".../@piewf/herdr/dist/index.js"],
  "piSkills": ["continuity-memory", "okf-bundle", "skill-creator"],
  "roles": [],
  "functions": [],
  "diagnostics": []
}
```

#### 3.3 source-based CLI/tests ของ `5.8.0` ผ่านสำหรับ doctor behavior ที่ไม่ต้องใช้ provider

เตรียม source:

```sh
cd /private/tmp/pi-github-repos/6b91ca6e3e3f04824896ae46ef87017caac368f0b8119d1ea7d1ad1d5abb6662
npm ci
npm run build
```

รัน targeted doctor tests:

```sh
cd /private/tmp/pi-github-repos/6b91ca6e3e3f04824896ae46ef87017caac368f0b8119d1ea7d1ad1d5abb6662/packages/cli
node --test --test-concurrency=1 --test-timeout=60000 --test-force-exit \
  --test-name-pattern 'doctor discovers Pi through local auth, models, and trust fixtures|role-targeted doctor inspects effective resources and prepares hooks without provider execution|package bin and CLI expose doctor and inspector commands' \
  dist/test/doctor.test.js
```

Observed output:

```text
✔ doctor discovers Pi through local auth, models, and trust fixtures
✔ role-targeted doctor inspects effective resources and prepares hooks without provider execution
✔ package bin and CLI expose doctor and inspector commands
ℹ pass 3
ℹ fail 0
```

### Inference

- `doctor` capability ใน source `5.8.0` **มีและมี test coverage ชัด**
- แต่ isolated install path ที่ลองจริง **ยังมี friction 2 ชั้น**:
  1. CLI peer resolution
  2. doctor result ไม่แสดง core workflow functions/tools ตามที่คาด
- จึงยังไม่พอจะใช้เป็น evidence ว่า “install แล้วใช้งาน backend ได้ทันที” ใน profile แยกของเรา

## 4) Standalone subagent

### Observed evidence

อ่านจาก `packages/core/subagents/README.md`:
- model-visible tools คือ `subagents_run`, `subagents_inspect`, `subagents_steer`, `subagents_stop`, `subagents_retry`
- มี durable IDs, foreground/background, worktree, retry, inspect ได้
- ระบุชัดว่า **cross-session restoration ของ live native subagent session ไม่รองรับ**; manager ใหม่จะ reconcile `running` เป็น failed/interrupted แล้วให้ `subagents_retry` เริ่มใหม่

รัน targeted tests:

```sh
cd /private/tmp/pi-github-repos/6b91ca6e3e3f04824896ae46ef87017caac368f0b8119d1ea7d1ad1d5abb6662/packages/core
agent=$(mktemp -d)
PI_CODING_AGENT_DIR="$agent" node --test --test-timeout=30000 --test-force-exit \
  --test-name-pattern 'runs one background subagent with context-derived setup and execution options|returns foreground terminal envelopes, preserves mode for retry, and suppresses follow-ups|uses RunStore worktrees and removes them after a standalone run|isolates concurrent real-git worktrees with the same name|creates and cleans an injected named worktree for a subagent' \
  subagents/test/index.test.mjs
```

Observed output:

```text
✔ runs one background subagent with context-derived setup and execution options
✔ returns foreground terminal envelopes, preserves mode for retry, and suppresses follow-ups
✔ uses RunStore worktrees and removes them after a standalone run
✔ isolates concurrent real-git worktrees with the same name
✔ creates and cleans an injected named worktree for a subagent
ℹ pass 5
ℹ fail 0
```

### Inference

- standalone subagents ของ `5.8.0` มี implementation/test maturity พอสมควร
- แต่ถ้าจะใช้เป็น delegated backend ของ coordinator ต้องยอมรับว่า **resume ของ live child session ไม่ใช่ restore conversation ตรง ๆ**; เป็น durable record + retry model มากกว่า

## 5) `reviewLoop`

### Observed evidence

อ่าน source `packages/core/starter/review-loop.ts`:
- `reviewLoop` เป็น `defineWorkflowFunction(...)`
- วน developer/reviewer ตาม `maxIterations`
- reviewer ใช้ structured `outputSchema` `{ pass: boolean, findings: string[] }`
- คืน `{ pass, iterations, devResult, review }`

อ่าน README/SKILL:
- bundled starter มี `reviewLoop`
- roles/aliases override ได้
- แต่ตัว function `reviewLoop` เอง “is not” overridable ตาม README/skill wording

รัน tests:

```sh
cd /private/tmp/pi-github-repos/6b91ca6e3e3f04824896ae46ef87017caac368f0b8119d1ea7d1ad1d5abb6662/packages/core
agent=$(mktemp -d)
TMPDIR=$(mktemp -d) PI_CODING_AGENT_DIR="$agent" env -u HERDR_ENV -u HERDR_PANE_ID -u HERDR_SOCKET_PATH -u HERDR_TAB_ID -u HERDR_WORKSPACE_ID \
  node --test --test-concurrency=1 --test-timeout=120000 --test-force-exit dist/test/starter.test.js
```

Observed output:

```text
✔ registers the starter function, aliases, and packaged roles
✔ reviewLoop passes after a reviewer approves
✔ reviewLoop fails when the iteration limit is reached
✔ packages portable role settings without forbidden overrides
✔ static settings aliases shadow starter dynamic aliases
ℹ pass 5
ℹ fail 0
```

### Inference

- `reviewLoop` มีจริงและทำงานตามที่เอกสารอ้างใน source tests
- แต่เป็น abstraction ที่ opinionated; ถ้าจะ map เข้ากับ delegated-autonomy coordinator ต้องระวังว่า loop/policy/acceptance authority ของเรากับของ starter ไม่ใช่สิ่งเดียวกัน

## 6) Worktree

### Observed evidence

อ่าน docs/skill:
- `withWorktree(name, callback)` สร้าง named isolated worktree scope
- callback ได้ frozen `{ path, branch }`
- `parentRunId` ยืม matching named worktrees จาก terminal run ได้ แต่ **ไม่ replay/resume run**

รัน tests:

```sh
cd /private/tmp/pi-github-repos/6b91ca6e3e3f04824896ae46ef87017caac368f0b8119d1ea7d1ad1d5abb6662/packages/core
agent=$(mktemp -d)
TMPDIR=$(mktemp -d) PI_CODING_AGENT_DIR="$agent" env -u HERDR_ENV -u HERDR_PANE_ID -u HERDR_SOCKET_PATH -u HERDR_TAB_ID -u HERDR_WORKSPACE_ID \
  node --test --test-concurrency=1 --test-timeout=120000 --test-force-exit \
  --test-name-pattern 'withWorktree returns bare values and propagates one owner through parallel and pipeline|withWorktree callbacks receive frozen public references|shared worktree scopes persist one owner across production agents and functions' \
  dist/test/workflow-runtime.test.js dist/test/runtime-acceptance.test.js
```

Observed output:

```text
✔ shared worktree scopes persist one owner across production agents and functions
✔ withWorktree returns bare values and propagates one owner through parallel and pipeline
✔ withWorktree callbacks receive frozen public references
ℹ pass 3
ℹ fail 0
```

### Inference

- worktree semantics ตรงกับสิ่งที่ plan ของ coordinator ต้องการหลายจุด
- เป็นส่วนที่ fit ค่อนข้างดี โดยเฉพาะ exact owner / named scope / parallel isolation

## 7) Budget และ resume

### Observed evidence

อ่าน docs/skill/doctor/changelog:
- budget dimensions: `tokens`, `costUsd`, `durationMs`, `agentLaunches`
- `workflow_resume({ runId, budget?, foreground? })` ใช้กับ `budget_exhausted`
- การ relax budget สร้าง proposal และต้องใช้ `workflow_respond`
- retry/resume แยกกันชัด

รัน tests:

```sh
cd /private/tmp/pi-github-repos/6b91ca6e3e3f04824896ae46ef87017caac368f0b8119d1ea7d1ad1d5abb6662/packages/core
agent=$(mktemp -d)
TMPDIR=$(mktemp -d) PI_CODING_AGENT_DIR="$agent" env -u HERDR_ENV -u HERDR_PANE_ID -u HERDR_SOCKET_PATH -u HERDR_TAB_ID -u HERDR_WORKSPACE_ID \
  node --test --test-concurrency=1 --test-timeout=120000 --test-force-exit \
  --test-name-pattern 'workflow_resume persists exact proposals and approval or rejection controls exhausted runs|recovery inherits persisted launch mode for resume and retry' \
  dist/test/budget.test.js dist/test/runtime-acceptance.test.js
```

Observed output:

```text
✔ workflow_resume persists exact proposals and approval or rejection controls exhausted runs
✔ recovery inherits persisted launch mode for resume and retry
ℹ pass 2
ℹ fail 0
```

### Inference

- budget/resume surface ของ piewf ค่อนข้าง mature และ deterministic
- แต่ delegated-autonomy plan ของเราตั้งใจหลีกเลี่ยง human approval loops สำหรับ routine flow; ในขณะที่ piewf budget relaxation ยังมี proposal/approval surface ของมันเอง จึงต้องตัดสินใจให้ชัดว่าใครเป็นเจ้าของ approval semantics

## 8) Herdr API fit

### Observed evidence

อ่าน `packages/extensions/herdr/README.md` และ `packages/extensions/herdr/index.ts`:
- package แยก `@piewf/herdr`
- fully inspectable mode ตั้งผ่าน global workflow settings `extensionSettings.herdr.enableFullyInspectableMode`
- source มี `isFullyInspectableMode(...)`
- README ระบุว่าเมื่อเปิด global fully inspectable mode จะ launch workflow agents ใน labeled Herdr workspace

รัน targeted tests:

```sh
cd /private/tmp/pi-github-repos/6b91ca6e3e3f04824896ae46ef87017caac368f0b8119d1ea7d1ad1d5abb6662/packages/extensions/herdr
TMPDIR=$(mktemp -d) env -u HERDR_ENV -u HERDR_PANE_ID -u HERDR_SOCKET_PATH -u HERDR_TAB_ID -u HERDR_WORKSPACE_ID \
  node --test --test-timeout=120000 --test-force-exit \
  --test-name-pattern 'uses the global extension setting and complete breadcrumb labels|materializes a fresh session before launching a fully inspectable agent|routes fully inspectable agents into one labeled workflow workspace|closes workspaces for every terminal run state and session shutdown' \
  test/index.test.mjs
```

Observed output:

```text
✔ uses the global extension setting and complete breadcrumb labels
✔ materializes a fresh session before launching a fully inspectable agent
✔ routes fully inspectable agents into one labeled workflow workspace
✔ closes workspaces for every terminal run state and session shutdown
ℹ pass 4
ℹ fail 0
```

### Inference

- ในเชิง capability `@piewf/herdr` fit กับ requirement เรื่อง inspectability ของ plan ได้ดี
- แต่ยังไม่พอจะสรุปว่าเหมาะเป็น backend ทั้งก้อน เพราะยังมีปัญหา install/load/pin และ source-of-truth

## 9) API churn / migration cost

### Observed evidence

1. registry versions/dates:

```sh
npm view pi-extensible-workflows versions --json
npm view pi-extensible-workflows time --json
```

Observed output สำคัญ:
- `5.5.0` → `2026-08-16T09:55:41.826Z`
- `5.6.1` → `2026-08-19T06:43:37.120Z`
- `5.7.0` → `2026-08-20T20:55:24.738Z`
- `5.8.0` → `2026-08-23T20:04:26.713Z`
- `5.9.0` → `2026-08-28T09:51:19.229Z`

2. changelog ใน source `5.8.0` บันทึก breaking changes หลายรอบใกล้กัน:
- `5.5.0`: selector/settings/Herdr config migration
- `5.6.0`: role/thinking/singleAgent changes
- `5.8.0`: ทุก workflow agent ต้อง submit `workflow_result`

3. install probe จาก npm ที่ขอ `5.8.0` แต่ observed package จริงกลายเป็น `5.9.0` สำหรับ core/CLI

### Inference

- churn rate สูงพอที่จะทำให้ integration/migration cost สูงกว่าการอ่าน README อย่างเดียวมาก
- ถ้าจะรับเข้า production ควรมี compatibility suite ของเราเอง และต้อง lock install path ให้ตรวจได้จริงก่อน

## 10) Dual-source-of-truth risk

### Observed evidence

- plan ของเรา (`docs/plans/delegated-autonomy-coordinator.md`) ระบุชัดใน Phase 6 ว่า ถ้าใช้ piewf ต้อง “กำหนด source of truth เดียวต่อ run ห้าม registry สองชุดแข่งกัน”
- piewf docs ระบุ durable workflow artifacts เอง เช่น `snapshot.json`, `workflow.js`, `result.json`
- subagents docs ระบุ durable records ใต้ `~/.pi/agent/subagents/<id>/`
- piewf มี own lifecycle/control surfaces: `workflow_status`, `workflow_resume`, `workflow_retry`, `workflow_respond`, `subagents_*`

### Inference

- ถ้า coordinator ยังเก็บ mandate/audit/worker registry/lifecycle ของตัวเอง และปล่อยให้ piewf เก็บ run/subagent ownership เต็มชุดพร้อมกัน จะเกิด ambiguity ว่าใคร authoritative ต่อ
  - run state
  - retry/resume lineage
  - approval/budget decisions
  - artifact acceptance
  - handoff to Herdr
- จึงควรรับ piewf ได้ก็ต่อเมื่อออกแบบให้ **หนึ่ง run มีเจ้าของ orchestration state เพียงชุดเดียว**

## 11) สิ่งที่ “รันไม่ได้/ไม่ได้รัน” อย่างตรงไปตรงมา

1. **ไม่ได้รัน live agent execution กับ provider จริง** สำหรับ `reviewLoop`, `workflow`, หรือ `subagents_run` ใน Pi session จริงของ profile แยก
   - เหตุผล: ต้องพึ่ง model/provider credentials และอาจใช้ paid service; ผู้ใช้กำชับให้หยุดแทนการเดาเมื่อเรื่อง credential/paid service ไม่ชัด
2. **ไม่ได้ยืนยัน human-only / hard deny / provider error / timeout / missing artifact ด้วย live end-to-end probe ใน Pi interactive runtime จริง**
   - สิ่งที่มีแทน: source tests และ docs/source inspection
3. **ไม่ได้แก้หรือ mutate global Pi config**
   - temp profile ทั้งหมดใช้ `PI_CODING_AGENT_DIR=$(mktemp -d)`

## 12) Go / No-Go พร้อมเงื่อนไข

### Decision now

**NO-GO** สำหรับ:
- เพิ่ม dependency นี้เข้า implementation branch ของ delegated-autonomy coordinator ตอนนี้
- ย้าย run ownership ไปให้ piewf backend ก่อนเคลียร์ blocker ด้านล่าง

### เงื่อนไขที่จะเปลี่ยนเป็น GO-for-adoption

1. **License clarity**
   - มี `LICENSE` file ใน source/tarball/release artifact หรือมีคำชี้แจงที่ bind กับ release artifact ชัดเจน
2. **Exact pin/install reproducibility**
   - `pi install npm:pi-extensible-workflows@5.8.0` และ companions ต้อง materialize version ที่ขอตรงจริง หรือมี documented install path ที่แน่นอนกว่านี้
3. **Isolated doctor/load sanity**
   - ใน temp `PI_CODING_AGENT_DIR`, `piewf doctor --json` ต้องเห็น core workflow surface ตามคาด ไม่ใช่ `functions: []`
4. **Single source of truth design**
   - ออกแบบให้หนึ่ง run ใช้ registry/lifecycle authority เดียว และกำหนด boundary ระหว่าง coordinator mandate/audit กับ piewf runtime ชัดเจน
5. **One live non-paid-or-explicitly-approved runtime probe**
   - อย่างน้อยต้องมี e2e probe จริงหนึ่งเส้นที่ไม่ติด ambiguity เรื่อง credential/paid service หรือได้รับอนุมัติ explicit
6. **Compatibility suite ของเราเอง**
   - ครอบ reviewLoop/worktree/budget/resume/Herdr mode กับ version pin ที่จะใช้จริง

## 13) Bottom line

### Observed bottom line

- `5.8.0` source/test evidence ดี และ feature ที่ต้องการมีจริง
- แต่ release/install/runtime-adoption evidence ใน isolated profile ที่ลองจริง **ยังไม่ผ่าน gate**

### Inference bottom line

- piewf เหมาะเป็น **candidate สำหรับการประเมินต่อ** มากกว่าเป็น dependency ที่ควรรับเข้าทันที
- ทางที่ปลอดภัยตอนนี้คือคง custom coordinator layer ต่อไป และอย่าเอา piewf เข้าเป็น production backend จนกว่าจะปิด blocker ข้างต้น
