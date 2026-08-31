# Chrome DevTools

> **Status:** stable third-party adapter · **Scope:** global

Adapter packageที่โหลด exact `@narumitw/pi-chrome-devtools@0.53.1` เป็น capability ของ My Pi

- Extension adapter: `extensions/index.ts`
- Runtime implementation, browser lifecycle, deferred tool loadingและ command `/chrome-devtools` เป็นของ upstream package
- Exact dependency pinและ integrityอยู่ใน package manifest/aggregate lockfile
- Browser profile/settingsยังเป็น stateของ Pi profileและไม่เข้า repositoryหรือ release
- Capabilityนี้โหลดเฉพาะ Coordinator/Default Pi aggregate; generated Worker profilesยังใช้ exact allowlistเดิมและไม่ inherit browser tools
