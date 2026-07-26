# My Pi Setup

ชุดตั้งค่า Pi ส่วนตัวสำหรับใช้งานแบบ global จากทุก workspace โดยเก็บ source code และเวอร์ชันของ package ทั้งหมดไว้ใน repository นี้

Pi จะอ้างอิง repository นี้จากตำแหน่งปัจจุบันโดยตรง ไม่คัดลอกไฟล์ไปไว้ใน `~/.pi/agent` ดังนั้นเมื่อแก้ extension สามารถใช้ `/reload` เพื่อโหลดการเปลี่ยนแปลงได้ทันที

## สิ่งที่รวมอยู่

### Extensions ที่เขียนเอง

- `external-write-gate.ts`
  - อนุญาตให้อ่านไฟล์ทั่วไปได้โดยไม่ถาม
  - ถามก่อนอ่านไฟล์ที่อาจเป็น secret เช่น `.env`, credentials และ private keys
  - ถามก่อนเขียน แก้ไข ลบ หรือเพิ่มไฟล์นอก workspace
- `steering-choice.ts`
  - เมื่อ AI กำลังทำงาน การกด Enter จะแสดงตัวเลือก `Steer`, `Wait` หรือ `Cancel`
  - เมื่อ AI ว่าง การกด Enter ยังส่งข้อความตามปกติ

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

## เพิ่ม package อื่น

1. เพิ่ม package เป็น dependency:

   ```sh
   npm install <package-name>
   ```

2. เพิ่ม resource ของ package ใน `package.json` ภายใต้ `pi.extensions`, `pi.skills`, `pi.prompts` หรือ `pi.themes`
3. ใช้ `/reload`

ควรตรวจ source code ก่อนติดตั้ง เพราะ Pi extensions ทำงานด้วยสิทธิ์ของ process และเข้าถึงระบบไฟล์ได้

## ถอดออกจาก Pi

การถอด setup ออกจาก global settings จะไม่ลบ repository:

```sh
pi remove /Users/developer/my-project/my-pi
```

## งานที่วางแผนไว้

โน้ตสำหรับ extension ที่จะรวม persistent Todo กับ session handoff อยู่ใน `.workbench/notes/persistent-todo-handoff.md`
