# Web Access

> **Status:** stable third-party adapter · **Scope:** global

Adapter packageที่โหลด exact `pi-web-access@0.27.0` เป็น capability ของ My Pi

- Extension adapter: `extensions/index.ts`
- Runtime implementation, provider configurationและ tools `web_search`, `source_check`, `fetch_content`, `get_search_content` เป็นของ upstream package
- Exact dependency pinและ integrityอยู่ใน package manifest/aggregate lockfile
- Provider credentials/configurationยังเป็น stateของ Pi profileและไม่เข้า repositoryหรือ release
