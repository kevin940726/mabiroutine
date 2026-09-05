# Your data: where it lives, what updates do

MabiRoutine's design principle: static game data ships with the app;
**your progress belongs to you**.

## Two layers, two owners

- Static rows (`tracker.json` / `barter.json`) ship with each deploy and are
  never cached by your browser: renames, new descriptions, new `max` values
  take effect on the next deploy.
- Your progress (checks, counters, pins, custom tasks, hidden rows, order,
  preferences, barter filters) lives only in your browser: `localStorage` key
  `mabiroutine:v2`, keyed by row `id` against the static rows. Writes are
  idle-deferred (rapid taps never stutter) and force-flushed when you switch
  tabs or close; in the worst case you lose ~1.5 seconds of input.

## When the app updates (auto-migrate, nothing to do)

1. On load, missing structural defaults are filled in first (ancient saves with
   no version number and hand-edited saves get repaired, never a blank screen),
   then the save's schema `version` is compared and missing steps run in order
   before stamping. Your checks/pins/custom tasks are never overwritten — only
   default fields are filled and dangling keys pruned.
2. If upstream deletes a row (e.g. an `id` rename): leftover checks/hides/order
   for that row are cleared. Rename = delete + add, old progress does not carry
   over — back up important progress via footer 匯出 JSON (Export JSON) first.
3. Content-only changes (descriptions, `max`): take effect immediately;
   in-progress counters are kept and clamped to the new `max` on next tap.

## Conflicts & escape hatches (your data, your call)

- Across devices: use cross-device sync (auto-merges) or footer 匯出 JSON
  (Export) → 匯入 JSON (Import) on the other device (full replace — export a
  backup first).
- Importing an old backup: works as usual — missing fields are filled and
  dangling keys cleared on the spot; extra fields in the backup are dropped on
  the next save.
- Broken / start over: footer 重置所有資料 (Reset all data, double-confirmed,
  back to defaults: 1 character + must-have pins).
- Surgery by hand: DevTools → Application → Local Storage → `mabiroutine:v2`;
  if you break it, import a backup or reset.
