# Portable Tips → Pi

tips จาก [shanraisshan/claude-code-best-practice](https://github.com/shanraisshan/claude-code-best-practice)
ที่**ไม่ผูกกับ harness** คัดแล้วแปลงเป็นกลไกจริงของ Pi

> อ้างอิง Pi v0.84.3 (ตาม [`pi-doc`](file:///Users/developer/my-project/pi-doc/README.md)) · เรียบเรียง 2026-08-27
> เกณฑ์คัด: ตัดทุกข้อที่เป็นสเปก Claude Code (settings.json, hook events, frontmatter ของ agents/commands,
> `/compact` `/rewind` `/context` `/loop` `/code-review`, plan mode, auto mode, agent teams) — เหลือเฉพาะที่เป็น
> **วิธีคิด** หรือมี**กลไกเทียบเท่าใน Pi จริง**

---

## 1 · Context budget

Pi ชู "context window เป็นทรัพยากรจำกัด" เป็นปรัชญาหลักอยู่แล้ว หมวดนี้จึงตรงเป้าที่สุด

| Tip | กลไกใน Pi |
|---|---|
| **dumb zone ~40%** — ผลลัพธ์เริ่มแย่เมื่อ context เกิน 40% มือใหม่คุมไว้ <40% มือเก๋า <30% ดันถึง 60% เฉพาะงานง่าย | Pi ไม่มีตัวชี้วัดในตัว → `ctx.getContextUsage()` มีให้ เขียน extension เล็กๆ โชว์ % ใน TUI คุ้มมาก |
| **context rot ~300-400k tokens** บนโมเดล 1M — งานที่ต้องใช้ความฉลาดอย่าปล่อยให้เลยจุดนี้ | เพดานจริงตามโมเดลใน `defaultModel` — ใช้คู่กับตัวชี้วัดข้างบน |
| **compact แบบมี hint ดีกว่าปล่อย auto** — ตอน auto-compact โมเดลอยู่ในจุดที่โง่ที่สุดพอดี (context เต็ม) | Pi compact อัตโนมัติผ่าน `compaction.{enabled,reserveTokens,keepRecentTokens}` และ**ไม่มี `/compact` ให้สั่งเอง** → ถ้าอยากคุมต้องเขียน extension เรียก `ctx.compact({ customInstructions })` แล้วผูกเป็น command |
| **ถามตัวเองก่อนเรียก tool**: "ผลลัพธ์นี้ต้องใช้ซ้ำ หรือเอาแค่ข้อสรุป?" — ถ้าเอาแค่ข้อสรุป ให้ยิงเข้า subagent | spawn `pi` subprocess (`examples/extensions/subagent/`) หรือ `AgentSession` ผ่าน SDK — read 20 ไฟล์ + grep 12 ครั้ง + ทางตัน 3 เส้น ค้างใน context ลูก ส่งกลับแค่รายงาน |
| **อย่าใส่ทุกอย่างลง system prompt** | ลำดับความสิ้นเปลืองจากเบาไปหนัก: `promptSnippet`/`promptGuidelines` → skill (progressive disclosure) → prompt template → `before_agent_start` (ชั้นสุดท้าย เพราะกิน context **ทุก turn**) |

**Gotcha ของ Pi ที่เกี่ยวโดยตรง** — `promptSnippet`/`promptGuidelines` บน tool ที่ lazy-load ทำให้ system prompt rebuild → **invalidate prompt cache** ทั้ง prefix ให้พึ่ง `description` อย่างเดียว (gotcha #17); และ `setActiveTools()` ต้อง additive ล้วน (#16)

---

## 2 · Session management

Pi เก็บ session เป็น **tree** (`id`/`parentId`) ไม่ใช่ list — tip กลุ่มนี้เลยทำได้ดีกว่าต้นทางด้วยซ้ำ

| Tip | กลไกใน Pi |
|---|---|
| **rewind > correct** — ย้อนกลับไปก่อนที่พัง แล้ว prompt ใหม่ ดีกว่าปล่อยความพยายามที่ล้มเหลว + การแก้ทับ ค้างเป็นขยะใน context | `/tree` เดินไปจุดไหนก็ได้ · `/fork` แตกไฟล์ใหม่ · `/clone` ทำซ้ำ path · API: `ctx.fork(entryId, { position })` |
| **"summarize from here" ก่อนย้อน** — ให้เขียน handoff note ถึงตัวเองในอนาคต | `ctx.navigateTree(targetId, { summarize: true, customInstructions: "...", label: "..." })` — มีมาให้ตรงๆ ตั้ง `branchSummary.reserveTokens` ได้ |
| **ทุก turn คือจุดแตกกิ่ง** — จบ turn แล้วเลือกว่าจะ continue / ย้อน / เริ่มใหม่ / สรุป / โยนให้ subagent ตามปริมาณ context ที่ต้องหิ้วต่อ | tree ของ Pi ทำให้ตัดสินใจนี้ย้อนกลับได้ ไม่ใช่ทางเดียว |
| **งานใหม่ = session ใหม่** — งานที่ต่อเนื่องกัน (เช่นเขียน docs ของสิ่งที่เพิ่งทำ) ใช้ context เดิมคุ้ม แต่งานคนละเรื่องควรเริ่มใหม่ | `ctx.newSession()` — ⚠️ เรียกได้เฉพาะใน **command handler** เท่านั้น เรียกจาก event handler จะ deadlock (gotcha #4) |
| **ตั้งชื่อ session ที่สำคัญไว้กลับมาทำต่อ** | `pi.setSessionName()` และ `pi.setLabel(entryId, label)` — label โชว์ใน `/tree` และรอดข้าม restart |

**Gotcha** — ถ้าเขียน orchestrator ที่ต้อง reconstruct state ให้อ่าน `sessionManager.getBranch()` **ไม่ใช่** `getEntries()` ไม่งั้น branch อื่นปนเข้ามา (gotcha #29) และเก็บ state ไว้ใน `details` ของ tool result ด้วย ไม่ใช่แค่ closure (#30)

---

## 3 · Skills

Pi implement [Agent Skills standard](https://agentskills.io/specification) เหมือนกัน → tip กลุ่มนี้ย้ายมาได้เกือบทั้งหมด

| Tip | หมายเหตุสำหรับ Pi |
|---|---|
| **`description` คือ trigger ไม่ใช่ summary** — เขียนให้โมเดลตอบได้ว่า "ฉันควรยิงตอนไหน" | Pi ใส่**แค่ name + description** ใน system prompt ตลอดเวลา ตัวเนื้อโหลดเมื่อ agent ตัดสินใจ `read` — description จึงเป็นสิ่งเดียวที่ต้องแบกทุก turn |
| **skill เป็นโฟลเดอร์ ไม่ใช่ไฟล์** — `scripts/`, `references/`, `assets/` | โครงเดียวกันเป๊ะ; Pi ยอมให้ชื่อ skill ต่างจากชื่อโฟลเดอร์ (ต่างจาก spec) เพราะออกแบบให้แชร์ directory ข้าม harness ได้ |
| **ทุก skill ควรมีหัวข้อ Gotchas** — เนื้อหาสัญญาณแรงที่สุด ค่อยๆ สะสมจุดที่ agent พลาด | — |
| **อย่า railroad** — ให้เป้าหมายกับข้อจำกัด ไม่ใช่ step-by-step | — |
| **อย่าเขียนสิ่งที่โมเดลรู้อยู่แล้ว** — เขียนเฉพาะสิ่งที่ดึงมันออกจาก default behavior | — |
| **ใส่ script/library ไปด้วย** ให้ agent compose แทน reconstruct boilerplate ทุกครั้ง | `scripts/` ใน skill folder แล้วอ้าง path แบบ relative |
| **ทำอะไรเกินวันละครั้ง → ทำเป็น skill/command** | Pi มี 2 ทาง: **skill** (agent เรียกเอง / `/skill:name`) หรือ **prompt template** ใน `prompts/` (ผู้ใช้เรียกเป็น `/command` ตรงๆ) |

**ของแถมที่ Pi ทำได้แต่ต้นทางไม่มี** — ยืม skill ที่มีอยู่แล้วจาก harness อื่นได้เลย:

```json
{ "skills": ["~/.claude/skills", "~/.codex/skills"] }
```

**Gotcha** — เอกสาร Pi เตือนเองว่า *"models don't always do this"* คือ agent อาจไม่ยอมโหลด SKILL.md เต็มแม้ description ตรง → บังคับด้วย `/skill:name` หรือ prompt ตรงๆ

---

## 4 · Prompting

ทั้งหมดเป็น prompt เปล่า ไม่ผูกเครื่องมือ ใช้ได้ทันที

| Tip |
|---|
| **ท้าทายมัน** — *"grill me on these changes and don't make a PR until I pass your test"* หรือ *"prove to me this works"* แล้วให้ diff ระหว่าง main กับ branch |
| **หลังได้ของกลางๆ** — *"knowing everything you know now, scrap this and implement the elegant solution"* |
| **อย่าจู้จี้วิธี** — แปะ bug ลงไปแล้วบอก "fix" พอ อย่าสั่งว่าต้องแก้ยังไง |
| **เขียน spec ให้ละเอียด ลดความกำกวมก่อนโยนงาน** — ยิ่งเจาะจง output ยิ่งดี |
| **ให้มันสัมภาษณ์เราก่อน** — เริ่มจาก spec สั้นๆ แล้วสั่งให้ถามกลับจนครบ ค่อยเปิด session ใหม่ไป execute |

---

## 5 · Planning

| Tip | กลไกใน Pi |
|---|---|
| **แผนแบบมี gate** — แบ่งเป็นเฟส แต่ละเฟสมี test (unit / integration / automation) ผ่านแล้วค่อยไปต่อ | Pi ไม่มี plan mode → ทำเป็น prompt template ใน `prompts/` |
| **vertical slices (tracer bullets)** — แตกงานให้ตัดขวางทุกชั้น (DB + service + UI) ไม่ใช่ horizontal (เฟส DB → เฟส API → เฟส frontend) ซึ่งดัน feedback ปลายทางไปกองท้ายสุด | วิธีคิด — ใส่ไว้ใน `AGENTS.md` หรือ prompt template |
| **ให้ตัวที่ 2 รีวิวแผน** ในฐานะ staff engineer หรือใช้คนละโมเดลรีวิว | Pi รองรับหลาย provider ในตัว: `enabledModels` + Ctrl+P สลับโมเดล → ทำ plan-with-A แล้ว review-with-B ได้ในเครื่องมือเดียว ไม่ต้องเปิด 2 เทอร์มินัลแบบ workflow ต้นทาง |
| **RPI: Research → Plan → Implement** พร้อม verdict GO/NO-GO ท้าย research แผนแตกเป็น pm / ux / eng | 3 prompt templates + โฟลเดอร์เก็บ artifact |
| **prototype > PRD** — สร้าง 20-30 เวอร์ชันแทนการเขียนสเปกยาว ต้นทุนการสร้างถูกแล้ว | เข้ากับ session tree ของ Pi พอดี — `/fork` จากจุดเดียวกันหลายกิ่ง เทียบผลได้ |
| **แตกงานย่อยให้จบใน context ไม่เกินครึ่ง** | ใช้คู่กับตัวชี้ % context ในข้อ 1 |

---

## 6 · Multi-agent / parallel

| Tip | กลไกใน Pi |
|---|---|
| **"use subagents" เพื่อโยน compute เพิ่ม** โดยไม่ทำให้ context หลักรก | 3 ทาง: spawn `pi` subprocess (isolate ง่ายสุด) · `AgentSession` ผ่าน SDK (เอกสารทางการแนะนำถ้าเป็น Node) · RPC ถ้า host ไม่ใช่ Node |
| **test-time compute** — context แยกทำให้ผลดีขึ้น agent ตัวหนึ่งสร้าง bug อีกตัว (โมเดลเดียวกัน) หาเจอได้ | per-step config: subagent คนละโมเดล/คนละ thinking level ได้ |
| **agent เฉพาะทาง + skill ดีกว่า agent กว้างๆ** แบบ "qa" / "backend engineer" | skill + tool ที่ scope แคบ |
| **worktree สำหรับงานคู่ขนาน** | ไม่มีในตัว Pi — ใช้ git worktree ธรรมดา แล้วเปิด `pi` คนละโฟลเดอร์ (`.pi/settings.json` แยกต่อ worktree ได้) |

**Gotcha** — ถ้าทำ orchestrator: `agent_end` ≠ จบจริง (Pi อาจ retry / compact / ทำ follow-up ต่อ) ต้องใช้ **`agent_settled`** (gotcha #19)

---

## 7 · Git / PR

ไม่ผูกเครื่องมือเลย

| Tip |
|---|
| **PR เล็ก** — p50 ที่ 118 บรรทัด (จากสถิติ 141 PR / 45K บรรทัดในวันเดียว) หนึ่ง feature ต่อหนึ่ง PR รีวิวง่าย revert ง่าย |
| **squash merge เสมอ** — history เป็นเส้นตรง หนึ่ง commit ต่อหนึ่ง feature `git revert` / `git bisect` ทำงานได้จริง |
| **commit บ่อย** — อย่างน้อยชั่วโมงละครั้ง งานย่อยเสร็จเมื่อไหร่ commit เมื่อนั้น |

---

## 8 · Debugging

| Tip | กลไกใน Pi |
|---|---|
| **agentic search (glob + grep) ชนะ RAG** — ทีม Claude Code ลอง vector DB แล้วทิ้ง เพราะโค้ด drift ออกจาก index และ permission ซับซ้อน | ตรงกับปรัชญา Pi พอดี — 4 tools (read/write/edit/bash) ก็ทำ agentic search ได้ครบ |
| **รันคำสั่งที่อยากดู log เป็น background task** | `bash` tool + `tool_execution_update` สำหรับ stream ความคืบหน้า |
| **แปะ screenshot เมื่อติดปัญหาที่มองเห็น** | ขึ้นกับ provider ที่ใช้รองรับ image input ไหม |
| **รีวิวข้ามโมเดล** — ให้อีกโมเดลตรวจแผนและ implementation | `enabledModels` + Ctrl+P |

---

## 9 · Daily

| Tip | กลไกใน Pi |
|---|---|
| **อ่าน changelog ของเครื่องมือทุกวัน** | `pi update --all` · pi-doc มี `scripts/changelog-since.sh` และ `scripts/check.sh` ให้เช็คว่าคู่มือตกรุ่นหรือยัง |
| **ทดลองของใหม่ในที่ที่พังได้** | `PI_CODING_AGENT_DIR=~/.pi-profiles/lab pi` — แยก settings / extensions / skills / sessions ทั้งชุด (⚠️ `auth.json` ย้ายไปด้วย ต้อง login ใหม่ หรือ symlink) |

---

## ที่ตัดทิ้ง และเหตุผล

| ตัดทิ้ง | เหตุผล |
|---|---|
| `settings.json` ทั้งไฟล์ (1,401 บรรทัดใน `best-practice/claude-settings.md`) | สเปก Claude Code ล้วน — Pi ใช้ `~/.pi/agent/settings.json` คนละ schema |
| hook events 25 ตัว + `.claude/hooks/` | Pi ไม่มี hook แบบ shell command — ใช้ **extension** (TypeScript, in-process) ผ่าน `pi.on(...)` ดู [03](file:///Users/developer/my-project/pi-doc/03-events-reference.md) |
| frontmatter ของ agents/commands (`permissionMode`, `context: fork`, `skills:`, `mcpServers:`, `isolation`) | ไม่มีคอนเซปต์ agent/command เป็นไฟล์ .md ใน Pi — มี extension, tool, prompt template แทน |
| `/compact` `/rewind` `/context` `/loop` `/code-review` `/doctor` `/model` `/usage` | ไม่มีใน Pi (บางตัวมีของเทียบเท่าตามที่ระบุไว้ข้างบน) |
| plan mode, auto mode, agent teams, checkpointing, output styles, spinner verbs | feature ของ Claude Code harness |
| MCP | Pi ไม่มีมาให้ในตัวโดยตั้งใจ (ต่อเองผ่าน custom tool ได้) |
| CLAUDE.md best practices (<200 บรรทัด, `<important if="...">`, `.claude/rules/` + `paths:` frontmatter) | Pi อ่าน `AGENTS.md` (และ `CLAUDE.md` ด้วย) แต่**ไม่มี lazy-load แบบ `paths:`** — กฎ "สั้นเข้าไว้" ยังใช้ได้ กลไกที่เหลือใช้ไม่ได้ |
| ตาราง feature ครึ่งบนของ README, `videos/`, `tips/` รายไฟล์ | เป็นสารบัญ/บุ๊กมาร์ก ไม่ใช่เนื้อหา |

---

## ต้นทาง

- tips: [shanraisshan/claude-code-best-practice](https://github.com/shanraisshan/claude-code-best-practice) — 83 tips, 15 หมวด (จาก Boris Cherny, Thariq, community)
- กลไก Pi: [`pi-doc`](file:///Users/developer/my-project/pi-doc/README.md) v0.84.3 — บท [01](file:///Users/developer/my-project/pi-doc/01-architecture.md) (session tree, agent loop), [04](file:///Users/developer/my-project/pi-doc/04-context-api.md) (`getContextUsage`, `compact`, `fork`, `navigateTree`), [06](file:///Users/developer/my-project/pi-doc/06-resources-and-settings.md) (skills, settings, profile), [09](file:///Users/developer/my-project/pi-doc/09-worked-example.md) (4 ชั้นการสอน agent), [10](file:///Users/developer/my-project/pi-doc/10-gotchas.md) (gotchas)
