# ทิศทางพัฒนา Pi โดยเรียนรู้จาก OMP

> **Status:** อยู่ระหว่างวิเคราะห์<br>
> **Created:** 2026-08-21 09:43<br>
> **Updated:** 2026-08-21 15:46<br>
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

ควรรวม capability ในระดับ distribution หรือ monorepo แต่แยก runtime extension ตาม lifecycle แล้วเปิดใช้เป็นกลุ่ม:

```text
pi-code-intelligence
├── loader                 # activate capability แบบ additive
├── pi-lsp                 # long-lived process และ indexing
│   ├── diagnostics
│   ├── symbols
│   ├── definitions
│   ├── references
│   ├── rename
│   └── code actions
├── pi-ast                 # stateless structural search
│   ├── structural search
│   ├── preview rewrite
│   └── apply rewrite
└── pi-debug               # stateful debug session; optional
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

### ผลค้นคว้าและ benchmark รุ่นแรก

กำหนด scope รุ่นแรกเป็น TypeScript/JavaScript, read-only และทดลอง package ที่มีอยู่ก่อนสร้างเอง โดยเก็บ fixture และผลชั่วคราวที่ `.runtime/code-intelligence-benchmark/` ไม่ติดตั้ง package ลง workspace แบบถาวร

| Package | ผลทดลอง | ข้อสรุป |
|---|---|---|
| `pi-ast-grep@0.1.0` | ผ่านโดยไม่แก้ package; structural search ถูกต้อง; cold ประมาณ 816 ms และ warm ประมาณ 8 ms | ใช้เป็น AST MVP แบบ on-demand ได้ |
| `pi-lsp-adapter@0.1.3` | navigation ถูกต้องหลัง VTSLS พร้อม; lifecycle, trust, pagination และ cleanup ดี | เหมาะเป็น runtime base แต่ diagnostics cold-start มี correctness bug |
| `lsp-pi@1.0.5` | clean install โหลดไม่ได้จาก import `vscode-languageserver-protocol/node.js`; หลัง patch เป็น `/node` ผล warm ถูกต้องและกระชับ | ใช้เป็น reference ด้าน compact API/output มากกว่าฐาน runtime |
| `pi-lsp@0.1.7` | navigation ถูกต้องเมื่อ warm แต่ส่ง raw LSP JSON และ diagnostics อ่าน cache เท่านั้น | มี declarative config/trust ที่น่าสนใจ แต่ไม่เหมาะใช้ตรงสำหรับ governed read-only MVP |
| `@narumitw/pi-lsp@0.49.5` | diagnostics ถูกต้องตั้งแต่ call แรกประมาณ 3–3.5 วินาที; start/stop server ทุก call | ใช้เป็น reference สำหรับ push/pull diagnostics, settle และ grace policy; ไม่มี navigation |

Tool surface ที่วัดจาก name, description, parameters, prompt snippets และ guidelines โดยประมาณ:

| Package | Tools | Surface characters |
|---|---:|---:|
| `lsp-pi` หลัง patch | 1 | 1,614 |
| `@narumitw/pi-lsp` | 2 | 2,147 |
| `pi-lsp` | 5 | 2,564 |
| `pi-lsp-adapter` | 7 | 5,183 |
| `pi-ast-grep` | 1 | 2,908 |

ตัวเลขเป็น single-run บน fixture เล็ก ใช้วิเคราะห์ behavior และ context surface ไม่ใช่ performance benchmark ขั้นสุดท้าย

### Root cause ของ diagnostics false-negative

instrument VTSLS จริงพบ timeline:

```text
didOpen                 t + 0 ms
first tool result       t + 477 ms    "No LSP diagnostics"
publishDiagnostics      t + 2,886 ms  TS2322 จำนวน 1 รายการ
```

`pi-lsp-adapter` รอคงที่เพียง `diagnosticsWaitMs = 350` ms และ `getDiagnostics(uri)` คืน `[]` ทั้งเมื่อ server publish ผลว่างแล้วและเมื่อยังไม่เคย publish ทำให้สถานะสองชนิดถูกรวมกัน

ไม่ควรเรียกสถานะว่า `ready` หรือ `indexing` จนกว่าจะ track `$/progress` เพราะ diagnostic publication แรกไม่ได้รับประกันว่า workspace indexing เสร็จทั้งหมด สถานะที่มีหลักฐานรองรับกว่าคือ:

```text
awaiting-publication
published-empty
published-with-diagnostics
timed-out
```

### กลยุทธ์ Upstream-first

upstream `pi-lsp-adapter` main ตรงกับ npm `0.1.3`, baseline ผ่าน 214 tests กับ 2 skipped รวมทั้ง typecheck และ lint และเคยรับ external PR แล้ว จึงให้เริ่มจาก issue/PR ขนาดเล็กแทน fork

ลำดับที่เสนอ:

1. correctness — แยก no-publication ออกจาก explicit empty publication; invalidate freshness เมื่อ `didOpen`/`didChange`; pending/timeout ห้าม format เป็น clean
2. bounded waiting — รอ publication ของ document state ปัจจุบัน, ใช้ publication sequence, เพิ่ม timeout และพิจารณา pull diagnostics เมื่อ server advertise capability
3. context efficiency — format path ให้ relative และเก็บ absolute path เฉพาะ structured details เมื่อจำเป็น
4. dynamic-loading compatibility — ไม่ inject LSP paragraph ใน `before_agent_start` เมื่อ LSP tools ทั้งหมด inactive

local loader เช่น `mypi_code_intelligence_load` เป็น workspace policy จึงไม่จำเป็นต้อง upstream

### Draft upstream issue

ยังไม่เปิด issue ภายนอกและยังไม่แก้ upstream ตามการตัดสินใจให้เก็บ draft ไว้ก่อน

**Title**

```text
lsp_diagnostics can report a false clean result before publishDiagnostics arrives
```

**Body draft**

```text
On a cold VTSLS start, lsp_diagnostics can return “No LSP diagnostics”
before the server has published diagnostics for the opened document.

Environment:
- pi-lsp-adapter 0.1.3
- Pi 0.84.2
- VTSLS 0.3.0
- TypeScript 6.0.3
- Node.js 24.15.0
- macOS

Observed timeline:
- didOpen: t0
- first tool result: t0 + ~477 ms (“No LSP diagnostics”)
- publishDiagnostics: t0 + ~2,886 ms (TS2322)

The current default diagnosticsWaitMs is 350 ms, and getDiagnostics()
returns [] both when no publication has arrived and when an explicit empty
publication has arrived.

Expected:
The tool should never report a clean result before receiving a diagnostic
publication for the current document state. It should either wait within a
bounded timeout or return an explicit awaiting-publication/timeout state.

I can submit a focused PR with deterministic delayed-publication tests.
```

### MVP ชั่วคราวก่อน upstream fix

- ใช้ `pi-ast-grep` แบบ read-only และ on-demand
- ใช้ `pi-lsp-adapter` เฉพาะ hover, definition, references, document/workspace symbols และ pagination
- ปิด `lsp_diagnostics` ชั่วคราว และถือ `tsc` หรือ repository-native typecheck เป็น authoritative validation
- ให้ local loader activate tools แบบ additive; ยอมรับ prompt-prefix invalidation หนึ่งครั้งหาก third-party tools ยังมี active-only prompt metadata

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
- สำหรับ code intelligence รุ่นแรก เลือก TypeScript/JavaScript และ read-only; ใช้ `pi-ast-grep` เป็น AST baseline
- ใช้ Upstream-first กับ `pi-lsp-adapter`; ยังไม่ fork และยังไม่เปิด diagnostics จนกว่า no-publication จะแยกจาก clean result
- แยก LSP, AST และ DAP เป็น runtime extensions ต่างกันภายใต้ distribution/monorepo เดียว เพราะ lifecycle ต่างกัน
- ใช้ external orchestration แทน in-process subagents ก่อน หากตอบโจทย์ transparency และ isolation ดีกว่า
- เอนมาทาง Pi เป็น primary แต่ยังใช้ OMP เป็น reference และ A/B baseline
- สำหรับ TUI ให้เริ่มจาก OMP-inspired theme/extension ไม่ import OMP coding-agent components ตรงและยังไม่ fork core

## งานวิเคราะห์และทดสอบก่อน implementation

ไม่จำเป็นต้องทำทุกเรื่องก่อนเริ่ม quick win แต่ diagnostics contract ต้องชัดก่อนเปิด `lsp_diagnostics` ให้ใช้งานจริง

1. **Diagnostics semantics** — เก็บ publication timeline ของ cold clean, cold error, clean → error, error → clean, concurrent files และ no-publication; ห้ามสมมติว่า first empty publication คือผลสุดท้าย
2. **Language-server comparison** — เทียบ VTSLS กับ `typescript-language-server` บน fixture และ repository ขนาดกลางที่มี TSX, aliases, project references และ workspace packages
3. **Exact context cost** — วัด provider payload ก่อน/หลัง activate AST, LSP navigation และ diagnostics รวมถึงผลต่อ prompt prefix, compaction และ session resume
4. **Lifecycle/trust failures** — ทดสอบ crash, timeout, cancellation, shutdown, stale results, symlink, path นอก workspace, untrusted workspace และ orphan processes
5. **Output contract** — กำหนด relative path, structured state, pagination/truncation และแยก clean, pending, timeout กับ unavailable ให้ชัด
6. **AST edge cases** — ทดสอบ TS/JS/TSX, syntax error, ignore rules, symlink, invalid query, large result และยืนยัน read-only surface
7. **Dependency viability** — ตรวจ clean install, Node/ESM compatibility, server pinning, license, release cadence และ upstream responsiveness

เกณฑ์ขั้นต่ำก่อนเปิด diagnostics ใน MVP:

- ไม่คืน false clean หรือ stale diagnostics
- timeout และ no-publication แสดงเป็น inconclusive state
- navigation ให้ผลถูกต้องข้าม package
- inactive tools ไม่เพิ่ม schema/guidance ใน provider payload
- shutdown แล้วไม่มี server process หรือ waiter ค้าง

## Short-cycle candidates

เวลาเป็นประมาณการหยาบสำหรับการทดลองหรือ implementation ขนาดเล็กหนึ่งรอบ โดยยังไม่รวม review จาก upstream

| ID | หัวข้อ | ลักษณะ | เวลาโดยประมาณ | ผลลัพธ์ |
|---|---|---|---:|---|
| Q1 | ทำ AST edge-case matrix | ทดสอบเท่านั้น | 30–60 นาที | ยืนยันว่า `pi-ast-grep` พร้อมเป็น read-only MVP |
| Q2 | เก็บ diagnostics timeline matrix | instrumentation/ทดสอบ | 1–2 ชั่วโมง | รู้ว่า first publication/empty result เชื่อถือได้เพียงใด |
| Q3 | วัด exact context surface | disposable Pi probe | 1–2 ชั่วโมง | snapshot tool schemas และ prompt ก่อน/หลัง activation |
| Q4 | สรุป LSP output contract | วิเคราะห์/API sketch | 30–60 นาที | รูปแบบ relative path, state, pagination และ error ที่ตกลงร่วมกันได้ |
| Q5 | ทำ OMP TUI component inventory | วิเคราะห์ภาพและ interaction | 30–60 นาที | รายการ theme/extension/core พร้อมลำดับความสำคัญ |
| Q6 | ทำ theme-only OMP-inspired skin | implementation แบบถอดกลับได้ | 1–2 ชั่วโมง | palette และ visual baseline โดยไม่แตะ Pi core |
| Q7 | ทำ header/footer/working-indicator prototype | extension prototype | 2–4 ชั่วโมง | ตรวจขอบเขต public TUI API กับ interaction จริง |
| Q8 | ทดสอบ local loader feasibility | disposable extension spike | 2–4 ชั่วโมง | รู้ว่า additive activation และ prompt leakage ควบคุมได้หรือไม่ |
| Q9 | สรุป context-governance requirements | วิเคราะห์ policy | 1–2 ชั่วโมง | requirements/non-goals สำหรับ inspect, approval และ compaction audit |
| Q10 | กำหนด external-agent handoff convention | วิเคราะห์ workflow | 1–2 ชั่วโมง | รูปแบบ task, status และ result โดยยังไม่สร้าง orchestrator |

งานที่ยังไม่ถือเป็น quick win ได้แก่ production diagnostics fix, benchmark monorepo ขนาดใหญ่, DAP, custom transcript renderer, standalone TUI และ context governor เต็มระบบ

## Open questions

### Context

- ต้องการ inspect แค่ message-level context หรือ exact provider payload ทุก request
- compaction แบบใดต้องมี human approval และกรณี overflow อนุญาต auto-recovery ได้หรือไม่
- ต้องการ preview summary แล้ว accept/reject หรือให้ auto-compact พร้อม audit log ก็เพียงพอ
- durable memory จะเก็บที่ระดับ project, global หรือทั้งสอง และใครมีสิทธิ์ promote
- tool output ใดตัดหรือแทน artifact reference ได้โดยไม่ลดคุณภาพ

### Code intelligence

- จะเก็บ upstream issue เป็น draft ถึงจุดใดก่อนเปิดจริง และ maintainer ต้องการ pending state หรือ bounded wait เป็น default
- local loader ควร activate แยก `ast`, `lsp-navigation` และ `lsp-diagnostics` หรือรวมเป็นกลุ่มน้อยกว่านี้
- หลัง correctness fix ควรใช้ VTSLS ต่อหรือเทียบ `typescript-language-server` บน repository ขนาดใหญ่
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

1. เลือกหนึ่ง short-cycle candidate โดยเริ่มจากงานที่ไม่เปลี่ยน production behavior
2. ทำ probe หรือ benchmark แบบ disposable ใน `.runtime/`
3. บันทึกผลและตัดสิน go/no-go ก่อนเปลี่ยน source หรือเปิด upstream issue
4. เมื่อจะทำ TUI ให้ระบุภาพ/interaction ของ OMP ที่ต้องการเลียนแบบก่อน
5. แยกงานใหญ่เป็น context governor, code intelligence และ UI skin โดยหลีกเลี่ยงการแก้ Pi core

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

### Code intelligence ที่ตรวจ

- `pi-ast-grep` v0.1.0
- `pi-lsp-adapter` v0.1.3 และ <https://github.com/nikmmd/pi-lsp-adapter>
- `lsp-pi` v1.0.5
- `pi-lsp` v0.1.7
- `@narumitw/pi-lsp` v0.49.5
- `@vtsls/language-server` v0.3.0
- `typescript-language-server` v6.0.0
- `@ast-grep/cli` v0.43.0
- `@narumitw/pi-lsp/src/lsp-client.ts` สำหรับ push/pull diagnostics และ settle/grace behavior

### OMP ที่ตรวจ

- `@oh-my-pi/pi-coding-agent` v17.4.0
- <https://github.com/can1357/oh-my-pi>
- `docs/compaction.md`
- `docs/memory.md`
- `packages/tui/`
- `packages/coding-agent/src/modes/components/`

## Change log

- 2026-08-21 15:46 — เพิ่ม validation backlog ก่อน implementation และ short-cycle candidates ครอบคลุม code intelligence, context governance, TUI และ orchestration
- 2026-08-21 15:15 — เพิ่ม benchmark TypeScript read-only ของ AST/LSP packages, ตัดสินใจแยก runtime extensions, เลือก Upstream-first สำหรับ `pi-lsp-adapter` และเก็บ draft issue เรื่อง diagnostics false-negative
- 2026-08-21 09:43 — สรุปการสนทนาเรื่อง context governance, OMP compaction/memory, Pi build-vs-reuse, code intelligence, external orchestration และ OMP-inspired TUI เพื่อส่งต่องานมาที่ workspace นี้
