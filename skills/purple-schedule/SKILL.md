---
name: Purple-hole schedule correction
description: Correct the LIVE purple-hole spawn schedule on the worker (record, next-spawn corrections, suppression windows) through the /admin API. Load when the maintainer wants to fix purple-hole timing.
metadata:
  opencode/autoinvoke: false
---

# Skill: purple-schedule — correct the live purple-hole timing

Admin-only, and it edits **production**: the worker's published schedule that
every device reads. Load it when the maintainer wants to fix purple-hole spawn
times (a missed spawn, a wrong next, a suppression window that is wrong, a
stale anchor), or just to read the current schedule. It is not app code: no
commit, no build, no deploy.

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

- The cycle is **36h15m** (the pause model was dropped 2026-10-07: no
  observation shows maintenance affecting it). The timetable is two rays: the
  **record ray** supplies the 過去 rows, a **correction ray** supplies 下次.
- The record is up to two explicit points: `anchorMs` (the last observed
  spawn) and `prevMs` (the spawn recorded before it). Below `prevMs` the
  timetable derives backward at 36h15m; without `prevMs` it derives from the
  anchor. The pair exists because consecutive spawns are not always one cycle
  apart (the 2026-10-14 seam is 22h29m) and a derived `anchor − 36h15m` would
  invent a time that never happened. With neither a correction nor `prevMs`,
  the timetable degenerates to the old single lattice.
- A correction (`nextMs`) replaces the future: the next spawn is `nextMs`,
  then `nextMs + 36h15m`, and so on, until the next correction. The record and
  the 過去 rows stay exactly where they are.
- **The rule (maintainer, 2026-10-14): correcting the next spawn must never
  rewrite the recorded past.** `next` never moves `anchorMs`; only an explicit
  `anchor` does. A stored correction whose spawns have passed and are not yet
  recorded is never superseded silently: `next` refuses and names the spawn to
  record first (folding it into the record unseen was considered and rejected).
- The feed's `windows` are **suppression-only**: a card is skipped while the
  game is inside one (`isInMaintenance`), on both the purple and hourly lanes.
  They are not fed into the grid.
- Error is asymmetric. A window that is too wide suppresses a card that would
  have landed; too narrow sends a card while the game is down. When unsure of a
  window, exclude it rather than keep it.
- The wrapper talks to the worker `/admin` API. All writes are KV, effective
  immediately (when auto is unlocked), and reach devices on the next feed
  refresh (boot, foreground, 30-min tick, or opening the popover).

## The rule, worked (the 2026-10-14 example)

Record = 10-13 15:41:02, old prediction = 10-15 03:56:02. The maintainer
corrects the next spawn to 10-14 14:10:09 before it happens:

| step | 過去 (past 2) | 下次 |
|---|---|---|
| before the correction | 10-13 15:41:02, 10-12 03:26:02 | 10-15 03:56:02 |
| `next "2026-10-14 14:10:09"` | unchanged: 10-13 15:41:02, 10-12 03:26:02 | 10-14 14:10:09 |
| after the corrected spawn passes | 10-14 14:10:09, 10-13 15:41:02 | 10-16 02:25:09 |

The past does not move, the old prediction is replaced permanently (it never
resurfaces later as a past row), the chain re-phases to `nextMs + 36h15m`
(10-16 02:25:09, then 10-17 14:40:09, …), and nothing needs to be run when the
corrected spawn actually happens — its 過去 row appears on its own.

Edge cases, all verified against the engine:

- **A second correction while the earlier spawns were never recorded.** Two
  days later, `next "2026-10-16 20:00"` would put the past back to the record
  (10-13 15:41:02, 10-12 03:26:02) and swallow 10-16 02:25:09 / 10-14 14:10:09.
  The worker refuses it and names the value to use: record
  `anchor "2026-10-16 02:25:09"` first (it clears the caught-up correction),
  then `next`. The past reads 10-16 02:25:09, 10-14 14:10:09 before and after
  the correction.
- **A correction that never happened.** If a corrected spawn did not actually
  occur (a bad announcement, a missed read), the record-first rule above would
  force a false record. `forget <stored time>` is the explicit escape: it drops
  the stored correction and its rows without moving the record. The command
  makes you name the stored time (`state` shows it as next) as confirmation;
  the admin flap's 放棄 checkbox does the same. Never use it for a spawn that
  did occur — record that instead.
- **Recording an observation across a seam.** `anchor "2026-10-14 14:10:09"`
  after the restore keeps 10-13 15:41:02 as the row behind it (the auto
  `prevMs` = the latest known spawn before the new anchor). When the current
  doc is itself suspect (its anchor sits on a phase already known wrong, like
  the pre-restore doc on 2026-10-14), pass the previous explicitly:
  `anchor "2026-10-13 15:41:02" "2026-10-12 03:26:02"` — the auto value can
  pick a phantom.
- **A record nobody has updated for a while shows that stale past** — by
  design. The record moves on an explicit `anchor` only, never as a side
  effect of a correction; if the past looks old, record the newer spawn.
- **Recording a spawn a correction already predicted**
  (`anchor "2026-10-14 14:10:09"` while the doc says next = 10-14 14:10:09) is
  allowed: the caught-up correction clears in the same publish and the chain
  continues unchanged (next = 10-16 02:25:09, its own `+ 36h15m`).
- **A far correction** (next = 11-01 while the lattice predicts 10-15 03:56):
  the lattice items in between never surface as future; they are displaced.
  What was true before is not resurrected later, by design.

## Commands (run from the repo root)

```
node skills/purple-schedule/scripts/purple-admin.mjs state
node skills/purple-schedule/scripts/purple-admin.mjs predict 5
node skills/purple-schedule/scripts/purple-admin.mjs no-shift "2026-09-30 06:00"
node skills/purple-schedule/scripts/purple-admin.mjs shift-amount "2026-09-30 06:00" "2026-09-30 08:00"
node skills/purple-schedule/scripts/purple-admin.mjs anchor "2026-10-01 16:38"
node skills/purple-schedule/scripts/purple-admin.mjs anchor "2026-10-13 15:41:02" "2026-10-12 03:26:02"
node skills/purple-schedule/scripts/purple-admin.mjs next "2026-10-14 14:10:09"
node skills/purple-schedule/scripts/purple-admin.mjs forget "2026-10-16 20:00"
node skills/purple-schedule/scripts/purple-admin.mjs promote
node skills/purple-schedule/scripts/purple-admin.mjs auto true
```

Times are Taipei wall-clock `YYYY-MM-DD HH:mm` (UTC+8, no DST) or ISO-8601.
`anchor` takes an optional second time: the spawn recorded before it (`prevMs`;
defaults to the latest spawn the current doc knows before the new anchor).

If the secret lives in `.env.admin.local`, prefix every command with
`node --env-file=.env.admin.local` (the flag goes before the script path), e.g.
`node --env-file=.env.admin.local skills/purple-schedule/scripts/purple-admin.mjs state`.

## Workflow

1. **Read first.** `state`, then `predict`. Identify the window by its start
   time (Taipei) among the candidates; never guess a `startMs`.
2. **Pick the correction.**
   - A window should not suppress anything → `no-shift <start>`. Adds a
     tombstone and removes any override at that start, so it leaves the
     suppression list. Survives watcher auto-apply while the announcement is
     still a candidate.
   - A window's suppression coverage is wrong → `shift-amount <start> <effective end>`.
     The override keeps the announced start and changes only the end.
   - The next spawn is wrong → `next <corrected spawn>`. Swaps only the next
     spawn and everything after it; the record and the past rows stay exactly
     as they were. If the stored correction has spawns that passed unrecorded,
     the worker refuses and names the value to record first (see the worked
     example above); record it, then retry. (Deploy order: `nextMs`/`prevMs` are
     only understood by the build that ships them. A pre-field client ignores
     them and derives from the anchor alone, and the pre-field WORKER parses
     them away on publish and on every resolve (watcher, promote, resume,
     overrides), so a correction published early is erased while the CLI reports
     success. Publish corrections only once both deploys are live.)
   - A spawn was observed and should be recorded → `anchor <observed spawn>
     [previous spawn]`. Moves the record and recomputes the past rows (windows
     unchanged — they do not affect timing), then resumes auto-apply if the doc
     was unlocked (a locked doc stays locked). `previous` defaults to the latest
     known spawn before the new anchor; pass it explicitly when the current doc
     is suspect. A correction the new anchor has caught up with is cleared in
     the same publish.
   - A correction that never happened → `forget <the stored time>` (the value
     `state` shows as next). Drops the stored correction and its rows without
     moving the record. Only for a spawn that did not occur; if it happened,
     record it instead.
   - The whole published set is wrong → use the `/admin` page's full publish
     (that locks auto; resume from the page when done).
3. **Confirm the target with the maintainer before writing.** The window is
   the risky input for suppression; a wrong one quietly hides or shows the
   wrong cards. The anchor is what moves predictions.
4. **Sanity-check after the write.** The wrapper prints the new state and
   predictions; check the next spawn moved by the expected amount.
5. **Tell the maintainer** the change is live and when devices will follow.

## Guardrails / non-goals

- Never `git push` or `pnpm worker:deploy` for a schedule correction. It is KV
  data, not code.
- `next` never moves `anchorMs`; `anchor` is the only verb that moves the
  record. A stored correction with passed, unrecorded spawns is refused, never
  folded (the 2026-10-14 choice): record first, then correct. If a correction
  would sit at/before the record, record first too (the worker 400s on
  `nextMs <= anchorMs`), and `anchor` clears a correction the new anchor has
  caught up with. `prevMs` must sit strictly before `anchorMs`; the worker
  rejects the doc otherwise. The guard's one bypass is the explicit discard
  (`forget` / the 放棄 checkbox), never set on the auto paths.
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
  (fixed 36h15m cycle; windows are suppression-only, why exclusion errs safe).
- `skills/purple-schedule/scripts/purple-admin.mjs` — the only code here.
