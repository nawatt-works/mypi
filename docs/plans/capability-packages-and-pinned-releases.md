# จัด My Pi เป็น Capability Packages และ Pinned Releases

> **Status:** active — planning and inventory<br>
> **Created:** 2026-08-30 09:10<br>
> **Updated:** 2026-08-30 10:00<br>
> **Purpose:** แยก capability ตามสถานะและขอบเขตการติดตั้ง ให้ Default Pi โหลดเฉพาะของที่ stable จริงจาก pinned Git release โดยไม่ผูกการพัฒนากับ production working tree

## Goal and scope

ปรับโครงสร้าง repository `my-pi` จากชุด extension/skill แบบ flat ให้เป็น capability packages ซึ่งรวม resource ที่เป็นเจ้าของความสามารถเดียวกันไว้ด้วยกัน และสร้าง release boundary ที่ตรวจสอบได้:

1. extension, skill, prompt, profile, schema, test และเอกสารของ capability เดียวกันอยู่ภายใต้ package เดียว
2. Default Pi โหลดเฉพาะ stable global capabilities
3. capability ที่ stable แต่ต้องให้ project เลือกใช้ อยู่ภายใต้ `capabilities/project-opt-in/`
4. capability ที่ยังพัฒนาหรือเป็น candidate อยู่ภายใต้ `capabilities/incubator/` และไม่ถูก stable manifest โหลด
5. Default Pi ติดตั้ง exact Git tag/commit จาก remote ไม่อ้าง development working tree
6. Development Pi ใช้ profile แยกและโหลด active checkout ได้โดยไม่กระทบ Default Pi
7. ไม่ refactor ภายใน capability เพียงเพื่อแยกส่วน stable ออกจากส่วนที่ยังพัฒนา; ถ้ายังมีส่วนไม่พร้อม ให้ทั้ง capability อยู่ incubator

## Confirmed decisions

### D1 — Capability เป็นหน่วย ownership และ deployment

extension/skill จะไม่เป็นหน่วยจัดโครงสร้างหลักแบบแยกตาม resource type อีกต่อไป หนึ่ง capability package อาจมี:

```text
<capability>/
├── package.json
├── extensions/
├── skills/
├── prompts/
├── themes/
├── profiles/
├── schemas/
├── tests/
└── README.md
```

ไม่บังคับให้ทุก package มีทุก directory; ใส่เฉพาะ resource ที่ capability นั้นเป็นเจ้าของ

### D2 — Stable-only global release

ไม่ต้องรักษาความเข้ากันได้กับ project อื่นที่กำลังใช้ Default profile จาก working tree ปัจจุบัน Release ใหม่รับเฉพาะ capability ที่ผ่าน stable gate จริงเท่านั้น

ถ้า capability มีทั้ง behavior เดิมที่ใช้งานได้และส่วนใหม่ที่ยังพัฒนา:

- ไม่ผ่าตัดเพื่อสร้าง stable subset เพียงเพื่อให้ยังอยู่ใน global release
- ให้ทั้ง capability อยู่ `capabilities/incubator/`
- promote ทั้ง package เมื่อพร้อม

### D3 — `capabilities/project-opt-in/` คือ released scope ไม่ใช่ development scope

เปลี่ยนชื่อ `local/` เป็น `capabilities/project-opt-in/` เพื่อสื่อว่า capability ในพื้นที่นี้:

- ผ่าน stable gate แล้ว
- ไม่ควรโหลดทุก project
- project ที่ trusted ต้องเลือกติดตั้งหรือชี้ package ผ่าน `.pi/settings.json`

Project-specific code ที่ไม่มีเจตนา reuse ควรอยู่ใน project เจ้าของ ไม่ย้ายมา `my-pi/capabilities/project-opt-in/`

### D4 — `capabilities/incubator/` ครอบ development และ candidate

ใช้ README/status ของแต่ละ package แยก `development` กับ `candidate` โดยไม่สร้าง lifecycle directory เพิ่มและไม่ย้าย sourceทุกครั้งที่สถานะเปลี่ยน

Candidate หมายถึง implementation/review/isolated acceptance ผ่านตามขอบเขตของมัน แต่ยังไม่ผ่าน production promotion gate

### D5 — Default Pi ใช้ pinned Git release

Remote ของ repository คือ:

```text
git@github.com:nawatt-works/mypi.git
```

Default Pi ต้องติดตั้ง exact ref เช่น:

```sh
pi install git:git@github.com:nawatt-works/mypi.git@v0.2.0
```

Pinned ref ไม่เลื่อนเองเมื่อแก้ working treeหรือรัน package update การเปลี่ยนรุ่นต้องระบุ release ref ใหม่อย่างชัดเจน และ rollback ทำได้ด้วย previous ref

การ push commit/tag เป็น external mutation ที่ต้องให้ผู้ใช้ตัดสินใจและลงมือหรืออนุมัติในขั้น release

### D6 — Development profile แยกจาก Default profile

Development profile โหลด active checkout ได้:

```sh
PI_CODING_AGENT_DIR="$HOME/.pi-profiles/my-pi-dev" pi
```

Default profile โหลด pinned release เท่านั้น ห้ามใช้ development checkout เป็น global local-path package หลัง migration เสร็จ

### D7 — Worker profile พักไว้คุยหลังงาน packaging

ยังไม่ตัดสิน final Worker profile, credential provisioning หรือ profile inheritance ในแผนนี้

สิ่งที่ทราบแล้วและต้องรักษาเป็น blocker:

- child Pi ปัจจุบันปิด global resourcesด้วย flags แต่ยังเก็บ `HOME` และไม่ส่ง `PI_CODING_AGENT_DIR`
- จึงยังรับประกันไม่ได้ว่าจะไม่อ่าน Default `settings.json`, `auth.json` หรือ `models.json`
- ห้ามเปิด delegated Pi Worker productionเพียงเพราะ packaging migration เสร็จ

หลังปิดงานส่วนอื่นที่ไม่ขึ้นกับ Worker profileแล้ว ให้กลับมาหารือและสร้างแผนย่อยเรื่อง exact profile, credentials, readiness และ no-fallback tests

### D8 — `pi-doc` ยังแยก repository

ยังไม่ย้าย `/Users/developer/my-project/pi-doc/` เข้า repository นี้และยังไม่ทำเป็น Skill ใช้เป็น reference แยกตาม lifecycle เดิม

ปัจจุบัน `pi-doc` ผูก Pi `0.84.3` ขณะที่ installed Pi เป็น `0.84.4`; ก่อนใช้ claim ที่เกี่ยวกับ sourceที่เปลี่ยนต้องเทียบ official installed docs

### D9 — ยังไม่ adopt Agent Plugins standard

โครงสร้าง capability packageเตรียมไว้ให้ extension, skill และ resourceที่เกี่ยวข้องอยู่ด้วยกัน ซึ่งสอดคล้องเชิงแนวคิดกับ Agent Plugins แต่ยังไม่ตั้ง manifestหรือ compatibility contractตามมาตรฐานใดจนกว่าจะประเมิน source/specจริง

## Non-goals

- ไม่ออกแบบ Worker credential/profile contract ในรอบ packaging
- ไม่ production-wire delegated autonomy หรือ agent-teams candidate
- ไม่ย้ายหรือเปลี่ยน lifecycle ของ `pi-doc`
- ไม่ publish npm packages ในรอบแรก
- ไม่บังคับ backward compatibility กับ root package layout เดิม
- ไม่แยก stable subset ออกจาก capability ที่ยังไม่พร้อม
- ไม่สร้าง central metadata/index เพิ่มนอก package manifestsและเอกสารที่จำเป็น
- ไม่เปลี่ยน Plannotator หรือ `ask user`

## Target repository structure

```text
my-pi/
├── capabilities/
│   ├── global/
│   │   ├── <stable-capability>/
│   │   │   ├── package.json
│   │   │   ├── extensions/
│   │   │   ├── skills/
│   │   │   ├── tests/
│   │   │   └── README.md
│   │   └── ...
│   │
│   ├── project-opt-in/
│   │   ├── azure-devops/
│   │   │   ├── package.json
│   │   │   ├── extensions/
│   │   │   ├── skills/
│   │   │   ├── tests/
│   │   │   └── README.md
│   │   └── ...
│   │
│   └── incubator/
│       ├── delegated-autonomy/
│       │   ├── package.json
│       │   ├── extensions/
│       │   ├── skills/
│       │   ├── profiles/
│       │   ├── tests/
│       │   └── README.md
│       └── ...
│
├── lab/                       # disposable experiments/probes
├── docs/                      # repository-owned docs/plans/notes
├── package.json               # aggregate stable global release only
└── package-lock.json
```

ตำแหน่งสุดท้ายอาจปรับจาก inventory ได้ แต่ semantic boundary ต่อไปนี้ห้ามเปลี่ยนโดยไม่มี decision ใหม่:

- `capabilities/global/` = stable + autoload global
- `capabilities/project-opt-in/` = stable + project-selected
- `capabilities/incubator/` = not released
- root manifest = stable global aggregate เท่านั้น

## Capability package contract

แต่ละ package ต้องระบุอย่างน้อย:

- unique package name
- package version
- `private: true` จนกว่าจะตัดสิน publish
- `type: module` เมื่อมี TypeScript/ESM extension
- Pi manifestที่ enumerate resources ของ package
- runtime dependenciesใน `dependencies`
- Pi core packagesใน `peerDependencies` range `"*"` ตาม Pi package contract
- README ระบุ purpose, scope, status, configuration, commands/tools, security boundary และ verification
- tests ที่ resolve sourceจาก package owner ไม่อาศัย path เดิมแบบซ่อน

Root packageทำหน้าที่ aggregate stable global resources ไม่ auto-discover `capabilities/incubator/` หรือ `capabilities/project-opt-in/` resources

ต้องประเมิน npm workspacesหรือวิธีติดตั้ง dependenciesร่วมกันก่อนย้าย packageจริง เพื่อให้ clean Git installทำงานโดยไม่อาศัย `node_modules` จาก development checkoutโดยบังเอิญ

## Provisional capability inventory

รายการนี้เป็นจุดเริ่ม inventory ไม่ใช่คำตัดสิน stable:

| Current resources | Provisional capability | Proposed lane | ต้องตรวจเพิ่ม |
|---|---|---|---|
| `guardrails.ts` | safety-guardrails | global candidate | manual behavior, transitive imports, no delegated wiring |
| `steering-choice.ts` | interactive-steering | global candidate | Worker-mode coupling |
| `dependency-update-notifier.ts` | dependency-updates | global candidate | package pathsและ pinned release semantics |
| `planning-workflow.ts` | planning-continuity | global candidate | session compatibility |
| `herdr-integration.ts`, `herdr-client.ts` | herdr-integration | global candidate | couplingกับ orchestration/worker mode |
| `worker-mode.ts`, `orchestration.ts`, `orchestration-registry.ts`, orchestration Skill | orchestration | incubator candidate | มี delegated workที่ยังไม่ production-ready; ไม่ splitเพื่อรักษา manual subset |
| delegated policy/profile/scoped toolsและ agent-teams profile/probes | delegated-autonomy | incubator candidate | path-bound hashes, overlay/provenance, Worker profile discussion |
| `local/extensions/azure-devops/` | azure-devops | project-opt-in candidate | mini-package manifest, config docs, tests/imports |
| themes | ui-themesหรือ root theme capability | inventory | ตัดสิน package ownership |
| third-party RPIV/Plannotator resources | interaction/planning dependencies | inventory | ตัดสินว่าเป็น aggregate dependencyหรือ capability ownerใด |

การจัด lane จริงต้องเกิดหลังอ่าน import graph, Pi manifest, testsและ runtime couplingครบ

## Phase 0 inventory result

### Root production closure ปัจจุบัน

Root `package.json#pi` โหลด extension entry 9 รายการ, themesทั้ง directoryและ skillทั้ง directory Root local transitive closureปัจจุบันคือ:

```text
extensions/worker-mode.ts
extensions/dependency-update-notifier.ts
extensions/herdr-client.ts
extensions/herdr-integration.ts
extensions/guardrails.ts
extensions/steering-choice.ts
extensions/planning-workflow.ts
extensions/orchestration-policy.ts
extensions/orchestration-registry.ts
extensions/orchestration.ts
```

จุดสำคัญคือ `orchestration-policy.ts` อยู่ใน production closureแล้วผ่าน `orchestration.ts` → `orchestration-registry.ts` แม้ไม่ได้อยู่ใน manifestโดยตรง ส่วน command policy/review registry, harness profiles, scoped toolsและ agent-teams profileยังอยู่นอก root closure

Third-party resourcesที่ root manifestโหลดตรง:

- `@juicesharp/rpiv-ask-user-question` — requested range `^2.7.0`, lockfile/installed `2.8.0`
- `@plannotator/pi-extension` — requested range `^0.27.6`, lockfile/installed `0.27.9`
- `typebox` — runtime dependency requested `^1.3.11`, lockfile/installed `1.3.22`
- Pi peer/installed runtimeที่ตรวจ inventory: `@earendil-works/pi-coding-agent 0.84.4`

### Proposed capability ownership

| Target package | Lane | Owned resources | Dependencies/coupling | Proposed status |
|---|---|---|---|---|
| `runtime-mode` | `capabilities/global/` | `worker-mode.ts` และ testsหลัก | sharedโดย dependency updates, steering, planningและ orchestration | stable review candidate |
| `dependency-updates` | `capabilities/global/` | `dependency-update-notifier.ts` | depends `runtime-mode`; ต้องแก้ repository/package root discoveryหลังย้าย | stable review candidate |
| `herdr-integration` | `capabilities/global/` | `herdr-client.ts`, `herdr-integration.ts` | guardrailsและ orchestrationใช้ client; RPIV blocked bridgeเป็น optional event coupling | stable review candidate |
| `safety-guardrails` | `capabilities/global/` | `guardrails.ts` และ manual guardrail tests | depends `herdr-integration`เพื่อ blocked events | stable review candidate |
| `interactive-steering` | `capabilities/global/` | `steering-choice.ts` | depends `runtime-mode` | stable review candidate |
| `planning-continuity` | `capabilities/global/` | `planning-workflow.ts` | depends `runtime-mode`; Plannotatorผ่าน event busและทำงานแบบ unavailableได้ | stable review candidate |
| `structured-questions` | `capabilities/global/` | root adapter/manifest ownershipของ `@juicesharp/rpiv-ask-user-question` | external package; ต้องตัดสิน dependency placementใน workspace | stable third-party candidate |
| `planning-review` | `capabilities/global/` | root adapter/manifest ownershipของ `@plannotator/pi-extension` | external package; planning continuityส่ง eventแบบ optional | stable third-party candidate |
| `ui-themes` | `capabilities/global/` | `cffy-dark`, `cffy-sky`, `modern-dark` | ไม่มี code import | stable review candidate |
| `azure-devops` | `capabilities/project-opt-in/` | Azure extension source, READMEและ tests | `typebox`, project trust/config, PAT/CLI boundary | stable project-opt-in candidate |
| `delegated-orchestration` | `capabilities/incubator/` | `orchestration.ts`, orchestration registry/policy, command policy/review registry, harness profiles, scoped tools, agent-teams profile/profile artifacts/probes และ `herdr-orchestration` Skill | depends `runtime-mode`, `herdr-integration`, `safety-guardrails`; Worker profileยัง unresolved | candidate; production disabled |

ข้อเสนอให้รวม manual Herdr orchestrationและ delegated workไว้ใน `delegated-orchestration` packageเดียวทั้งชุดตาม decisionที่ไม่ split capabilityเพื่อรักษา stable subset ดังนั้น stable root releaseรอบแรกจะไม่มี orchestration tools/skill จน packageนี้ผ่าน promotion gate

### Test ownership

- package-local testsควรย้ายตาม owner
- `worker-mode.test.ts` ปัจจุบันทดสอบ runtime mode, steeringและdependency notifierร่วมกัน จึงเป็น aggregate cross-capability testจนกว่าจะมีเหตุผลให้แยก
- root `tests/` หลัง migrationเก็บ architecture, aggregate integrationและclean-install testsเท่านั้น
- agent-teams runtime/acceptance probesย้ายพร้อม `delegated-orchestration` และยังคง opt-in
- baselineก่อนย้ายผ่าน `142/142`

### Commands, tools and collision surface

Stable candidate commandsที่ตรวจพบใช้ prefixตามข้อกำหนดทั้งหมด:

```text
/mypi-worker-status
/mypi-updates
/mypi-herdr-status
/mypi-herdr-setup
/mypi-continuity
/mypi-azure-devops-config
```

Incubator orchestration commands/toolsและ Azure toolsมี namesไม่ชนกับ stable candidatesที่ตรวจพบ RPIV/Plannotator ownershipยังต้องตรวจ observed package resourcesใน clean-install smokeเพราะ sourceอยู่ใน external dependencies

### Path and digest contracts ที่จะเสียจากการย้าย

1. `dependency-update-notifier.ts` และ `herdr-integration.ts` derive `SETUP_ROOT` จาก parentของ source file; ย้ายเข้า nested packageแล้ว cwdจะไม่ใช่ root aggregate ต้องเปลี่ยนเป็น package/release root contractที่ชัดเจน
2. `agent-teams-profile.ts` derive repository rootและ profile directoryจากตำแหน่งไฟล์; pathใหม่ทำให้ profile discoveryเสีย
3. `worker-boundary.ts` ใช้ relative importsกลับ `extensions/` และคำนวณ repository rootจาก depthคงที่; ต้องเปลี่ยนพร้อม package move
4. `profile.json` pin SHA-256ของ Worker boundary, command policy, scoped toolsและ overlay; source/import path changeทำให้ digestบางรายการเปลี่ยน
5. overlay patchมี trusted boundary hash/contract logic; boundary content changeต้อง regenerate patch digestและ rerun clean apply-check
6. runtime/acceptance probes hardcode repository `profiles/` และ `extensions/` paths
7. testsทั้งหมด import sourceผ่าน `../extensions`, `../local` หรือ `../profiles`
8. root README, capability READMEs, plansและnotesมี historical/current linksจำนวนมาก Historical evidenceต้องคง old commit/path context ส่วน current instructionsต้องเปลี่ยน
9. root third-party manifest entriesอ้าง `./node_modules/...`; nested capability manifestsจะใช้ pathนี้ไม่ได้โดยอัตโนมัติถ้า workspace install/hoistingไม่ตรง ต้องพิสูจน์ด้วย clean install
10. dependency notifierตั้งใจตรวจ root package dependencies การแยก package versionsต้องกำหนดว่าตรวจ aggregateหรือทุก workspace package

### Inventory conclusion

- ทุก tracked extension, skill, theme, profileและ project-opt-in resourceมี proposed capability ownerแล้ว
- ไม่มี untracked project extension/skill sourceที่ต้องย้าย; `.pi/` และ `.agents/` มีเพียง untracked `.DS_Store`
- root production closureและ external resource ownershipถูก enumerateแล้ว
- ยังไม่ย้ายไฟล์จนกว่าผู้ใช้ตรวจ grouping โดยเฉพาะ granularityของ stable global packagesและการรวม orchestrationทั้งชุด

## Implementation phases

### Phase 0 — Freeze decisions and inventory

- [x] ยืนยัน capability packageเป็นหน่วย ownership/deployment
- [x] ยืนยัน `local/` → `capabilities/project-opt-in/`
- [x] ยืนยัน stable-only global releaseและไม่รักษา compatibilityกับ Default working-tree install
- [x] ยืนยันไม่ split capabilityเพื่อช่วย stable subset
- [x] ยืนยัน pinned Git release + isolated development profile
- [x] ยืนยันพัก Worker profileและไม่ย้าย `pi-doc`
- [x] สร้าง complete current resource/import/dependency graph
- [x] จัด proposed capability ownershipและ laneให้ทุก extension/skill/theme/third-party resource
- [x] ระบุ path/hash contracts ที่จะเสียเมื่อย้ายไฟล์
- [ ] ให้ผู้ใช้ตรวจและยืนยัน capability groupingก่อน bulk move

Exit criteria: ไม่มี current global resourceหรือ transitive importที่ยังไม่มี capability ownerและ proposed lane

### Phase 1 — Define package and aggregate contracts

- [ ] สร้าง template/contractสำหรับ capability `package.json` และ README
- [ ] ตัดสิน root npm workspace/dependency layout
- [ ] ตัดสิน root Pi manifest aggregationโดยไม่ auto-discover resourceนอก stable lane
- [ ] เพิ่ม architecture tests:
  - root releaseห้ามโหลด `capabilities/incubator/`
  - root releaseห้ามโหลด `capabilities/project-opt-in/`
  - stable global transitive importsห้ามข้ามไป `capabilities/incubator/`
  - package manifestsต้องอ้าง pathที่มีจริง
  - package/tool/command namesห้ามชนโดยไม่ตั้งใจ
- [ ] กำหนด clean-install smoke harnessด้วย isolated Pi directory

Exit criteria: package skeletonหนึ่งตัวติดตั้ง/testได้จาก clean checkoutและ architecture checks failเมื่อจงใจข้าม boundary

### Phase 2 — Move stable global capabilities

- [ ] ตรวจ stable gateทีละ provisional global capability
- [ ] ย้ายทั้ง capabilityพร้อม source/tests/docsโดยไม่แยก behaviorภายในเพื่อ compatibility
- [ ] แก้ importsและ test paths
- [ ] ตรวจ extension commandsยังใช้ prefix `/mypi-`
- [ ] เก็บเฉพาะ capabilityที่ stableจริงใน root aggregate manifest
- [ ] capabilityที่ไม่ผ่าน gateย้ายหรือคงไว้ใน `capabilities/incubator/` ทั้งชุด

Exit criteria: root stable manifestโหลดเฉพาะ packagesที่มี evidenceครบและ full stable suiteผ่าน

### Phase 3 — Rename and package project opt-ins

- [ ] เปลี่ยน `local/` เป็น `capabilities/project-opt-in/`
- [ ] ย้าย Azure DevOpsเป็น `capabilities/project-opt-in/azure-devops/`
- [ ] เพิ่ม package manifestและจัด extension/tests/docsให้อยู่กับ capability
- [ ] อัปเดต `.pi/settings.json` examplesทั้งหมด
- [ ] ตรวจ project trust, read-only compatibility, opt-in writesและ non-interactive denial
- [ ] ยืนยัน `capabilities/project-opt-in/` packageไม่ถูก root global manifestโหลด

Exit criteria: trusted fixture projectเปิด Azure DevOps packageได้อย่าง explicit และ fixtureที่ไม่ opt inไม่เห็น tools/commandsของ package

### Phase 4 — Consolidate incubator capabilities

- [ ] สร้าง `capabilities/incubator/delegated-orchestration/`
- [ ] ย้าย orchestration/delegated resourcesทั้ง capabilityตาม ownershipที่ inventoryตัดสิน
- [ ] ไม่ split stable manual subsetออกมาเพียงเพื่อ global release
- [ ] ย้าย tests/profiles/probesพร้อม source owner
- [ ] regenerate/update path-bound hashesและ manifestsเฉพาะเมื่อยังต้องใช้ candidate evidence
- [ ] rerun overlay apply-check, profile artifact verification, runtime probesและ acceptanceที่ path movementกระทบ
- [ ] คง production activation disabled

Exit criteria: incubator package self-contained, testsอ้าง owner pathใหม่, root stable releaseไม่มี transitive importเข้ามา

### Phase 5 — Documentation and clean installation

- [ ] อัปเดต root READMEให้แยก `capabilities/global/`, `capabilities/project-opt-in/` และ `capabilities/incubator/` ชัดเจน
- [ ] อัปเดต `docs/README.md` และ historical links
- [ ] อัปเดต install/update/rollback instructions
- [ ] ทดสอบ `npm ci` จาก clean checkout
- [ ] ทดสอบ Pi package discovery/listจาก isolated agent directory
- [ ] ทดสอบ stable startupโดยไม่มี development checkoutบน module resolution path
- [ ] ตรวจ package provenance/versionและ `git diff --check`

Exit criteria: ผู้ใช้ clone exact commitแล้วติดตั้ง stable aggregateได้จากเอกสารโดยไม่พึ่งไฟล์นอก release

### Phase 6 — Pinned Git release

- [ ] เลือก semantic versionแรกหลัง migration
- [ ] ตรวจ working tree, tests, smokeและ release notes
- [ ] สร้าง local release commit/tag
- [ ] ให้ผู้ใช้ตรวจหรืออนุมัติ external push
- [ ] push commit/tagตาม human-only boundary
- [ ] เปลี่ยน Default Pi package sourceเป็น exact Git ref
- [ ] ยืนยัน `pi list` และ runtime source provenance
- [ ] ทดสอบ rollbackไป previous ref
- [ ] ลบ Default local-path working-tree package referenceเมื่อ pinned installพร้อม

Exit criteria: Default Pi โหลด exact remote Git refและการแก้ development working treeไม่เปลี่ยน runtimeหลัง restart/reload

### Phase 7 — Worker profile design handoff

หลัง Phase 1–6 ส่วนที่ทำได้โดยไม่พึ่ง Worker profileเสร็จ:

- [ ] กลับมาหารือ Default/dev/Worker profile topology
- [ ] ตัดสิน exact `PI_CODING_AGENT_DIR`, `HOME`, settings, models, authและ trust provisioning
- [ ] ตัดสิน provider credential boundary
- [ ] สร้าง no-default-fallbackและ sentinel acceptance requirements
- [ ] อัปเดต delegated-autonomy planก่อน production wiring

แผนนี้ไม่ถือว่า Worker profileได้รับการแก้จนกว่าจะมี decisionและ evidenceชุดใหม่

## Stable promotion gate

Capability จะเข้า `capabilities/global/` หรือ `capabilities/project-opt-in/` ได้เมื่อ:

- package boundaryและ ownershipชัด
-ไม่มีส่วนที่รู้ว่าอยู่ระหว่างพัฒนาใน runtime path
- unit/integration testsผ่าน
- risk-appropriate reviewผ่าน
- clean package install/startup smokeผ่าน
- commands/tools/resourcesที่สังเกตจริงตรง manifest
- project/global scopeตรงที่ประกาศ
- configuration migrationและrollbackเขียนไว้
- ไม่มี dependency/importไป `capabilities/incubator/`
- ไม่มี secretหรือmachine-local pathใน committed config
- documentationระบุข้อจำกัดตาม enforcementจริง

Testsผ่านเพียงอย่างเดียวไม่ทำให้ capabilityเป็น released

## Verification matrix

| Area | Static | Automated | Runtime |
|---|---|---|---|
| Capability ownership | inventoryครบ | manifest/path tests | observed resourcesตรง package |
| Global boundary | import graph | forbidden-lane fixtures | Default Piไม่เห็น opt-in/incubator |
| Project opt-in | config docs | trusted/untrusted fixtures | toolsมีเฉพาะ projectที่ opt in |
| Clean release | lockfile/provenance | `npm ci`, full suite | isolated Pi startup |
| Pinned source | tag/commit | source-spec assertions | `pi list`/resource provenance |
| Rollback | previous ref documented | install switch fixture | Default Piกลับรุ่นเดิมได้ |
| Incubator | status/README | root exclusion tests | productionไม่โหลด |

## Risks and cautions

1. **Path-bound hashes:** agent-teams profile, Worker boundaryและ overlayอ้าง path/digestของ source การย้ายไฟล์จะทำ candidate evidenceเดิมไม่ตรง ต้อง regenerateและ re-verify ไม่แก้ hashแบบอัตโนมัติโดยไม่มี review
2. **Package dependency resolution:** nested capabilityอาจดูเหมือนทำงานเพราะพบ root `node_modules`; clean Git installต้องพิสูจน์ dependency contractจริง
3. **Pi local identity:** local package identityอิง resolved absolute path Dev และ stable checkoutอาจถูกโหลดซ้ำถ้าใช้ profileเดียวกัน
4. **Git subdirectory install:** Pi docsไม่ได้รับรอง remote Git subdirectory package install Project opt-inรอบแรกอาจต้องอ้าง stable checkout pathจนกว่าจะมี distribution strategyอื่น
5. **Command/tool collisions:** หลาย capability registerชื่อเดียวกันได้โดย Piเติม suffix ซึ่งอาจซ่อน packaging error ต้องตรวจเป็น failureเว้นแต่ตั้งใจ
6. **Historical links:** ย้าย source/testsจำนวนมากอาจทำ docsและ probe commandsเก่าเสีย ต้องรักษา historical provenanceโดยระบุ old commit ไม่ rewriteหลักฐานเดิมให้เหมือนเกิดที่ pathใหม่
7. **Over-packaging:** ไม่สร้าง packageเล็กเกินจน shared behaviorไม่มี owner; groupingยึด capabilityและ deployment boundary ไม่ยึดจำนวนไฟล์
8. **Worker isolationยังเปิด:** packagingไม่แก้ Default profile accessของ Worker ห้ามตีความ release migrationเป็น security acceptance
9. **External mutation:** push/tagและเปลี่ยน Default settingsเป็น human-only boundary ต้องเตรียม evidenceก่อนขอ action

## Open questions

| Question | Starting position |
|---|---|
| root packageใช้ npm workspacesหรือไม่ | ประเมินจาก clean installและ dependency ownershipก่อนย้ายจริง |
| themesเป็น capabilityเดียวหรือ resourceของ UI capability | ตัดสินใน inventory |
| third-party RPIV/Plannotatorอยู่ packageใด | capability ownerต้องตรง behaviorและ scope; ห้ามโหลดเพียงเพราะเป็น root dependency |
| `capabilities/project-opt-in/` distributionข้ามเครื่อง | เริ่มจาก stable checkout path; ประเมิน npm/separate Git packageภายหลัง |
| package version syncกันหรือแยก | root releaseมี version; capability versionเริ่มแยกเฉพาะเมื่อมี independent lifecycleจริง |
| Agent Plugins compatibility | พักจนมี separate evaluation |
| Worker profile/auth | พักจน Phase 7 discussion |

## Progress log

### 2026-08-30 — Plan created

- ยืนยัน stable-only releaseโดยไม่รักษา Default working-tree consumers
- ยืนยัน capability packageสำหรับ extension/skillทั้งหมด
- ยืนยันไม่ split mixed capabilityเพื่อรักษา stable subset
- ยืนยัน `capabilities/project-opt-in/`, `capabilities/incubator/`, pinned Git releaseและ dev profile separation
- พัก `pi-doc` migration, Agent Plugins adoptionและ Worker profile decisions
- บันทึก Worker Default-profile fallbackเป็น blockerก่อน delegated production activation

### 2026-08-30 — Capability lanesรวมใต้ rootเดียว

- ยืนยันให้ global, project opt inและ incubatorอยู่ใต้ `capabilities/` ทั้งหมด
- semantic lanesคือ `capabilities/global/`, `capabilities/project-opt-in/` และ `capabilities/incubator/`
- `lab/`, `docs/` และ aggregate testsยังอยู่นอก capability root

### 2026-08-30 — Phase 0 inventory complete

- enumerate root manifestและ local transitive production closureครบ
- map tracked resourcesเป็น stable global candidates 9 packages, project-opt-in Azure package 1 และ incubator delegated-orchestration package 1
- ระบุ cross-capability dependencies, aggregate tests, external package ownershipและ path/digest contractsแล้ว
- baseline full suiteผ่าน `142/142`
- ยังไม่ย้ายไฟล์; รอผู้ใช้ยืนยัน groupingตาม Phase 0 gate

## Exact next action

ให้ผู้ใช้ตรวจ proposed capability ownershipใน Phase 0 inventory โดยเฉพาะ:

1. stable global granularity: แยก `runtime-mode`, `dependency-updates`, `herdr-integration`, `safety-guardrails`, `interactive-steering`, `planning-continuity`, `structured-questions`, `planning-review`, `ui-themes`
2. รวม manual Herdr orchestration + delegated policy/profile/probes + orchestration Skillเป็น `capabilities/incubator/delegated-orchestration/` ทั้งชุด
3. Azure DevOpsเป็น `capabilities/project-opt-in/azure-devops/`

เมื่อ groupingได้รับการยืนยัน ให้ทำ Phase 1 package/workspace/aggregate contractและ architecture testsก่อน bulk move

ห้าม production-wire delegated Workers, ย้าย `pi-doc`, push tagหรือเปลี่ยน Default Pi settingsในขั้นนี้
