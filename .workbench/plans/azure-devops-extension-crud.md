# ย้ายและขยาย Azure DevOps extension ให้รองรับ CRUD ตามสิทธิ์ราย project

> **Status:** complete<br>
> **Created:** 2026-08-09 11:10<br>
> **Updated:** 2026-08-09 12:50<br>
> **Purpose:** ย้าย Azure Boards extension มาเป็น global `azure-devops` extension ใน repository นี้ และเพิ่ม Create/Update/Delete แบบ opt-in ที่บังคับใช้ PAT

## Context

ปัจจุบัน project `exim` มี project-local extension ที่ `/Users/developer/office/cpmatch/exim/.pi/extensions/azure-boards` ใช้ config `.pi/azure-devops.json` และเปิดเฉพาะ read-only tools สำหรับ Azure Boards และ Azure Repos โดยรองรับ Azure CLI/PAT authentication พร้อม credential guard สำหรับ direct shell access

ต้องย้าย source มาไว้ใน repository `my-pi` เพื่อใช้ร่วมกันหลาย project เปลี่ยนชื่อ extension เป็น `azure-devops` ให้ตรงกับชื่อ config ที่แต่ละ project จะมี และเปิดให้บาง project เลือก Create/Update/Delete ได้โดยไม่ทำให้ project เดิมได้รับ write permission อัตโนมัติ

## Scope

### อยู่ในขอบเขต

- ย้าย source ไปที่ `extensions/azure-devops/` และลงทะเบียนเป็น global extension ใน `package.json`
- ใช้ `.pi/azure-devops.json` เป็น project-local config ต่อไป
- ทำให้ extension global อยู่ในสถานะ inactive อย่างเงียบ ๆ เมื่อ project ไม่มี config และไม่อ่าน config ของ project ที่ไม่ได้ trust
- คง read tools เดิมสำหรับ Boards และ Repos
- เพิ่ม CRUD รอบแรกสำหรับ Azure Boards Work Items: create, update และ soft delete
- กำหนด permission ราย operation ต่อ project โดย default เป็น read-only
- บังคับให้ project ที่เปิด create/update/delete ใช้ `auth.method: "pat"`
- เพิ่ม confirmation, preview, optimistic concurrency และ verification/test ที่เหมาะกับ write operation
- อัปเดต README และเอกสารการติดตั้ง/การใช้งาน
- หลัง verification ผ่าน จึงนำ project-local source เดิมออกจาก `exim` เพื่อไม่ให้โหลดซ้ำ

### นอกขอบเขต

- วิธีจัดเก็บหรือโหลดค่า PAT เช่น `.env`, Keychain หรือ secret manager
- การป้องกันไม่ให้โมเดลอ่าน PAT นอก flow ของ Azure DevOps extension
- Create/Update/Delete สำหรับ Pull Requests, repositories, boards configuration หรือ iterations
- bulk write operations
- permanent destroy; delete รอบแรกต้องเป็น soft delete/recycle-bin semantics เท่านั้น
- การตรวจล่วงหน้าว่า PAT มี Azure DevOps scopes ใด เพราะ Azure DevOps จะเป็นผู้บังคับ scope/ACL ตอนเรียก APIจริง
- การเรียก Azure CLI จริงระหว่าง implementation และ verification โดย AI; ห้ามรันคำสั่ง `az` ทุกกรณี รวมถึง login, token acquisition และ smoke test

## Approach

### ตำแหน่งและ lifecycle

- ใช้ `extensions/azure-devops/index.ts`, `client.ts`, `security.ts` และแยก policy/schema เพิ่มเมื่อช่วยให้ทดสอบได้ชัดเจน
- เพิ่ม `./extensions/azure-devops/index.ts` ใน `package.json#pi.extensions`
- Global extension ตรวจ `ctx.isProjectTrusted()` ก่อนอ่าน `.pi/azure-devops.json`
- เมื่อไม่มี config ให้ปิด Azure tools สำหรับ session นั้นโดยไม่แจ้ง config error; เมื่อ config ผิดให้แจ้ง warning และไม่เปิด tools
- เมื่อ config ถูกต้องให้เปิดเฉพาะ tools ที่ permission policy อนุญาต โดยรักษา active tools ของ extension อื่น

### Config และ effective permission

รูปแบบเป้าหมาย:

```json
{
  "organization": "example-org",
  "project": "example-project",
  "defaultTeam": "example-team",
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
  },
  "maxQueryResults": 100
}
```

กติกา:

- ถ้าไม่มี `permissions` ให้แปลงเป็น read-only เพื่อ compatibility กับ config เดิม
- `read` ใช้ `auto`, `azure-cli` หรือ `pat` ได้
- ถ้า `create`, `update` หรือ `delete` เป็น `true`, `auth.method` ต้องเป็น `pat`; ห้าม fallback ไป Azure CLI
- ตรวจเงื่อนไขทั้งตอน parse config และก่อน execute write tool
- แยก tool ตาม operation และใช้ allowlist/policy กลาง ไม่ใช้ generic execute tool
- ชื่อ directory, status key, docs และ config command ใช้คำว่า `azure-devops`; resource tools เดิมยังคง prefix `azure_boards_`/`azure_repos_` เพื่อรักษาความหมายและ compatibility
- เปลี่ยน slash command เดิมเป็น `/mypi-azure-devops-config` ให้ตรงกติกา command ของ repository นี้

### Write safety

- `azure_boards_create_work_item`: แสดง project, type, title, area/iteration และ assignee ก่อนยืนยัน
- `azure_boards_update_work_item`: รับเฉพาะ field allowlist, อ่านค่าปัจจุบัน, แสดง before/after และส่ง revision test เพื่อป้องกัน lost update
- `azure_boards_delete_work_item`: แสดง ID/title/type และรองรับ soft delete เท่านั้น
- ทุก write operation ต้องยืนยันผ่าน UI **ทุกครั้ง** โดยไม่มี session-level approval; ถ้าไม่มี UI ให้ block แบบ fail-closed
- ไม่ retry write request อัตโนมัติ
- หลัง create/update ให้ดึงค่าปัจจุบันกลับมายืนยันผล; delete ต้องคืนสถานะที่ Azure DevOps ตอบจริง
- ไม่ใส่ Authorization header, PAT หรือ token ใน tool output, details, error หรือ log

## Files to modify

### Repository นี้

- `extensions/azure-devops/index.ts` — entry point, tools, lifecycle และ confirmation flow
- `extensions/azure-devops/client.ts` — config/auth และ Azure DevOps REST operations
- `extensions/azure-devops/security.ts` — direct Azure CLI/environment disclosure guard ที่ย้ายมาจากของเดิม
- `extensions/azure-devops/README.md` — config, tools, permission model และ migration
- `tests/azure-devops.test.ts` — config/policy/client/tool safety tests
- `package.json` — ลงทะเบียน global extension
- `README.md` — เพิ่ม extension และวิธีใช้งานราย project
- `.workbench/index.md` — สถานะแผน

### Project ต้นทาง

- `/Users/developer/office/cpmatch/exim/.pi/extensions/azure-boards/` — ลบหลัง global extension ผ่าน verification และทดสอบจาก project `exim` แล้ว
- `/Users/developer/office/cpmatch/exim/.pi/azure-devops.json` — คงไว้ใน project และปรับ `permissions` เฉพาะเมื่อจำเป็น; ค่าเริ่มต้นของ migration ต้องยังเป็น read-only

## Reuse

- ย้ายและปรับ `index.ts`, `client.ts`, `security.ts`, `README.md` จาก project `exim` แทนการเขียนใหม่ทั้งหมด
- ใช้ `pi.registerTool`, `session_start`, `tool_call`, `user_bash`, `pi.exec`, output truncation และ `ctx.ui.confirm` ตาม implementation เดิม
- ใช้แนวทาง pure helper + Node test runner จาก `tests/guardrails.test.ts`
- ใช้ global `guardrails.ts` เดิมเป็น permission layer ทั่วไป แต่ Azure CRUD policy ต้องบังคับใน extension เองและไม่พึ่ง guardrails เพียงชั้นเดียว

## Risks

- Global extension อาจทำให้ Azure tools โผล่ใน project ที่ไม่มี config หาก activation lifecycle ไม่รัดกุม
- Extension load order และ `setActiveTools()` อาจกระทบ tools ของ extension อื่น จึงต้องเปลี่ยนเฉพาะชุดชื่อที่ extension นี้เป็นเจ้าของ
- Config อยู่ใน project จึงเปลี่ยน permission ได้ผ่าน source control; ความปลอดภัยชั้นสุดท้ายยังต้องมาจาก PAT scopes และ Azure DevOps ACL
- Write request อาจเกิดซ้ำจาก retry หรือ concurrent update จึงต้องไม่ auto-retry และต้องใช้ revision guard
- การลบ source ต้นทางเร็วเกินไปอาจทำให้ `exim` ใช้งานไม่ได้ จึงต้องลบหลัง smoke test จาก global package เท่านั้น
- ถ้า local และ global extension โหลดพร้อมกัน อาจเกิด duplicate tools/commands ระหว่าง migration
- ห้ามใช้ Azure CLI เพื่อตรวจ integration ระหว่าง implementation แม้ config เดิมของ `exim` จะเป็น `azure-cli`; automated verification ต้องใช้ pure helpers/mocks และรอผู้ใช้ทำ acceptance test จริง
- Allowlist ที่ตรวจเพียงชื่อ tool ไม่เพียงพอหาก implementation ถูก override จึงต้องผูก permission check และ auth check ไว้ใน write execute path ด้วย

## Decisions

- 2026-08-09 — ใช้ชื่อ extension และ directory ว่า `azure-devops` ให้ตรงกับ `.pi/azure-devops.json`
- 2026-08-09 — Permission เป็น opt-in ราย project และ config เดิมที่ไม่มี `permissions` ต้องคง read-only
- 2026-08-09 — Create/Update/Delete ใช้ PAT เท่านั้น; Read ยังใช้ Azure CLI หรือ PAT ได้
- 2026-08-09 — ยังไม่ตัดสินใจเรื่องตำแหน่งจัดเก็บ PAT ในแผนนี้
- 2026-08-09 — CRUD รอบแรกจำกัด Azure Boards Work Items; Azure Repos ยังคง read-only
- 2026-08-09 — Delete รอบแรกเป็น soft delete เท่านั้น ไม่รองรับ permanent destroy
- 2026-08-09 — ทุก write operation ต้องขอ confirmation ทุกครั้ง ไม่มี session-level approval และ non-interactive mode ต้อง block
- 2026-08-09 — ระหว่าง implementation AI ห้ามเรียก Azure CLI จริง; verification ของ AI ใช้ mocks/static checks และผู้ใช้เป็นผู้ทำ acceptance test เองหลัง implementation
- 2026-08-09 — ผู้ใช้ยืนยัน acceptance ว่า doctor, Work Item read และ Pull Request read ผ่าน และการขอเขียน comment ถูกปฏิเสธเพราะ `update: false`; `exim` ต้องคง read-only
- 2026-08-09 — ผู้ใช้ยืนยันว่าการทดสอบดังกล่าวเกิดหลังลบ local source และเปิด Pi ใหม่ จึงถือว่า post-removal acceptance ผ่าน

## Steps

### Phase 1 — ย้าย source และทำให้ global lifecycle ปลอดภัย

- [x] คัดลอก source เดิมเข้า `extensions/azure-devops/` โดยยังไม่ลบต้นทาง
- [x] ปรับชื่อ extension/status/config command/docs เป็น `azure-devops` และใช้ `/mypi-azure-devops-config`
- [x] เพิ่ม extension ใน `package.json` ตามลำดับที่ไม่ทำลาย global guardrails
- [x] เพิ่ม trusted-project/config discovery: ไม่มี config ให้ inactive เงียบ ๆ, config ผิดให้ disable พร้อม warning
- [x] ทำ activation/deactivation เฉพาะ Azure tool names โดยไม่ลบ active tools ของ extension อื่น
- [x] Verification: import extension ได้, `npm test` ผ่าน, project ที่ไม่มี config ไม่มี Azure tools active และ project ที่มี config เดิมเปิด read tools ได้

### Phase 2 — Config schema และ permission policy

- [x] เพิ่ม schema/default normalization สำหรับ `permissions.workItems` และ `permissions.repos`
- [x] ทำ default ของ config เดิมให้เป็น read-only
- [x] ปฏิเสธ config ที่เปิด create/update/delete แต่ `auth.method` ไม่ใช่ `pat`
- [x] สร้าง policy helper/allowlist ที่ map tool → resource → CRUD operation และตรวจซ้ำก่อน execute
- [x] ให้ doctor/config command แสดง effective permissions โดยไม่แสดง credential
- [x] Verification: tests ครอบคลุม config เดิม, read-only, PAT write, Azure CLI write rejection, unknown permission/tool และ missing/invalid config

### Phase 3 — Create และ Update Work Items

- [x] เพิ่ม client operation สำหรับสร้าง Work Item ด้วย Azure DevOps JSON Patch API
- [x] เพิ่ม `azure_boards_create_work_item` พร้อม field validation, preview และ confirmation
- [x] เพิ่ม client operation สำหรับ update พร้อม `/rev` test และ field allowlist
- [x] เพิ่ม `azure_boards_update_work_item` ที่อ่านค่าปัจจุบันและแสดง before/after ก่อนยืนยัน
- [x] บังคับ PAT และ effective permission ซ้ำใน execute path; block เมื่อไม่มี UIหรือผู้ใช้ปฏิเสธ
- [x] อ่าน resource กลับหลังสำเร็จและไม่ retry write อัตโนมัติ
- [x] Verification: mocked API tests ยืนยัน method/path/body/revision, ไม่มี write request เมื่อ deny/non-UI/no permission/non-PAT และผลลัพธ์ไม่มี Authorization/token

### Phase 4 — Soft Delete Work Items

- [x] ตรวจ Azure DevOps REST semantics ของ recycle-bin/soft delete และกำหนด client contract ที่ไม่เปิด permanent destroy
- [x] เพิ่ม `azure_boards_delete_work_item` พร้อม preview ของ work item ปัจจุบันและ explicit confirmation
- [x] บังคับ delete permission, PAT และ interactive UI แบบ fail-closed
- [x] Verification: tests ยืนยัน soft-delete endpoint เท่านั้น, ไม่มี delete request เมื่อ deny/non-UI/no permission/non-PAT และไม่มี code path สำหรับ permanent destroy

### Phase 5 — Documentation และ migration preparation

- [x] อัปเดต extension README และ root README ด้วย config examples, default read-only, PAT-required write, confirmation ทุกครั้ง และข้อจำกัด
- [x] ตรวจแบบ static/unit test ว่า `.pi/azure-devops.json` เดิมของ `exim` normalize เป็น read-only โดยไม่ต้องเพิ่ม permission
- [x] เตรียม migration checklist ให้ผู้ใช้ตรวจ global extension, ชื่อ/command ใหม่, duplicate registration, doctor, work item read และ PR read
- [x] ห้ามรัน `az`, Azure CLI authentication หรือ live Azure smoke test ระหว่าง phase นี้
- [x] Verification โดย AI: `npm test`, import test, config fixture tests และ `git diff --check` ผ่าน โดยใช้ mocks เท่านั้น

### Phase 6 — User acceptance และนำ local extension เดิมออก

- [x] ส่งมอบขั้นตอนทดสอบให้ผู้ใช้หลัง implementation โดยไม่ให้ AI เรียก Azure CLI หรือ Azure DevOps จริง
- [x] รอผู้ใช้ทดสอบจาก project `exim` และยืนยันว่า global `azure-devops` ทำงานถูกต้อง
- [x] หลังผู้ใช้ยืนยันผล จึงลบ `/Users/developer/office/cpmatch/exim/.pi/extensions/azure-boards/` เพื่อไม่ให้เกิด duplicate registration
- [x] ให้ผู้ใช้เปิด Pi ใหม่และตรวจซ้ำหลังลบ local source; AI บันทึกผลที่ผู้ใช้รายงานลง Handoff
- [x] Verification: ถือว่า phase ผ่านเมื่อผู้ใช้ยืนยัน acceptance test และ post-removal test เท่านั้น

### Phase 7 — ปิดงานและส่งต่อ

- [x] ตรวจ diff ว่าไม่มี PAT/token/secret หรือ generated runtime artifact ถูกเพิ่ม
- [x] อัปเดต checklist, `Status`, `Updated`, `Handoff`, `Decisions` และ Change log ตามผลจริง
- [x] อัปเดต `.workbench/index.md` เป็นสถานะ complete เมื่อ verification ทุก phase รวม user acceptance ผ่าน
- [x] Verification: ทบทวน automated test results และผลทดสอบที่ผู้ใช้รายงานครบก่อนทำเครื่องหมาย complete

## Verification รวม

```sh
npm test
git diff --check
```

Acceptance matrix สำหรับผู้ใช้ทดสอบหลัง implementation (AI ไม่เรียก Azure CLI หรือ live Azure API เอง):

| Project/config | ผลที่คาดหวัง |
|---|---|
| Project ไม่ trusted | ไม่อ่าน config และไม่เปิด Azure tools |
| ไม่มี `.pi/azure-devops.json` | extension inactive โดยไม่เตือน |
| Config เดิม `azure-cli`, ไม่มี permissions | read tools ใช้ได้, write tools ใช้ไม่ได้ |
| เปิด write แต่ใช้ `azure-cli`/`auto` | config ถูกปฏิเสธหรือ write tools ถูก disable |
| เปิด write + `pat` | เฉพาะ operation ที่อนุญาตเปิดใช้งาน |
| Write ใน TUI และกดยกเลิก | ไม่มี HTTP write request |
| Write ใน print/JSON mode | block |
| Concurrent/stale update | revision test ล้มเหลวโดยไม่เขียนทับ |
| Delete | soft delete เท่านั้น |

## Open questions

- Azure DevOps field allowlist ขั้นต้นควรรวม custom fields ของ `exim` หรือเปิดเฉพาะ standard fields แล้วค่อยขยายตาม project

## Handoff

Implementation และ automated verification เสร็จถึง Phase 5 โดยไม่เรียก Azure CLI หรือ Azure DevOps จริง: extension import ผ่าน, `npm test` ผ่าน 37 tests และ `git diff --check` ผ่าน

ผู้ใช้ยืนยันว่าหลัง local source ถูกลบและเปิด Pi ใหม่แล้ว `azure_boards_doctor`, Work Item read และ Pull Request read ผ่าน ส่วนการขอเขียน comment ถูกปฏิเสธตาม read-only policy (`update: false`) จึงถือว่า acceptance และ post-removal verification ผ่านครบ

Final automated review ผ่าน: extension import สำเร็จ, `npm test` ผ่าน 37 tests, `git diff --check` ผ่าน, credential scan ไม่พบค่า secret และไม่มีไฟล์ใต้ `.runtime/` ถูกเพิ่มเข้า versioned changes Local source `/Users/developer/office/cpmatch/exim/.pi/extensions/azure-boards/` ไม่มีอยู่แล้ว ไม่มี blocker เหลือ

## Change log

- 2026-08-09 12:50 — ผู้ใช้ยืนยัน post-removal test ผ่าน, final automated/security review ผ่าน และปิดแผน complete
- 2026-08-09 12:47 — บันทึก user acceptance ว่า read paths ผ่านและ write comment ถูก block; local source ไม่มีอยู่แล้ว รอ post-removal retest
- 2026-08-09 11:53 — Implement global extension, CRUD policy/tools/tests/docs ครบและผ่าน mock verification; เปลี่ยนสถานะเป็น blocked รอ user acceptance
- 2026-08-09 11:27 — ปรับแผนให้ห้าม AI เรียก Azure CLI ระหว่าง implementation, กำหนดให้ผู้ใช้ทำ acceptance test และยืนยัน write operation ทุกครั้ง
- 2026-08-09 11:10 — สร้างแผนย้าย extension เป็น global `azure-devops` และเพิ่ม Work Item CRUD แบบ PAT-only/opt-in
