# Server push — work ledger

Branch: `feat/server-push` (unmerged, unpushed). Plan: `docs/server-push-plan.md`.
Conventions: newest entry on top, one line per fact. No commit hashes (history gets rewritten).

## 2026-09-18

- Branch cut from `main` (post purple-hole merge `c13a873`); account state probed — zero Workers, greenfield.
- Wrote `docs/server-push-plan.md`: Cloudflare checklist + 11-step setup guide, six-alternative review, build order, secrets table. Committed with CHANGELOG entry.
- Review verdicts pending user: (A) worker-side fanout spike before building Vercel fanout; (C) GH Actions backup promoted to Phase 1.5 after primary proves itself. Everything else stands as recorded.
- Next: spike A verdict → lock fanout location → scaffold `workers/push-cron`.
