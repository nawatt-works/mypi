# แนวทางจัดเก็บ Azure DevOps PAT อย่างปลอดภัย

> **Status:** draft<br>
> **Created:** 2026-08-09 12:56<br>
> **Updated:** 2026-08-09 19:25<br>
> **Purpose:** รวบรวมทางเลือก ข้อจำกัด และแนวทางแนะนำสำหรับส่ง PAT ให้ Azure DevOps extension โดยลดโอกาสที่ credential จะถูกเปิดเผยต่อโมเดลหรือ subprocess

## ขอบเขต

เอกสารนี้กล่าวถึงวิธีจัดเก็บและดึง Azure DevOps Personal Access Token (PAT) สำหรับ `local/extensions/azure-devops/` เท่านั้น Extension ถูก maintain ใน repository นี้ แต่แต่ละ project เป็นผู้เลือกโหลดผ่าน `.pi/settings.json` เอกสารนี้ยังไม่ใช่แผน implementation และไม่มีค่า PAT จริง

Azure DevOps extension ปัจจุบันมีนโยบายดังนี้:

- Read ใช้ Azure CLI หรือ PAT ได้
- Create/Update/Delete ต้องใช้ `auth.method: "pat"`
- Permission เปิดแบบ opt-in ราย project
- Write ต้องยืนยันผ่าน UI ทุกครั้ง
- ตำแหน่งจัดเก็บ PAT ยังไม่ได้กำหนดเป็นมาตรฐาน

## เป้าหมาย

- ไม่เก็บ PAT ใน repository หรือ project config
- ไม่ส่ง PAT เข้า system prompt, tool result, session, log หรือ error
- ลดโอกาสที่ model เรียก `bash` หรือ subprocess แล้วอ่าน PAT ได้
- แยก credential ตาม organization/project และระดับสิทธิ์
- รองรับ rotation และ expiration โดยไม่ต้องแก้ source code
- ใช้ least privilege ทั้ง PAT scopes และ Azure DevOps ACL

## Threat model

สิ่งที่ต้องการป้องกันเป็นหลัก:

- model อ่านไฟล์ `.env` หรือ secret file โดยไม่ตั้งใจ
- shell command แสดง environment variables
- child process สืบทอด PAT ผ่าน `process.env`
- API error หรือ debug output สะท้อน Authorization header/PAT กลับมา
- ใช้ PAT สิทธิ์สูงร่วมกันหลาย project
- PAT หมดอายุหรือถูก revoke แต่ไม่ทราบว่า project ใดได้รับผลกระทบ

สิ่งที่ guard ภายใน Pi รับประกันไม่ได้:

- Pi extension และ unrestricted shell ยังทำงานด้วยสิทธิ์ของ OS user
- regex หรือ `tool_call` guard อาจมองไม่เห็นคำสั่งที่ซ่อนใน script/runtime อื่น
- extension อื่นหรือ subprocess อาจมี side effect ที่ไม่ผ่าน Azure DevOps extension
- การเก็บ secret ใน process เดียวกับ agent ไม่ใช่ security boundary ที่แยกขาด

หากต้องรับมือกับ input หรือ model ที่ไม่เชื่อถือจริง ควรใช้ sandbox หรือ credential broker แยก process

## เปรียบเทียบทางเลือก

| วิธี | ข้อดี | ข้อจำกัด | ระดับแนะนำ |
|---|---|---|---|
| Environment variable | ใช้ง่ายและรองรับ implementation ปัจจุบัน | child process อ่านได้ และอาจหลุดผ่าน `env`, debug หรือ script | ใช้ชั่วคราว |
| `.env` ใน project | ตั้งค่าราย project ง่าย | model/file tools อ่านได้, เสี่ยง commit, ยังต้องโหลดเข้า environment | ไม่แนะนำสำหรับ PAT ที่เขียนได้ |
| Secret file นอก workspace + `0600` | ไม่อยู่ใน repository และจำกัด file permission ได้ | shell ของ OS user ยังอ่านไฟล์ได้ | ทางเลือกชั่วคราว |
| macOS Keychain | ไม่อยู่ในไฟล์ project, ไม่ต้องอยู่ใน environment ตลอด session, รองรับ account แยก | ต้องเพิ่ม credential provider และ guard การเรียก Keychain โดยตรง | แนะนำสำหรับเครื่องนี้ |
| 1Password/Azure Key Vault/secret manager | จัดการ rotation, audit และหลายเครื่องได้ดี | ต้องมี CLI/network/session เพิ่ม และ model อาจพยายามเรียก CLI โดยตรง | แนะนำเมื่อใช้งานหลายเครื่องหรือทีม |
| Credential broker แยก process | Pi ไม่ต้องถือ PAT และ broker จำกัด operation ได้จริง | ออกแบบและดูแลซับซ้อนที่สุด | ใช้เมื่อจำเป็นต้องมี security boundary สูง |

## ข้อเสนอหลัก: macOS Keychain provider

สำหรับ setup ส่วนตัวบน macOS ให้เริ่มด้วย Keychain โดย config อ้างเพียง logical identity ไม่ใส่ secret:

```json
{
  "organization": "example-org",
  "project": "example-project",
  "auth": {
    "method": "pat",
    "provider": "macos-keychain",
    "account": "example-org/example-project"
  }
}
```

ชื่อ service ควรเป็นค่าคงที่ของ extension เช่น:

```text
mypi.azure-devops
```

และใช้ account แยกตาม organization/project เช่น:

```text
example-org/example-project
```

ถ้าต้องแยก credential ตามระดับสิทธิ์ อาจใช้ suffix:

```text
example-org/example-project/read
example-org/example-project/write
```

### Flow ที่ต้องการ

```text
Azure DevOps tool
    │
    ├─ ตรวจ project trust/config/CRUD permission
    ├─ ตรวจว่ามี interactive confirmation สำหรับ write
    ├─ ขอ PAT จาก credential provider ภายใน extension
    ├─ เรียก Azure DevOps API โดยใส่ Authorization header
    ├─ redact credential จาก response/error
    └─ ทิ้ง reference ของ PAT หลัง request เสร็จ
```

PAT ต้องไม่ถูกใส่ใน:

- tool parameters
- tool `content` หรือ `details`
- Pi session entries
- status bar/notification
- config command output
- command-line arguments
- application logs

## การป้องกันเพิ่มเติมสำหรับ Keychain

- ดึง PAT เฉพาะเมื่อ Azure API operation ต้องใช้จริง ไม่ดึงตอน extension startup
- ไม่คัดลอก PAT เข้า `process.env`
- ไม่ cache ข้าม session; หากจำเป็นให้ cache ใน closure ชั่วคราวและล้างตอน `session_shutdown`
- block หรือขอ confirmation เมื่อ model/user เรียกคำสั่ง Keychain ที่สามารถคืน secret ผ่าน `bash` หรือ `!`/`!!`
- redact ทั้ง raw PAT และค่า Authorization ที่ encode แล้วจาก API result/error
- ห้ามแสดง command output ของ credential retrieval ต่อ model
- เพิ่ม tests ยืนยันว่า deny, missing UI, missing permission และ API error ไม่ทำให้ secret ปรากฏ

Guard เหล่านี้เป็น defense in depth ไม่ใช่ sandbox เพราะ model อาจเรียก runtime อื่นเพื่อเข้าถึง Keychain ได้ หากต้องป้องกันการหลบ guard ต้องแยก credential retrieval ไปไว้ใน broker/sandbox

## Least privilege และการแยก PAT

ควรออก PAT ตามหลักต่อไปนี้:

- หนึ่ง PAT ต่อ organization/project เมื่อทำได้
- Read-only project ใช้เฉพาะ read scopes
- Project ที่เขียน Work Items ใช้เฉพาะ Work Items read/write และ ACL ที่จำเป็น
- ไม่ให้ Code write หาก extension ใช้เพียง Work Item write
- Delete เปิดใน project config เฉพาะเมื่อจำเป็น แม้ PAT จะมี write scope
- ตั้ง expiration สั้นเท่าที่ workflow รองรับ
- บันทึก owner, purpose และวันหมดอายุโดยไม่บันทึกค่าของ PAT
- revoke ทันทีเมื่อไม่ใช้ project หรือสงสัยว่ารั่ว

## Credential broker สำหรับระดับความปลอดภัยสูง

เมื่อ Keychain + guard ไม่เพียงพอ ให้ใช้ local broker แยก process:

```text
Pi extension ── structured request ──> Credential broker ──> Azure DevOps
```

Broker ควร:

- ไม่คืน PAT ให้ Pi
- รับเฉพาะ operation ที่กำหนด เช่น `get`, `create`, `update`, `soft-delete`
- validate organization/project/resource/operation
- ใช้ allowlist ของ fields และ `destroy=false`
- บันทึก audit metadata โดยไม่บันทึก payload ที่เป็น secret
- ใช้ local socket ที่จำกัด owner permission

แนวทางนี้ซับซ้อนกว่า แต่สร้าง security boundary ที่ชัดกว่าการ redact ภายใน process เดียว

## แนวทาง implementation ในอนาคต

1. เพิ่ม credential provider interface ให้ `AzureDevOpsClient`
2. คง environment provider ไว้เพื่อ compatibility แต่ไม่ใช้เป็นค่าแนะนำ
3. เพิ่ม macOS Keychain provider แบบ lazy retrieval
4. เปลี่ยน config validation ให้รองรับ `auth.provider`
5. เพิ่ม direct Keychain command guard ใน `tool_call` และ `user_bash`
6. เพิ่ม redaction และ tests ครอบคลุม success/error/tool result
7. เขียน migration guide จาก `patEnv` ไป Keychain account
8. ให้ผู้ใช้ทดสอบด้วย PAT อายุสั้นและ permission ต่ำก่อนใช้งานจริง

## Decisions

- 2026-08-09 — แยกหัวข้อการจัดเก็บ PAT ออกจาก implementation CRUD เดิม
- 2026-08-09 — macOS Keychain เป็นแนวทางเริ่มต้นที่แนะนำสำหรับ setup ส่วนตัวนี้
- 2026-08-09 — Environment variable ยังรองรับได้ แต่ไม่ใช่แนวทางแนะนำสำหรับ PAT ที่มี write scope
- 2026-08-09 — Keychain + extension guard เป็น defense in depth; credential broker เป็นตัวเลือกเมื่อจำเป็นต้องมีขอบเขตที่แข็งแรงกว่า

## Open questions

- ต้องแยก read PAT และ write PAT ภายใน project เดียวกันหรือไม่
- ต้องรองรับเฉพาะ macOS หรือออกแบบ provider interface สำหรับหลายระบบตั้งแต่รอบแรก
- ต้อง cache PAT ชั่วคราวเพื่อลด Keychain prompts หรือดึงใหม่ทุก request
- ระดับ threat model ต้องป้องกันเฉพาะ accidental disclosure หรือรวม malicious/untrusted model และ source code

## Change log

- 2026-08-09 19:25 — ปรับ path และ scope ให้ตรงกับการ maintain extension แบบ project-local
- 2026-08-09 12:56 — สร้างเอกสารเปรียบเทียบทางเลือกและเสนอ macOS Keychain เป็นแนวทางเริ่มต้น
