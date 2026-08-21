# ทิศทางพัฒนา Pi โดยเรียนรู้จาก OMP

> **Status:** อยู่ระหว่างวิเคราะห์<br>
> **Created:** 2026-08-21 09:43<br>
> **Updated:** 2026-08-21 09:43<br>
> **Purpose:** สรุปโจทย์ ข้อสังเกต และทางเลือกสำหรับพัฒนา Pi ให้ได้ code intelligence และ TUI ที่ดีขึ้น โดยยังรักษาการควบคุม context เป็นแกนหลัก

## Executive summary

ผู้ใช้ให้คุณค่ากับ Pi มากที่สุดตรงที่สามารถควบคุมและตรวจสอบ context ที่ส่งเข้า LLM ได้ ขณะเดียวกันยอมรับว่า context management, compaction และ memory เป็นสิ่งจำเป็น เพราะ context window มีขีดจำกัด ความกังวลจึงไม่ใช่ว่า “ไม่ควรมี automation” แต่เป็น:

1. ระบบ context/compaction/memory ของ Oh My Pi (OMP) มีคุณภาพดีเพียงใด
2. หากใช้ Pi แล้วเพิ่ม governance และ memory เอง จะให้ผลดีกว่า OMP หรือเพียงสร้างภาระ maintenance
3. feature ใดควรพัฒนาเอง และ feature ใดควรใช้ package หรือ implementation ที่มีอยู่

ข้อสรุปชั่วคราวคือ **เอนมาทางใช้ Pi เป็นแกนหลัก** แล้วเพิ่มเฉพาะส่วนที่ต้องการ โดยไม่พยายามสร้าง OMP clone:

- ใช้ Pi session/context/compaction engine เดิม
- สร้าง context-governance layer บาง ๆ เฉพาะ policy และ observability ที่ต้องการ
- ใช้ package/adapter สำหรับ LSP, AST และ DAP แทนเขียน protocol ใหม่
- ใช้ tmux/Herdr/worktrees สำหรับ multi-agent orchestration
- ทำ OMP-inspired TUI เป็น Pi extension/theme ก่อนพิจารณา fork หรือ standalone UI
- ใช้ OMP เป็น reference implementation และ A/B baseline

## เป้าหมายและคุณค่าหลัก

### สิ่งที่ต้องรักษาจาก Pi

- เข้าใจได้ว่า context ประกอบจากอะไร
- ตรวจ session tree และ compaction entries ได้
- เลือกได้ว่า compaction จะเกิดเมื่อไร
- สามารถ inspect หรือแทรกแซงก่อน provider request
- extension และ package surface ยังเป็นของ Pi โดยตรง
- ไม่เพิ่ม autonomous memory หรือ context transformation โดยไม่จำเป็น

### Feature จาก OMP ที่น่าสนใจ

1. เครื่องมือแก้ไขและค้นหาโค้ด
2. LSP และ IDE intelligence
3. Debugger ผ่าน DAP
4. TUI และ interaction design

### Feature ที่มีทางเลือกอื่นอยู่แล้ว

- **Subagents:** ใช้ tmux, Herdr และ worktrees อาจโปร่งใสกว่า เพราะแต่ละ agent มี process/session/context แยกและส่งต่องานผ่าน artifact ที่ตรวจได้
- **Orchestration:** สามารถสร้าง convention หรือ integration เพิ่มเองได้โดยไม่จำเป็นต้องอยู่ใน agent harness
- **Browser:** ติดตั้ง Pi extension หรือ MCP เพิ่มเฉพาะเมื่อใช้
- **MCP:** ใช้ `pi-mcp-adapter` และเปิด capability ตามงาน

## กรอบคิดเรื่อง context

Context management ควรแยกเป็นสี่ชั้น ไม่ควรรวมทุกอย่างเป็น automation ก้อนเดียว:

| ชั้น | หน้าที่ |
|---|---|
| Working context | system prompt, messages, tools และ tool results ที่ส่งใน request ปัจจุบัน |
| Compaction | ลด working context เมื่อเข้าใกล้ context window |
| Session continuity | เก็บสถานะเพื่อ resume, branch หรือเริ่ม session ใหม่ |
| Durable memory | เก็บความรู้ การตัดสินใจ และบทเรียนข้าม sessions |

การแยกชั้นช่วยกำหนด authority และ lifecycle ได้ชัด เช่น transcript เป็นหลักฐาน, compaction summary เป็น derived artifact และ durable decision ต้องผ่าน explicit promotion ก่อนถือเป็น source of truth

## ประเมิน context และ compaction ของ OMP

### จุดแข็ง

OMP v17.4.0 มี implementation เชิง engineering ที่ลึก ไม่ใช่เพียง wrapper รอบ summary prompt:

- provider-native compaction
- overflow และ incomplete-output recovery
- automatic threshold และ mid-turn maintenance
- speculative/async compaction
- strategy fallback หลายแบบ
- recent-token protection
- tool-output pruning
- file-operation tracking
- compaction entries, handoff และ artifacts
- transcript display ที่ยังเปิดดู summary ได้
- prompt-cache-aware behavior บางส่วน

ลำดับ strategy ค่าเริ่มต้นคือ:

```text
remote → snapcompact → handoff → shake → soft
```

ความหมายโดยย่อ:

- `remote` — ใช้ provider-native compaction
- `snapcompact` — serialize ประวัติและ render เป็น bitmap สำหรับ vision model
- `handoff` — ให้ model สร้าง handoff document แล้วใช้เป็น compaction entry
- `shake` — ลด content แบบ local และแทน block ขนาดใหญ่ด้วย artifact reference
- `soft` — ใช้ LLM สร้าง summary แบบดั้งเดิม

ระบบนี้เหมาะกับ autonomous long-running agent เพราะมี fallback และ recovery มาก

### จุดอ่อนและความเสี่ยง

- คำว่า compaction อาจหมายถึง transformation หลายแบบ ทำให้วิเคราะห์ regression ยาก
- display transcript ไม่จำเป็นต้องเท่ากับ model-visible context
- tool-result pruning บางชนิดอาจแทนข้อมูลเดิมด้วย placeholder หรือ artifact reference
- ค่าเริ่มต้นเปิด async, mid-turn, auto-continue, superseded-read pruning และ useless-result elision
- OMP เน้น autonomy มากกว่า explicit human approval ของ context transformation
- benchmark ของ snapcompact และ edit behavior ส่วนใหญ่เป็น project-reported evidence ยังไม่มี independent controlled benchmark เพียงพอ

ข้อสรุปคือ **OMP compaction มีความสามารถสูง แต่ predictability ต่ำกว่า Pi baseline** ไม่ควรสรุปว่าไม่ดี เพียงแต่ policy เริ่มต้นอาจไม่ตรงกับ workflow ที่ต้องการ inspectability

## ประเมิน Memory ของ OMP

OMP memory มี guardrails ที่สมเหตุสมผล:

- `memory.backend: off` เป็นค่าเริ่มต้น
- local memory แยกตาม project
- `/memory view` ดู injection payload ได้
- summary และ lessons ใช้ injection budget ร่วมกันประมาณ 5,000 tokens โดย default
- มี secret-pattern redaction
- แยก `MEMORY.md`, compact summary, lessons และ generated skills
- extraction และ consolidation แยกเป็นสอง phase

ความเสี่ยงหลักอยู่ที่ semantics มากกว่า storage mechanism เพราะ model อาจจำสิ่งต่อไปนี้ผิดประเภท:

- discussion ที่ยังไม่ตัดสินใจถูกจำเป็น decision
- workaround ชั่วคราวถูกจำเป็น architecture
- state จาก branch ที่ยกเลิกแล้วถูกจำเป็น current state
- inference ถูกจำเป็น fact

แนวทางที่เข้ากับ workspace นี้มากกว่าคือ **explicit memory promotion**:

```text
session transcript
      ↓
candidate lesson / finding / decision
      ↓
review หรือ explicit approval
      ↓
AGENTS.md / .workbench / decision / runbook / skill
```

Memory ที่ inject ควรมี scope, provenance, token budget และ precedence ชัดเจน โดย repo state กับ user instruction ต้องชนะ derived memory เสมอ

## Pi เป็นฐานสำหรับ context governance

Pi มีฐานที่จำเป็นอยู่แล้ว:

- append-only session tree
- context usage tracking
- auto/manual compaction
- `reserveTokens` และ `keepRecentTokens`
- structured compaction summary
- `/compact <instructions>`
- `session_before_compact` สำหรับ cancel หรือแทน summary
- `context` event สำหรับ inspect/modify messages
- `before_agent_start` สำหรับ inspect system prompt inputs
- `before_provider_request` สำหรับ inspect หรือแทน provider payload ขั้นสุดท้าย
- session branching, labels และ custom entries

ดังนั้นไม่ควร reimplement token accounting, provider serialization, overflow recovery หรือ session tree ใหม่ สิ่งที่ควรสร้างคือ **thin context governor** เช่น:

```text
/mypi-context-inspect
/mypi-context-manifest
/mypi-context-checkpoint
/mypi-compact-preview
/mypi-compact-accept
/mypi-compact-reject
/mypi-context-new-session
```

ชื่อจริงต้องใช้ prefix `/mypi-` ตามกติกา workspace

Context governor อาจทำงานดังนี้:

1. แสดง context usage และ budget allocation
2. แสดง manifest ของ system prompt, context files, skills, tools และ message ranges
3. เมื่อถึง threshold ให้ผู้ใช้เลือก continue, draft compaction, checkpoint หรือ new session
4. สร้าง draft summary โดยยังไม่ commit
5. ให้ตรวจ/แก้ summary ก่อน append compaction entry
6. เก็บ audit metadata ว่า summary มาจากช่วงใด ใช้ model ใด และ retain entry ตั้งแต่จุดใด

การพัฒนาชั้นนี้มีแนวโน้มคุ้มกว่าการสร้าง compaction engine ใหม่ทั้งหมด

## Build vs reuse

### ควรใช้ของ Pi เดิม

- session persistence และ tree
- provider/model integration
- context usage และ token accounting
- baseline compaction
- retry/overflow handling
- extension lifecycle และ provider-payload hooks

### ควรสร้างเองเฉพาะ policy

- context manifest และ inspection UI
- compact preview/approval workflow
- deterministic context-selection policy
- explicit checkpoint/handoff
- memory promotion และ precedence
- context budget allocation

### ควร reuse package หรือ protocol adapter

- language servers และ LSP client libraries
- `ast-grep` หรือ structural-search engine
- DAP adapters และ debug protocol libraries
- browser integration
- MCP adapter

ไม่ควรเขียน LSP, DAP หรือ AST engine ใหม่ หากมี implementation ที่ดูแลดีอยู่แล้ว ให้เขียน Pi extension เป็น adapter และเปิด tools แบบ on-demand เพื่อลด tool-schema/context cost

## แนวทาง Code Intelligence

ควรพิจารณา Pi package เดียวที่รวม capability แต่เปิดใช้เป็นกลุ่ม:

```text
pi-code-intelligence
├── LSP
│   ├── diagnostics
│   ├── symbols
│   ├── definitions
│   ├── references
│   ├── rename
│   └── code actions
├── AST
│   ├── structural search
│   ├── preview rewrite
│   └── apply rewrite
└── DAP
    ├── launch / attach
    ├── breakpoints
    ├── step / continue
    ├── stack / scopes / variables
    └── evaluate
```

แนวทางเปิด tool:

```text
/mypi-lsp-on
/mypi-ast-on
/mypi-debug-on
```

หรือใช้ loader tool ตัวเดียวแล้ว activate tools แบบ additive เฉพาะเมื่อจำเป็น เพื่อรักษา prompt prefix และลดจำนวน tool schemas ที่ LLM เห็น

## External multi-agent และ orchestration

การใช้ tmux/Herdr/worktrees มีข้อดีสำหรับเป้าหมายนี้:

- แต่ละ agent มี independent session และ context
- transcript เปิดตรวจได้ตรง ๆ
- เลือก harness/model ต่างกันได้
- process และ worktree boundaries ชัดกว่า in-process subagent
- handoff ผ่าน Markdown หรือ patch ที่มนุษย์แก้ได้

ข้อเสียคือไม่มี fan-out/fan-in, structured child output, token accounting และ Agent Hub แบบพร้อมใช้ จึงอาจต้องมี convention หรือ integration บางส่วน เช่น task manifest, result file และ status collector

External orchestration ไม่ใช่ OS security boundary โดยตัวมันเอง หาก trust level ต่างกันยังต้องใช้ container, VM หรือ dedicated OS user

## OMP-inspired TUI สำหรับ Pi

### สิ่งที่ทำได้ผ่าน Pi extension/theme

| ส่วน UI | ความยาก | Pi API |
|---|---:|---|
| palette และสี | ต่ำ | custom theme JSON |
| header/welcome | ต่ำ | `ctx.ui.setHeader()` |
| footer/status | ต่ำ | `ctx.ui.setFooter()`, `setStatus()` |
| working spinner | ต่ำ | `setWorkingIndicator()` |
| editor border/style | ปานกลาง | extend `CustomEditor` |
| widgets รอบ editor | ต่ำ | `setWidget()` |
| terminal title | ต่ำ | `setTitle()` |
| Markdown display | ปานกลาง | `registerMarkdownTransformer()` |
| custom tool call/result | ปานกลาง | `renderCall` / `renderResult` |
| dialogs/overlays | ปานกลาง | `ctx.ui.custom({ overlay: true })` |
| user/assistant renderer ทั้งระบบ | สูง | public extension API ยังแทน core renderer ไม่ครบ |
| transcript layout/scroll engine | สูง | ต้องแก้ InteractiveMode/core หรือทำ standalone UI |

### เหตุผลที่ไม่ควร import OMP TUI ทั้งก้อน

OMP มีสองชั้น:

```text
@oh-my-pi/pi-tui
└── generic terminal components

@oh-my-pi/pi-coding-agent/src/modes/components
└── OMP-specific footer, editor, messages, tool rows, selectors และ Agent Hub
```

OMP-specific components ผูกกับ OMP `AgentSession`, settings, model roles, tools, Bun runtime, `@oh-my-pi/pi-agent-core`, `pi-utils` และ native packages ขณะที่ Pi ใช้ `@earendil-works/*` บน Node.js การ import ตรงเสี่ยงเกิด TUI runtime สองชุด, type/keybinding/theme divergence และ upgrade breakage

แนวทางที่เหมาะกว่าคือสร้าง package เช่น:

```text
pi-omp-ui/
├── package.json
├── extensions/
│   ├── index.ts
│   ├── header.ts
│   ├── footer.ts
│   ├── editor.ts
│   ├── working-indicator.ts
│   └── tool-renderers.ts
└── themes/
    └── omp.json
```

ใช้ source ของ OMP เป็น visual/reference implementation แล้ว port เฉพาะ rendering logic ให้ใช้ `@earendil-works/pi-tui`

### ทางเลือกหากต้องการ UI ใกล้ OMP ทั้งระบบ

1. **Fork Pi InteractiveMode** — integration กับ Pi session/extensions ดีกว่า แต่ต้อง rebase ตาม Pi releases
2. **Standalone TUI หน้า Pi RPC** — แยก UI กับ agent process ชัด และอาจใช้ `@oh-my-pi/pi-tui` ผ่าน Bun ได้ แต่ต้องสร้าง transcript/controller เอง และ Pi extension UI บางชนิดไม่ทำงานใน RPC
3. **Custom application ผ่าน Pi SDK** — type-safe และเข้าถึง `AgentSession` โดยตรง แต่ต้องเป็นเจ้าของ UI lifecycle และ compatibility เอง

ควรเริ่มจาก extension skin เพราะได้ส่วนที่เห็นตลอดเวลาโดยไม่เปลี่ยน context engine และถอดกลับได้ง่าย

### License

OMP ใช้ MIT License จึง port หรือดัดแปลง source ได้ แต่หาก copy substantial portions ต้องเก็บ MIT license และ copyright notices ของ Mario Zechner, Can Bölük และ Stencil Labs, Inc. ควรอ้างอิง repository/tag ที่ pin ไว้ ไม่ควรแก้หรือพึ่ง source ใต้ Bun global install โดยตรง

## สถาปัตยกรรมเป้าหมายที่เสนอ

```text
Pi core
│
├── Existing session/context/compaction engine
│
├── Context Governor
│   ├── manifest และ provider-payload inspection
│   ├── context budget
│   ├── compact preview/approval
│   ├── explicit checkpoint/handoff
│   └── memory promotion
│
├── Code Intelligence package
│   ├── LSP
│   ├── AST search/edit
│   └── DAP
│
├── OMP-inspired UI package
│   ├── theme
│   ├── header/footer
│   ├── editor/working indicator
│   └── selected tool renderers
│
├── Optional integrations
│   ├── browser
│   └── MCP
│
└── External orchestration
    └── tmux / Herdr / worktrees / explicit handoff
```

## วิธีประเมินก่อนลงทุนพัฒนา

ควร A/B test อย่างน้อยสามโหมดโดยใช้ model, repository และ task เดียวกัน:

| Mode | Configuration |
|---|---|
| A | Pi stock compaction |
| B | Pi + governed/manual compaction + explicit memory |
| C | OMP default compaction โดยปิด memory และ subagents ก่อน |

เปิด OMP memory เป็น mode แยกภายหลัง เพื่อไม่ให้ compaction, memory และ orchestration เป็นตัวแปรพร้อมกัน

Metrics ที่ควรวัด:

- requirement/constraint retention หลัง compaction
- decision ที่ถูกยกเลิกแล้วยังถูกนำมาใช้ผิดหรือไม่
- ความเข้าใจ file/repo state หลัง context transformation
- task success หลัง compaction
- จำนวน human corrections
- input tokens, cache hit และ quota
- เวลาในการ resume และ crash recovery
- auditability ว่า context แต่ละส่วนมาจากไหน

สำหรับ TUI ให้จับภาพ Pi และ OMP ในสถานะเดียวกันอย่างน้อย:

1. idle/new session
2. streaming assistant response
3. tool กำลังทำงาน
4. tool สำเร็จและแสดง diff/output
5. context ใกล้ threshold หรือเกิด compaction
6. model/session selector

จากนั้นทำ component inventory ว่าส่วนใดแก้ด้วย theme, extension API หรือจำเป็นต้องแก้ core

## Working decisions

- Context management, compaction และ memory เป็นสิ่งจำเป็น ไม่ใช่ feature ที่ควรปิดทิ้งถาวร
- OMP context implementation มี engineering depth สูง แต่ default policy เน้น autonomy มากกว่า explicit governance
- ยังไม่ควร reimplement compaction/session/provider engine ของ Pi
- หากเลือก Pi ให้สร้างเพียง context-governance layer ที่บางและวัดผลได้
- ใช้ package หรือ protocol implementation ที่มีอยู่สำหรับ LSP, AST, DAP, browser และ MCP
- ใช้ external orchestration แทน in-process subagents ก่อน หากตอบโจทย์ transparency และ isolation ดีกว่า
- เอนมาทาง Pi เป็น primary แต่ยังใช้ OMP เป็น reference และ A/B baseline
- สำหรับ TUI ให้เริ่มจาก OMP-inspired theme/extension ไม่ import OMP coding-agent components ตรงและยังไม่ fork core

## Open questions

### Context

- ต้องการ inspect แค่ message-level context หรือ exact provider payload ทุก request
- compaction แบบใดต้องมี human approval และกรณี overflow อนุญาต auto-recovery ได้หรือไม่
- ต้องการ preview summary แล้ว accept/reject หรือให้ auto-compact พร้อม audit log ก็เพียงพอ
- durable memory จะเก็บที่ระดับ project, global หรือทั้งสอง และใครมีสิทธิ์ promote
- tool output ใดตัดหรือแทน artifact reference ได้โดยไม่ลดคุณภาพ

### Code intelligence

- มี Pi packages สำหรับ LSP, AST หรือ DAP ตัวใดที่ควรประเมินก่อนสร้างใหม่
- ภาษาและ language servers ใดเป็น priority
- ต้องการ read-only intelligence ก่อน หรือรวม rename/code-action/write ตั้งแต่รุ่นแรก
- DAP ควรเป็น persistent debug session หรือ stateless commands

### TUI

- ส่วนใดของ OMP ที่ผู้ใช้ชอบมากที่สุด: palette, spacing, editor, footer, tool rows, selectors หรือ transcript layout
- ต้องการ visual similarity หรือ interaction parity
- custom user/assistant message framing สำคัญพอที่จะเสนอ extension point ใหม่ให้ Pi upstream หรือไม่
- ต้องรองรับ Pi third-party extensions และ `ctx.ui.custom()` ครบเพียงใด

### Orchestration

- tmux/Herdr ต้องมี task manifest, status aggregation และ result collector ระดับใด
- handoff ระหว่าง agents ควรเป็น Markdown, patch, structured JSON หรือผสมกัน

## Suggested next discussion

1. ระบุภาพหน้าจอ/interaction ของ OMP ที่ต้องการเลียนแบบ
2. ทำ inventory packages ปัจจุบันและค้นหา LSP/AST/DAP extensions ที่มีอยู่
3. กำหนด context-governance requirements และ non-goals
4. ออกแบบ A/B benchmark ก่อน implementation
5. แบ่งงานเป็นสาม package อิสระ: context governor, code intelligence และ UI skin
6. เลือก quick-win package แรกโดยหลีกเลี่ยงการแก้ Pi core

## References

### Pi ที่ตรวจ

- `@earendil-works/pi-coding-agent` v0.84.2
- `docs/compaction.md`
- `docs/extensions.md`
- `docs/tui.md`
- `docs/themes.md`
- `docs/rpc.md`
- `docs/sdk.md`
- `examples/extensions/custom-header.ts`
- `examples/extensions/custom-footer.ts`
- `examples/extensions/rainbow-editor.ts`
- `examples/extensions/working-indicator.ts`

### OMP ที่ตรวจ

- `@oh-my-pi/pi-coding-agent` v17.4.0
- <https://github.com/can1357/oh-my-pi>
- `docs/compaction.md`
- `docs/memory.md`
- `packages/tui/`
- `packages/coding-agent/src/modes/components/`

## Change log

- 2026-08-21 09:43 — สรุปการสนทนาเรื่อง context governance, OMP compaction/memory, Pi build-vs-reuse, code intelligence, external orchestration และ OMP-inspired TUI เพื่อส่งต่องานมาที่ workspace นี้
