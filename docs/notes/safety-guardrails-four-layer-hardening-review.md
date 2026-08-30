# Safety Guardrails Four-layer Hardening Review

> **Status:** PASS — no High/Medium findings after corrections<br>
> **Commits:** `afd7ab4`, `d0610f2`, `f8bb328`, `ea9637d`, `c5b672b`<br>
> **Production:** disabled

## Scope

### 1. Workspace authority

- freeze immutable rootตอน `session_start`
- precedence: trusted explicit root → nearest canonical Git root → launch cwd
- แยก `workspaceRoot`จาก execution `cwd`
- subdirectory/siblingภายใน worktreeเดียวกันไม่เกิด false external prompt
- cwdหรือ canonical symlinkที่ออกนอก root fail closed

### 2. Canonical resource evidence

- secret classificationตรวจทั้ง lexical pathและ canonical target
- symlink aliasไป `.env`, auth/private-key pathถูกตรวจพบ
- sensitive uploadส่ง compound secret+upload findingsให้ resolver/UI
- upload approvalไม่ override dedicated remote-mutation stage
- shell environment parameter expansionและ indirect expansionถูกตรวจ

### 3. Command/tool analyzer

- stable detectorและ delegated command policyใช้ `isRemoteMutationCommand()` taxonomyเดียวกัน ซึ่งอยู่ใน pinned detector artifact
- push/publish/deploy/cloud/cluster mutationsเป็น HUMAN
- opaque inline/file/module/local executableเป็น HUMAN ไม่ใช่ REVIEW
- เฉพาะ nested shellที่ parserตรวจ payloadซ้ำได้จึงเป็น REVIEW
- MCP/custom command fieldsถูก inspect, malformed MCP args fail closed
- service/action tool namesและ explicit `remote-mutation` contractครอบ direct connectors
- bounded parser limits fail closed

### 4. Runtime, grants and audit

- scoped file operationsใช้ canonical evidenceและ `O_NOFOLLOW` file handles; intermediate-component TOCTOUยังเป็น documented OS/API limitation
- default write allowanceเป็น private mode `0700` temp rootต่อ session ไม่ใช่ `os.tmpdir()`ทั้งก้อน
- structured exact-resource grantsมี TTLสูงสุด 1 ชั่วโมง
- remote mutationไม่มี session-wide grant
- repeated exact denialเปิด circuit breakerหลัง 3 ครั้ง
- auditเก็บเฉพาะ finding kinds/outcomeและ per-session keyed HMAC digests; keyและ raw path/commandไม่ persist
- grant reuseมี audit event

## Independent review corrections

Initial reviewพบ:

1. opaque interpreter wrapperอาจลด remote HUMANเป็น REVIEW
2. direct mutating MCP/custom toolsบางรูปแบบ fail open
3. deterministic audit digestถูก dictionary attackได้

แก้โดยยก opaque codeเป็น HUMAN, เพิ่ม shared/direct remote taxonomy + contracts และเปลี่ยน auditเป็น random per-session HMAC

Correction reviewถัดมาพบ:

1. compound uploadอาจ suppress remote HUMAN stage
2. tool-name taxonomyไม่ครอบ `aws_s3_cp`, `gcloud_storage_cp`, `gh_workflow_run`, `az`, `terraform`, `helm`

แก้โดยแยก upload/remote stagesเสมอและ derive direct-tool semanticsจาก shared command taxonomy Final closure reviewไม่พบ High/Medium

## Verification

- full repository suite: `227/227`
- runtime/fault probes: `10/10`
- patched upstream typecheck/lint: PASS
- real-provider generated path: `19/19`
- profile digest: `9445ad8b171af11d51dc0f1312c3b3f20fe45f076658f954f8bce8f1b02b83ad`
- runtime authority digest: `b4e2a62884957ba51f809c835eeaacea0425412ae8f57578c5e45a47347ae7d4`
- interactive requests: `0`
- production activation: `false`

ไม่มี push, release/tag, production activationหรือ Default Pi switchจากงานนี้

**VERDICT PASS**
