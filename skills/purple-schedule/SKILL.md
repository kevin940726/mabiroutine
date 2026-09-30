---
name: Purple-hole schedule correction
description: Correct the LIVE purple-hole spawn schedule on the worker (anchor, non-shifting maintenance windows, shift amount) through the /admin API. Load when the maintainer wants to fix purple-hole timing.
metadata:
  opencode/autoinvoke: false
---

# Skill: purple-schedule — correct the live purple-hole timing

Admin-only, and it edits **production**: the worker's published schedule that
every device reads. Load it when the maintainer wants to fix purple-hole spawn
times (a missed spawn, a maintenance that did not shift the timer, a wrong
anchor), or just to read the current schedule. It is not app code: no commit,
no build, no deploy.

## Prereqs

- `MABI_ADMIN_SECRET` in the process environment (the worker's `ADMIN_SECRET`).
  Export it, or keep the conventional local copy at `.env.admin.local` (repo
  root, gitignored via `.env*`) and load it per command with
  `node --env-file=.env.admin.local …`. Never pass it as a command argument
  (that lands in shell history), never commit it, never echo it. Do not use the
  root `.env.local`: `vercel env pull` regenerates that file and would wipe the
  value.
- Optional `MABI_WORKER_URL` to point at a non-default worker.
- Node on PATH (the wrapper's `predict` imports the real math module, which
  needs Node 22.6+ type stripping; it degrades to "predict unavailable" below
  that).

## Mental model

- The feed's `windows` are **timer-pause intervals**: each one inside a leg
  stretches that leg by the overlap. `anchorMs` is the last observed spawn.
- Error is asymmetric. A kept non-pausing window predicts LATE (a missed
  spawn); dropping a real pause predicts EARLY (a wait). When unsure, exclude
  the window rather than keep it.
- The wrapper talks to the worker `/admin` API. All writes are KV, effective
  immediately (when auto is unlocked), and reach devices on the next feed
  refresh (boot, foreground, 30-min tick, or opening the popover).

## Commands (run from the repo root)

```
node skills/purple-schedule/scripts/purple-admin.mjs state
node skills/purple-schedule/scripts/purple-admin.mjs predict 5
node skills/purple-schedule/scripts/purple-admin.mjs no-shift "2026-09-30 06:00"
node skills/purple-schedule/scripts/purple-admin.mjs shift-amount "2026-09-30 06:00" "2026-09-30 08:00"
node skills/purple-schedule/scripts/purple-admin.mjs anchor "2026-10-01 16:38"
node skills/purple-schedule/scripts/purple-admin.mjs promote
node skills/purple-schedule/scripts/purple-admin.mjs auto true
```

Times are Taipei wall-clock `YYYY-MM-DD HH:mm` (UTC+8, no DST) or ISO-8601.

If the secret lives in `.env.admin.local`, prefix every command with
`node --env-file=.env.admin.local` (the flag goes before the script path), e.g.
`node --env-file=.env.admin.local skills/purple-schedule/scripts/purple-admin.mjs state`.

## Workflow

1. **Read first.** `state`, then `predict`. Identify the window by its start
   time (Taipei) among the candidates; never guess a `startMs`.
2. **Pick the correction.**
   - Maintenance did not pause the timer → `no-shift <start>`. Adds a
     tombstone and removes any override at that start, so the window stops
     stretching legs. Survives watcher auto-apply while the announcement is
     still a candidate.
   - It paused by a different amount → `shift-amount <start> <effective end>`.
     The override keeps the announced start and changes only the end.
   - Predictions drifted from an observed spawn → `anchor <observed spawn>`.
     Publishes the observed spawn with the current windows, then resumes
     auto-apply if the doc was unlocked (a locked doc stays locked).
   - The whole published set is wrong → use the `/admin` page's full publish
     (that locks auto; resume from the page when done).
3. **Confirm the target with the maintainer before writing.** The window is
   the risky input; a wrong one silently shifts every later prediction.
4. **Sanity-check after the write.** The wrapper prints the new state and
   predictions; check the next spawn moved by the expected amount.
5. **Tell the maintainer** the change is live and when devices will follow.

## Guardrails / non-goals

- Never `git push` or `pnpm worker:deploy` for a schedule correction. It is KV
  data, not code.
- Never print, log, or persist the secret, and never pass it as an argument.
- `anchor` and any full publish lock auto-apply. `anchor` resumes it right
  after unless the doc was already locked, in which case it stays locked so
  hand-published windows survive.
- On a locked doc the worker stores overrides but does not apply them, so a
  `no-shift`/`shift-amount` can be a no-op. The wrapper prints a `NOTE` when
  that happens; resume auto (or use `/admin`) to apply it.
- Don't invent windows. `no-shift`/`shift-amount` refuse a start that is not a
  candidate or override.
- Tombstones and overrides match by `startMs`. If the announced start time
  itself is wrong, `no-shift` it and publish a corrected window from `/admin`.

## References

- `docs/operations.md` §6 (admin workflows) and `docs/purple-hole.md`
  (maintenance-pause assumption, why exclusion errs safe).
- `skills/purple-schedule/scripts/purple-admin.mjs` — the only code here.
