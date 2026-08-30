# Safety Guardrails

> **Status:** stable · **Scope:** global

ตรวจ sensitive reads, local uploads, remote service mutations และ filesystem mutationsภายนอก workspace ก่อน tool execution Manual modeถามผู้ใช้เมื่อมี UI และ fail closedใน non-interactive mode

## Architecture

- Workspace authority: `extensions/workspace.ts`
  - freeze immutable rootตอน `session_start`
  - trusted explicit root → nearest canonical Git root → launch cwd
  - แยก `workspaceRoot` ออกจาก execution `cwd` เพื่อไม่ถามเมื่อทำงานใน subdirectory/siblingภายใน repository
- Detection: `extensions/detector.ts`
  - canonical/symlink-aware secret evidence
  - compound secret + upload findings
  - bounded shell parser, shared remote-mutation taxonomy และ command-bearing MCP/custom-tool inspection
- Resolution/grants: `extensions/resolution.ts`
  - structured exact-resource session grants, TTLสูงสุด 1 ชั่วโมง
  - repeated exact-denial circuit breaker
- Manual UI: `extensions/ui.ts`
- Redacted audit: `extensions/audit.ts`
  - append/event payloadมีเฉพาะ finding kinds, outcomeและ per-session keyed HMAC digests; ไม่มี keyหรือ raw paths/commands
- Stable entrypoint: `extensions/index.ts` ใช้ manual resolverเดิมโดย default

## Workspace และ temporary paths

Guardrailเปรียบเทียบ pathที่ resolveจาก current execution cwdกับ immutable workspace root ดังนั้น `packages/app` สามารถแก้ `packages/shared`ภายใน Git worktreeเดียวกันได้โดยไม่ถาม แต่ symlinkหรือ cwdที่ออกนอก rootจะ fail closed

OS temporary directoryทั้งก้อนไม่ได้รับอนุญาตอัตโนมัติอีกต่อไป ทุก sessionสร้าง private mode `0700` temporary rootของตัวเอง Trusted loaderสามารถเพิ่ม exact absolute rootsผ่าน `allowedWriteRoots`; `/dev/null`ยังใช้ได้

## Custom tool contracts

Loaderระบุ semanticsของ custom toolsได้ผ่าน `toolContracts` (`shell`, `fetch-content`, `path-aware`, `remote-mutation`) Command-bearing inputและ malformed MCP argumentsไม่ fail open Delegated compositionต้อง inject trusted resolverแบบ explicit; Worker inputเลือก resolverหรือถือ grantเองไม่ได้

Guardrailsเป็น defense-in-depth ไม่ใช่ OS sandbox Local scripts, extensions, MCP serversและ subprocessอาจมี side effectsที่ static analysisมองไม่เห็น งานกับ untrusted inputยังต้องใช้ container/VM/OS sandboxหรือ scoped execution identity
