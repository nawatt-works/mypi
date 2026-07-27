# My Pi Setup

ชุดตั้งค่า Pi ส่วนตัวสำหรับใช้งานแบบ global จากทุก workspace โดยเก็บ source code และเวอร์ชันของ package ทั้งหมดไว้ใน repository นี้

Pi จะอ้างอิง repository นี้จากตำแหน่งปัจจุบันโดยตรง ไม่คัดลอกไฟล์ไปไว้ใน `~/.pi/agent` ดังนั้นเมื่อแก้ extension สามารถใช้ `/reload` เพื่อโหลดการเปลี่ยนแปลงได้ทันที

## สิ่งที่รวมอยู่

### Extensions ที่เขียนเอง

- `guardrails.ts`
  - อนุญาตให้อ่านไฟล์ทั่วไปได้โดยไม่ถาม
  - ถามก่อนอ่านไฟล์ที่อาจเป็น secret เช่น `.env`, credentials และ private keys
  - ถามก่อนเขียน แก้ไข ลบ หรือเพิ่มไฟล์นอก workspace
  - ตรวจ nested MCP/custom filesystem tools รวมถึง path ที่ส่งผ่านตัวแปร shell เมื่อวิเคราะห์ได้
  - ถามก่อนอัปโหลด local file, อ่าน sensitive environment variables และเขียนไปยัง output path ภายนอกที่รู้ล่วงหน้า
- `steering-choice.ts`
  - เมื่อ AI กำลังทำงาน การกด Enter จะแสดงตัวเลือก `Steer`, `Wait` หรือ `Cancel`
  - เมื่อ AI ว่าง การกด Enter ยังส่งข้อความตามปกติ
- `dependency-update-notifier.ts`
  - ตรวจ dependency ภายใน `my-pi` แบบ background ไม่ขวางการเปิด Pi
  - ตรวจอัตโนมัติไม่เกินวันละครั้งและใช้ timeout 10 วินาที
  - แจ้งเฉพาะเมื่อพบเวอร์ชันใหม่ และข้ามเงียบเมื่อ startup check ล้มเหลว
  - ใช้ `/mypi-updates` เมื่อต้องการบังคับตรวจทันที

### Third-party packages

- [`@juicesharp/rpiv-ask-user-question`](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-ask-user-question)
  - เพิ่ม structured question tool และ UI สำหรับให้ model ถามคำถามแบบเลือกตอบ

### Themes

- `modern-dark`

## ติดตั้งครั้งแรก

ต้องมี Pi และ Node.js พร้อมใช้งานก่อน จาก root ของ repository นี้ให้ติดตั้ง dependencies:

```sh
npm install
```

จากนั้นเพิ่ม repository นี้ลง Pi แบบ global โดยใช้ absolute path:

```sh
pi install /Users/developer/my-project/my-pi
```

อย่าใส่ `-l` เพราะ option นั้นจะติดตั้งเฉพาะ project ปัจจุบัน หลังติดตั้งแล้วให้เปิด Pi ใหม่ หรือใช้ `/reload`

ตรวจสอบ package ที่ Pi รู้จักได้ด้วย:

```sh
pi list
```

## การใช้งานจากเครื่องใหม่

1. Clone repository ไปยังตำแหน่งถาวร
2. เข้าไปใน repository แล้วติดตั้ง dependency ตาม lockfile:

   ```sh
   npm ci
   ```

3. ลงทะเบียน absolute path ของ repository กับ Pi:

   ```sh
   pi install /absolute/path/to/my-pi
   ```

Pi บันทึก absolute path ไว้ใน user settings ดังนั้นถ้าย้าย repository ต้องลบ path เดิมและติดตั้ง path ใหม่

## อัปเดต

อัปเดต third-party dependencies:

```sh
npm update
```

หากต้องการให้ตรงกับ `package-lock.json` ทุกประการ:

```sh
npm ci
```

หลังแก้ extension, theme หรืออัปเดต dependency ให้ใช้ `/reload` หรือเปิด Pi ใหม่

เนื่องจาก setup นี้เป็น local-path package คำสั่ง `pi update --extensions` จะไม่อัปเดต dependency ภายใน repository ให้ ต้องใช้ npm จาก repository นี้

Extension `dependency-update-notifier.ts` ช่วยตรวจ dependency เหล่านี้วันละครั้ง โดยเก็บ cache ที่ `.runtime/cache/` ซึ่งไม่ถูก commit หากต้องการตรวจทันทีโดยไม่รอรอบถัดไป ให้ใช้:

```text
/mypi-updates
```

## เพิ่ม package อื่น

1. เพิ่ม package เป็น dependency:

   ```sh
   npm install <package-name>
   ```

2. เพิ่ม resource ของ package ใน `package.json` ภายใต้ `pi.extensions`, `pi.skills`, `pi.prompts` หรือ `pi.themes`
3. ใช้ `/reload`

ควรตรวจ source code ก่อนติดตั้ง เพราะ Pi extensions ทำงานด้วยสิทธิ์ของ process และเข้าถึงระบบไฟล์ได้

## Guardrails และขอบเขตการป้องกัน

`guardrails.ts` มีไว้ลดความผิดพลาดจาก model และป้องกันการเข้าถึงข้อมูลสำคัญโดยไม่ตั้งใจ โดยพยายามถามเฉพาะการกระทำที่มีความเสี่ยง เพื่อไม่ให้ permission prompts รบกวนการทำงานปกติมากเกินไป

สิ่งที่ตรวจได้ครอบคลุม built-in tools, shell commands ที่วิเคราะห์ path ได้, nested MCP/custom filesystem tools และพฤติกรรมเฉพาะของ extensions ที่รู้จัก เช่น local file upload, PDF output และ screenshot path

Guardrails เป็น best-effort policy layer ไม่ใช่ security sandbox จึงยังมีข้อจำกัดที่ยอมรับไว้:

- ไม่สามารถเห็น side effect ที่ซ่อนอยู่ภายใน MCP server, extension, local script หรือ subprocess
- คำสั่งที่คำนวณ path ระหว่าง runtime อาจตรวจล่วงหน้าไม่ได้ทั้งหมด
- Slash commands และ startup hooks ของ third-party extensions อาจไม่ผ่าน `tool_call`
- Browser actions ขึ้นอยู่กับความหมายของหน้าเว็บ จึงไม่ได้ถามทุก navigation หรือ click
- Process ของ Pi, extensions และ shell ยังคงมีสิทธิ์ตาม OS user ที่เปิด Pi

สำหรับ setup ส่วนตัว ขอบเขตนี้เพียงพอสำหรับป้องกันความผิดพลาดทั่วไป หากต้องทำงานกับ code หรือ input ที่ไม่น่าเชื่อถือและต้องการขอบเขตที่ข้ามไม่ได้ ควรรัน Pi ใน container, VM, OS sandbox หรือ user ที่มีสิทธิ์จำกัดเพิ่มเติม

## ถอดออกจาก Pi

การถอด setup ออกจาก global settings จะไม่ลบ repository:

```sh
pi remove /Users/developer/my-project/my-pi
```

## งานที่วางแผนไว้

โน้ตสำหรับ extension ที่จะรวม persistent Todo กับ session handoff อยู่ใน `.workbench/notes/persistent-todo-handoff.md`
