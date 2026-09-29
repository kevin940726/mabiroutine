---
description: Correct the live purple-hole schedule (admin)
---

Load the `purple-schedule` skill and follow it for this correction: $ARGUMENTS

If the skill will not load, read `skills/purple-schedule/SKILL.md` directly and use the wrapper: `node skills/purple-schedule/scripts/purple-admin.mjs <command>` (read-only: `state`, `predict`; writes: `no-shift`, `shift-amount`, `anchor`).

Guardrails: read `state` and `predict` before any write, confirm the exact window or anchor with me first, never print or commit `MABI_ADMIN_SECRET`, and do not push or deploy anything. If no arguments were given, show the current state and the next few spawns (read-only) and ask what to fix.
