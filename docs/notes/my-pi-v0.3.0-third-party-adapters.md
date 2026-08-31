# My Pi v0.3.0 — Managed Third-party Adapters

> **Status:** acceptance PASS · published release · Default not activated<br>
> **Release:** annotated `v0.3.0` at `7de3aacf46aa542038bd5b0fcae599fa8cef9d6d`; remote tag observed, Default profile/settings unchanged<br>
> **Delegated orchestration:** remains incubator; production disabled

## Scope

Stable aggregateเป็น authorityของ exact upstream adapter versionsต่อไปนี้:

| My Pi capability | Upstream dependency | Version |
|---|---|---:|
| `global/mcp-adapter` | `pi-mcp-adapter` | `2.31.0` |
| `global/web-access` | `pi-web-access` | `0.27.0` |
| `global/chrome-devtools` | `@narumitw/pi-chrome-devtools` | `0.53.1` |

แต่ละ capabilityมี thin extension adapterและ exact dependency pin ส่วน root `package-lock.json`เก็บ resolved tarball integrity MCP capabilityมี My Pi-owned `mcp-scripting` guidanceที่ track APIของ pinned upstream runtime

Config, MCP credentials, web provider settingsและ browser profileยังเป็น mutable stateของ Pi profile ไม่ถูก copyเข้า repositoryหรือ release Generated Worker profilesยังเปิดด้วย `--no-extensions --no-skills --no-prompt-templates --no-themes --no-context-files` และ exact tool allowlist จึงไม่ inherit toolsใหม่

## Packaging correction

Initial independent reviewกังวลว่า wrappersอาจ resolve Pi coreจาก release-local `node_modules` Pi loader sourceยืนยัน aliasของ `@earendil-works/pi-coding-agent`, `pi-agent-core`, `pi-ai`, `pi-tui` และ `typebox` ไป host-owned modules Clean-install smokeจึงลบ npm-auto-installed local peer copiesทั้งหมดก่อนเปิด Pi RPC; adaptersยังโหลดและ register resourcesครบ ทำให้ correction reviewปิด High/Mediumทั้งหมด

Web Accessและ Chrome packagesไม่มี root export จึงใช้ exact runtime subpaths:

- `pi-web-access/index.ts`
- `@narumitw/pi-chrome-devtools/dist/index.ts`

## Verification

- repository suite: `228/228`
- isolated `npm ci --omit=dev`: PASS
- isolated Pi package install + RPC session startup: PASS
- duplicate tool names: none
- duplicate command names: none
- required tools: `ask_user_question`, `plannotator_submit_plan`, `mcp`, `mcpScript`, `web_search`, `source_check`, `fetch_content`, `get_search_content`, `chrome_devtools_load`
- required commands/skill: `mcp`, `pi-mcp`, `mcp-auth`, `chrome-devtools`, `skill:mcp-scripting`
- project-opt-in Azure packageยังไม่ leakเข้า rootและยังโหลดได้เมื่อ explicitly installed
- independent correction review: **PASS**, no High/Medium

## Deferred migration

Default Piยังใช้ pinned `v0.2.0` แม้ remote `v0.3.0`พร้อมแล้ว และ global settingsยังคง entriesเดิม:

- `npm:pi-mcp-adapter`
- `npm:pi-web-access`
- `npm:@narumitw/pi-chrome-devtools`

เมื่อมี human authorizationให้ switchเป็น remote `v0.3.0` ในอนาคต ให้ลบทั้งสาม standalone entriesพร้อมกันและเปลี่ยน pinned refก่อนเปิด sessionใหม่ มิฉะนั้น extension tools/commandsจะ duplicateและ skill `mcp-scripting`จะ collision
