# My Pi

ชุด capability packages สำหรับ Pi ที่แยก stable global resources, project opt-ins และ incubator ออกจากกันอย่างชัดเจน Root package `0.2.0` เป็น stable global aggregate ส่วน releaseจริงจะติดตั้งจาก exact Git tag/commit ไม่อ้าง development working tree

## Repository model

```text
capabilities/
├── global/              # stable และ root package โหลดทุก project
├── project-opt-in/      # stable แต่ trusted project ต้องเลือกติดตั้ง
└── incubator/           # development/candidate; root packageห้ามโหลด

lab/                     # disposable experiments
scripts/                 # aggregate repository automation
tests/                   # architecture/cross-capability tests
docs/                    # repository-owned notes และ plans
```

หนึ่ง capabilityเป็นหน่วย ownership/deployment และมี `package.json`, README, extensions, skills, tests, profilesหรือ resourceอื่นเฉพาะที่มันเป็นเจ้าของ

## Stable global capabilities

Root `package.json#pi` aggregateเฉพาะ packagesใต้ `capabilities/global/`:

- [`runtime-mode`](capabilities/global/runtime-mode/)
  - ระบุ session ที่ Coordinator สร้างด้วย `mypi-worker:*`
  - ปิด interactive toolsที่ไม่มีผู้ใช้เฝ้า
  - command `/mypi-worker-status`
- [`dependency-updates`](capabilities/global/dependency-updates/)
  - ตรวจ dependencyแบบ backgroundไม่ขวาง startup
  - command `/mypi-updates`
- [`herdr-integration`](capabilities/global/herdr-integration/)
  - shared Herdr CLI client, blocked-state bridge และ official lifecycle integration setup
  - commands `/mypi-herdr-status`, `/mypi-herdr-setup`
- [`safety-guardrails`](capabilities/global/safety-guardrails/)
  - ตรวจ secret reads, local uploads และ filesystem mutationsภายนอก workspace
  - manual modeถามผู้ใช้; non-interactive mode fail closed
- [`interactive-steering`](capabilities/global/interactive-steering/)
  - ให้ผู้ใช้เลือก Steer, Wait หรือ Cancel ระหว่าง agentทำงาน
- [`structured-questions`](capabilities/global/structured-questions/)
  - adapterสำหรับ `@juicesharp/rpiv-ask-user-question`
- [`planning-review`](capabilities/global/planning-review/)
  - adapterสำหรับ `@plannotator/pi-extension`
- [`planning-continuity`](capabilities/global/planning-continuity/)
  - session-internal plan snapshots หรือ pointerไป workspace plan
  - แยก continuity tracking ออกจาก optional Plannotator review
  - command `/mypi-continuity`
- [`ui-themes`](capabilities/global/ui-themes/)
  - `cffy-dark`, `cffy-sky`, `modern-dark`

Package manifestsและ aggregate lockfileเป็น authorityสำหรับ resource/dependency paths ห้ามเพิ่ม incubatorหรือ project-opt-in resourceเข้า root Pi manifest

## Project opt-ins

### Azure DevOps

[`capabilities/project-opt-in/azure-devops/`](capabilities/project-opt-in/azure-devops/) รองรับ Azure Boards/Repos read tools และ opt-in Work Item create/update/soft-delete

แต่ละ trusted projectเปิดใช้ผ่าน `.pi/settings.json`:

```json
{
  "packages": [
    "/absolute/path/to/stable-mypi/capabilities/project-opt-in/azure-devops"
  ]
}
```

จากนั้นเพิ่ม `.pi/azure-devops.json` ใน projectเดียวกัน Configเดิมที่ไม่มี `permissions` normalizeเป็น read-only:

```json
{
  "organization": "example-org",
  "project": "example-project",
  "auth": {
    "method": "azure-cli"
  }
}
```

Project ที่ต้องเขียน Work Items ต้องใช้ PAT และเปิด operationอย่างชัดเจน:

```json
{
  "organization": "example-org",
  "project": "example-project",
  "auth": {
    "method": "pat",
    "patEnv": "AZURE_DEVOPS_PAT"
  },
  "permissions": {
    "workItems": {
      "read": true,
      "create": true,
      "update": true,
      "delete": false
    },
    "repos": {
      "read": true
    }
  }
}
```

Create/Update/Delete ไม่ fallbackไป Azure CLI, ต้องยืนยันทุกครั้งและถูก blockเมื่อไม่มี interactive UI Deleteเป็น soft deleteเท่านั้น ดู contractเต็มใน [Azure DevOps README](capabilities/project-opt-in/azure-devops/README.md)

## Incubator

[`capabilities/incubator/delegated-orchestration/`](capabilities/incubator/delegated-orchestration/) รวม manual Herdr orchestrationเดิมกับ delegated-autonomy policy/registries, harness profiles, scoped tools, patched agent-teams artifacts/probesและ `herdr-orchestration` Skillไว้เป็น whole capability

สถานะปัจจุบัน:

- mandate/policy/REVIEW pure registriesและ Phase 0 acceptanceผ่านแล้ว
- agent-teams candidateยัง production disabled
- root stable manifestไม่โหลด orchestration extensionหรือ skill
- generated Worker profile, single-provider credential projection, no-default-fallbackและ real-provider forced-crash/retry acceptance implementแล้วใน incubator
- leader-loss reconciliation, read-only/worktree-write adaptersและ final Phase 2–3 reviewยังไม่ครบ; ห้ามตีความสถานะนี้เป็น production activation

Agent-teams artifactsอยู่ที่:

```text
capabilities/incubator/delegated-orchestration/profiles/pi-agent-teams/node-worker-v1/
```

Opt-in probes:

```sh
npm run test:agent-teams-runtime -- <patched-checkout>
npm run test:agent-teams-acceptance -- <patched-checkout> [fresh-output-root]
```

## Development setup

ติดตั้ง dependenciesตาม lockfile:

```sh
npm ci
```

ใช้ Pi profileแยกจาก Default profileสำหรับ active checkout:

```sh
PI_CODING_AGENT_DIR="$HOME/.pi-profiles/my-pi-dev" \
  pi install /absolute/path/to/my-pi

PI_CODING_AGENT_DIR="$HOME/.pi-profiles/my-pi-dev" pi
```

Local-path packageอ้าง sourceโดยตรง จึงใช้ `/reload` หลังแก้ stable capabilityได้ แต่ไม่ควรใช้ development checkoutเป็น Default Pi packageหลัง pinned releaseพร้อม

`pi -e <extension>` เหมาะกับ quick one-shot test แต่ resourceที่โหลดด้วย `-e` ไม่ hot-reload

## Stable release installation

Target release modelคือ exact Git refจาก remote:

```text
git@github.com:nawatt-works/mypi.git
```

Stable releaseปัจจุบันคือ annotated tag `v0.2.0` ที่ commit `6c61b9d0ddd50f0f5adf4761fd93979dae6bc0bf`:

```sh
pi install git:git@github.com:nawatt-works/mypi.git@v0.2.0
```

Pinned refไม่เลื่อนเองจากการแก้ working treeหรือ `pi update --extensions` การเปลี่ยนรุ่นต้องระบุ refใหม่และ rollbackได้ด้วย previous ref Default Piที่ตรวจรับแล้วโหลด tagนี้จาก Pi Git package store; development checkoutใช้เฉพาะ isolated development profile

## Verification

รัน full repository suite:

```sh
npm test
```

Test runnerค้น `*.test.ts` ใต้ root `tests/` และ `capabilities/` Architecture checksยืนยันว่า:

- ทุก capabilityมี unique package manifestและ README
- root aggregateโหลดทุกและเฉพาะ `capabilities/global/` resources
- global packageห้าม import/dependไปอีก lane
- commandsที่ maintainเองใช้ prefix `/mypi-`
- legacy flat resource rootsไม่มีเหลือ

Clean-install gateต้องผ่าน `npm ci` และโหลด stable extension setจาก temporary isolated Pi directoryโดยไม่อาศัย development `node_modules`

## Dependency updates

ตรวจทันที:

```text
/mypi-updates
```

หรืออัปเดตจาก repository:

```sh
npm update
npm test
```

หากต้องการให้ตรง lockfileทุกประการใช้ `npm ci` Capability package dependenciesเป็น npm workspacesและ root lockfileเป็น clean-install boundary

## Guardrails และขอบเขตการป้องกัน

Safety Guardrails ลดความผิดพลาดจาก modelและป้องกันการเข้าถึงข้อมูลสำคัญโดยไม่ตั้งใจ ครอบคลุม built-in tools, bounded shell analysis, command-bearing MCP/custom tools, canonical secret aliases, compound sensitive uploads, remote service mutations, known PDF outputและ screenshot paths

Workspace/temporary policy:

- freeze canonical Git worktree rootหรือ launch cwdตอนเริ่ม session โดยแยกจาก current execution cwd
- subdirectoryและ siblingภายใน workspaceเดียวกันไม่ต้องขอ approvalซ้ำ
- symlink/cwdที่ออกนอก immutable rootถูก blockหรือถามตาม mode
- สร้าง private mode `0700` temporary rootต่อ session; ไม่อนุญาต `os.tmpdir()`ทั้งก้อนอีกต่อไป
- `/dev/null` ใช้ทิ้ง outputได้ แต่ไม่ได้อนุญาต pathอื่นใต้ `/dev`
- session grantsผูก exact resource, หมดอายุไม่เกิน 1 ชั่วโมงและ remote mutationไม่มี session-wide grant

Guardrailsเป็น best-effort policy layer ไม่ใช่ security sandbox:

- มองไม่เห็น side effectที่ซ่อนใน MCP server, extension, local scriptหรือ subprocessทั้งหมด
- runtime-computed pathsอาจวิเคราะห์ล่วงหน้าไม่ได้
- slash commands/startup hooksอาจไม่ผ่าน `tool_call`
- Pi/extensions/shellยังมีสิทธิ์ตาม OS user

งานกับ inputที่ไม่น่าเชื่อถือและต้องการขอบเขตที่ข้ามไม่ได้ควรใช้ container, VM, OS sandboxหรือ execution identityที่จำกัดเพิ่ม

## Plan, continuity และ Plannotator

Planning Continuityแยกสามเรื่อง:

1. งานต้องมี continuity stateหรือไม่
2. stateเป็น session-internal AI working stateหรือ workspace artifact
3. ต้องใช้ Plannotatorสำหรับ human review/approvalหรือไม่

Session-internal planเก็บ compact snapshotใน Pi sessionโดยไม่สร้างไฟล์ Workspace planใช้ exact pathที่ artifact ownerกำหนดและ extensionเก็บเพียง pointer ไม่สร้าง skeleton, เปลี่ยน schema, ย้ายหรือ delete artifact

```text
/mypi-continuity automatic
/mypi-continuity off
/mypi-continuity status
```

`mypi_use_plannotator` รองรับ workspace planเท่านั้นและไม่ promote session planเป็นไฟล์อัตโนมัติ

แผน migrationปัจจุบันอยู่ที่ [`docs/plans/capability-packages-and-pinned-releases.md`](docs/plans/capability-packages-and-pinned-releases.md) ส่วน delegated-autonomy planถูกพักไว้ที่ [`docs/plans/delegated-autonomy-coordinator.md`](docs/plans/delegated-autonomy-coordinator.md) จนกว่าจะถึง Worker-profile discussion

## Security

Pi extensionsทำงานด้วยสิทธิ์ของ processและเข้าถึงระบบไฟล์ได้ ควร review source/dependenciesก่อนติดตั้ง capabilityใหม่ Project-opt-in extensionsโหลดหลัง project trustเท่านั้น

Credential guidanceของ Azure DevOpsอยู่ใน [`AZURE_DEVOPS_PAT_SECURITY.md`](AZURE_DEVOPS_PAT_SECURITY.md)
