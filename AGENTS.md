# Repository instructions

Before changing this repository, read `docs/README.md` and follow its minimal-reading table.
Do not load every historical document by default.

- Current architecture and compatibility rules: `docs/architecture.md`
- Active version plan and acceptance gates: `docs/v3.3.0-plan.md`
- New-site work only: `docs/new-site-guide.md`
- Historical rationale only when needed: `docs/history.md`

Root `README.md` and `README.zh-CN.md` are user-facing. Keep development plans,
internal audits, Agent instructions, and implementation history under `docs/`.

Preserve site adapters as capability providers; shared Reader, loading, retry,
prefetch, cache, and UI behavior must not branch on site names. Before handing
off an implementation, run the checks required by the active plan.
