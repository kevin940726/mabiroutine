# Plan — 黑色坑洞: the game's one number, on a 14-slot week

Status: IMPLEMENTED 2026-10-19. The design below is what the working tree
implements; §3 records how each open choice landed and §5 is the copy now in
`tracker.json`.

Read §2.1 (the settled math) and §3 (how the choices landed) before touching
anything.

## 1. The rule and the problem

黑色坑洞 (`black-hole`; NOT `purple-hole` / 深淵的黑色坑洞):

- Weekly reset Monday 06:00 grants **7 attempts**, carryable within the week.
- Daily reset 06:00 grants **1 attempt**, expiring at the next daily reset.
- Week max = 7 + 7 = **14**.
- The in-game UI shows **one combined attempts-left number** `R` = weekly bank
  left + today's daily left (0–8). It never shows the split.

The current row is a weekly `countdown` max 14 whose stored value is "attempts
used this week", so the tile reads `剩 (14 − used) / 14`. Problems:

1. It is not the game's number. Monday, after using all 8 available, it reads
   `剩 6/14` while the game reads 0.
2. There is no daily row, so the expiring daily 1 has no home and no nudge.
3. A naive fix (max 8 = the game's number) fills mid-week the moment the day's
   attempts run out, and throws away the 14.

## 2. The design

One row, two axes:

- **Big number = the game's combined attempts left `R`** (0–8): the sync
  target, set with the existing tile drag. No dialog, no separate sync control.
- **Small text + fill = the week's 14**: `resolved / 14`, so the "max 14" stays
  on screen and the row can only fill on Sunday.

A second row, `black-hole-daily`, is the "use at least 1/day" nudge.

### 2.1 The math: the calendar stores the elapsed half

```text
bank     = stored `black-hole` (0..7): weekly extra attempts used (carryable)
today    = `black-hole-daily` tick (0/1): today's daily used
X        = daily resets still ahead this week, after today (Mon 6 … Sun 0)
elapsed  = 6 − X            // expired daily slots: 0 Mon … 6 Sun
resolved = bank + elapsed + today   // 0..14; a slot is resolved when used OR wasted
R        = 8 − bank − today         // the game's number; X cancels out
fill     = resolved / 14
done     = resolved >= 14           // bank 7 + X 0 + today 1 → the last daily
                                    // slot only (Sun 06:00 → Mon 06:00)
```

Each of the week's 14 slots lives in its natural home: the 7 carryable extras
in the weekly row, today's 1 in the daily row, and the elapsed days in the
**date**. Nothing needs storing for days that passed, so there are no reset
writes and no heuristic: a wasted daily raises the fill and holds `R` the
moment the clock passes 06:00, with zero logging.

- `X` comes from `src/lib/reset.ts`:
  `X = round((getNextWeeklyReset(now) − getNextDailyReset(now)) / 86400000)`.
  Monday after 06:00 → 6; the hours before Monday 06:00 still belong to the old
  week → 0; Sunday → 0. So the completable window is the week's last daily
  slot, Sunday 06:00 → Monday 06:00: the row can still finish on Monday morning
  before the reset, which is the game's week edge, not midnight.
- Writes (one store action, both rows, bucket-stamped, per character):
  - **Weekly row tap**: `today = 0` → set today (assuming the game consumes the
    daily first; §3.4 must confirm this); else `bank += 1` (≤ 7). One tap = one
    resolved slot.
  - **Daily row tick**: set today; untick clears it (a correction).
  - **Sync drag**: target `resolved = 14 − R − X`; pick `(today, bank)` that
    lands `bank` in 0..7, preferring the current today; `R = 0` forces
    today=1/bank=7, `R = 8` forces today=0/bank=0.
  - The tile's clamp is the resolved bounds `[6 − X, 14 − X]` (Mon 0..8 …
    Sun 6..14).
- Sync flow to put in the copy: **tick today's daily first (if used), then drag
  the big number to the game's R.** That makes the split exact; syncing without
  the tick still makes `R` exact, but a later tick can shift it by one.

### 2.2 Worked examples

```text
Mon 06:00   bank 0  today 0  X 6  elapsed 0  resolved 0   R 8  fill  0/14
Mon, all 8 available used
            bank 7  today 1  X 6  elapsed 0  resolved 8   R 0  fill  8/14  done? no
Tue 06:00   bank 7  today 0  X 5  elapsed 1  resolved 8   R 1  fill  8/14  done? no
Tue daily   bank 7  today 1  X 5  elapsed 1  resolved 9   R 0  fill  9/14
…
Sun         bank 7  today 1  X 0  elapsed 6  resolved 14  R 0  fill 14/14  done ✓

Daily-only week (bank never spent)
Sun         bank 0  today 1  X 0  elapsed 6  resolved 7   R 7  fill  7/14  done? no

Nothing logged all week
Sun         bank 0  today 0  X 0  elapsed 6  resolved 6   R 8  fill  6/14  done? no
```

The Monday case is the user's rule: `R = 0` but the row is not filled; the six
future dailies are the fill's missing six slots. The "nothing logged" Sunday is
the date leverage: six wasted dailies show as fill with no writes at all.

### 2.3 Logging, sync, known behavior

- A daily reset writes nothing: today's flag resets by bucket, `elapsed` grows
  with the clock. A used day keeps `resolved`; a wasted day adds 1.
- Unlogged attempts are the only thing the date cannot know; `R` is off by the
  unlogged count until a sync (the game must be read anyway), then exact.
- Sync without ticking today's daily keeps `R` exact but can put the split off
  by one; ticking afterwards would shift `R` by one. Hence the "tick first,
  then drag" copy.
- A daily-only week ends at `7/14` and the row never fills (the bank is left on
  the table); the daily row still completes each day. That is intended, not a
  bug.
- The weekly row tapping when the bank is full and the daily is unused sets
  today (the daily) and leaves the bank at 7.

## 3. Decisions

### 3.1 Settled — stored values (2026-10-19)

The week row stores the weekly bank used (0..7); the day row stores today's
daily (0/1); the elapsed daily slots come from the date. This is exact across
inactivity and missed dailies, which is the reason the sync exists.
`confetti.isSectionComplete` must use the derived `resolved` value (§4.5).

### 3.2 Settled — data `max`: 7, visible 14 (2026-10-19)

The stored value is the weekly bank (0..7), so the data `max` is 7. The tile
variant passes `max = 14` and shows `本週 resolved / 14`; the visible ceiling
stays 14, as the user asked. Do not "fix" the data max back to 14: the stored
value cannot exceed 7.

### 3.3 Copy

Settled: the user's wording in §5 is in `tracker.json`.

### 3.4 In-game spend order

Does the first black hole of the day consume the daily 1 first? If yes, the
weekly tap's auto-tick (§2.1) is right. If the player can choose, the copy must
say "今天的第 1 次先勾每日列" and the auto-tick must go. As built 2026-10-19:
daily-first, matching the copy's 優先使用上面的每日次數.

### 3.5 Daily row identity

The name is `每日黑色坑洞` (from the copy). As built: icon 🕳️, order 45
(between 兼職 at 40 and 亡靈之塔 at 50, away from 深淵的黑色坑洞 at 55).

### 3.6 Tile layout

The 44px mobile tile shows the big `R` and the small `8/14`; `本週` does not
fit there. The row name (`每週黑色坑洞`) and the desc (`上限 14 次`) carry the
`每週` context. The 56px desktop tile can try `本週 8/14`; the aria always says
`遊戲內剩 R 次；本週 resolved / 14`. As built: mobile `R` + `8/14`, desktop
`剩 R` + `本週 8/14`; the aria names both.

### 3.7 `hideCompleted`

As built: the filter uses the derived `done`, so the row hides only in the
week's last daily slot (Sunday 06:00 → Monday 06:00).

### 3.8 Settled — weekly row name

`每週黑色坑洞` (from the copy).

## 4. Shape of the change

### 4.1 Data — `src/data/tracker.json`

Update `black-hole` (keep id, icon, section/kind, `type: countdown`, source,
order 70; display name `每週黑色坑洞`). Per §3.2 the `max` is `7`; the tile
variant displays 14. Add:

```json
{
  "id": "black-hole-daily",
  "name": "每日黑色坑洞",
  "icon": "🕳️",
  "desc": "每日更新 1 次，沒用隔天會消失；點一下也會同步更新下面每週黑色坑洞次數。",
  "section": "daily",
  "kind": "daily",
  "type": "check",
  "source": "builtin",
  "order": 45
}
```

### 4.2 New leaf module — `src/lib/blackHole.ts`

Pure, no React, parallel to `purpleHole.ts`; uses `src/lib/reset.ts` only.

```ts
export const BLACK_HOLE_ID = "black-hole";
export const BLACK_HOLE_DAILY_ID = "black-hole-daily";
export function blackHoleState(bank: number | boolean | undefined,
                               today: number | boolean | undefined,
                               now: Date):
  { x: number; elapsed: number; resolved: number; remaining: number;
    fillPct: number; done: boolean; resolvedMin: number; resolvedMax: number };
export function blackHolePairForResolved(target: number,
                                         today: boolean, now: Date):
  { bank: number; today: boolean };
```

`blackHoleState` clamps a saved bank to 0..7 before it calculates, so an old
save that still holds 8..14 (the pre-update value) cannot make `R` negative or
the fill exceed 14. This is the content-only-max clamp, not a migration (§4.4).

### 4.3 Row + tile — `src/components/TaskRow.tsx`

- In both `TaskRowMobile` and `TaskRowDesktop`, for `task.id === BLACK_HOLE_ID`:
  read the daily row's value + `useNow` (the file already ticks), derive the
  state, and render the tile with `count = resolved`, `max = 14`, plus a variant:
  big `R` (desktop can show `剩 R`), small `8/14` on the 44px tile (desktop can
  show `本週 8/14`), fill `resolved/14`, `done = resolved >= 14`, and an aria
  label with both numbers. The row name and desc carry the `每週`/14 context.
- Pass custom `writes` (the `CounterWrites` shape `GoalGroup` already uses):
  `set` → `blackHolePairForResolved`; `inc` → the tap rule (today first, then
  bank); `dec` → the reverse; `clamp` → `[resolvedMin, resolvedMax]`;
  `done = resolved >= 14`. The default store writes clamp at the data max and
  would mis-handle the pair.
- The daily row's check tile keeps the tap gate + `celebrateAfterWrite`, but
  calls the new store action (§4.4) instead of `toggleCheck`.

### 4.4 Store — `src/store/useAppStore.ts`

One action (name TBD, e.g. `writeBlackHole({ bank?, today? })`) that writes the
pair in one `set()` (weekly row → week bucket; daily row → daily bucket; per
character). The `recordGoalRound` multi-row write is the precedent.

No `initial.version` / persist `version` bump; no `migratePersisted` step. The
persisted shape and the row's id/type do not change; the `max` change is
content-only and the next write clamps it (`docs/storage.md`).

Existing saves: the old `black-hole` value was "attempts used this week"
(0..14); the new slot means "weekly bank extras" (0..7). The values cannot map
exactly because the old number mixed the bank and the dailies. Keep the value,
clamp the derived bank to 0..7 (§4.2), and tell the user to sync once; the
first write rewrites the pair. The row can show a wrong number until that sync.
Put the one-time instruction in the changelog, not a migration.

### 4.5 Progress / hide / overall reads

The raw stored values (`bank`, `today`) are only half the story; the derived
`resolved` must feed everything that shows the row's progress:

- `TaskRow` (mobile + desktop) — its own done/hide visuals.
- `src/components/TrackerSection.tsx` — the `hideCompleted` filter and the
  `summarizeProgress` `getValue`.
- `src/App.tsx` — the overall `summarizeProgress` `getValue` (needs a slow
  `useNow`, 30s, so the ring rolls at 06:00 while the app is open).
- `src/lib/confetti.ts` — `isSectionComplete` must see `resolved >= 14`, or the
  weekly section can "complete" mid-week the moment the bank is spent.

`isTaskDone` / `taskCredit` keep their signatures — pass the derived value in,
never import `blackHole.ts` into them (they are shared with the Worker; the
Worker's mirror only covers `barrier`, so it stays untouched).

### 4.6 Docs, changelog, gates

- `docs/tracker-data.md`: rewrite the `black-hole` entry (stored bank, the
  combined number, the daily row, `elapsed`/`resolved`, Sunday-only done), add
  the daily row, update the Result counts (25 → 26 rows; 6 → 7 daily).
- `CHANGELOG.md`: `### Features` for the row change + the one-time note that
  the first look should sync from the game; `### Chores` for this plan doc when
  it is committed (per AGENTS, every commit updates the changelog).
- `scripts/check-tracker.entry.ts`: assert the pair's shape (`black-hole-daily`
  is a daily check; `black-hole` is a weekly countdown with `max: 7`), plus
  `blackHoleState` fixtures (Mon/Tue/Sun, before Monday 06:00, bounds, an old
  raw value of 14 clamped to bank 7, sync round-trip, done only at
  `resolved = 14`).
- `docs/storage.md` needs no new version step: the `max` change is content-only
  and clamps on the next write. The one-time "sync once" note goes in the
  changelog.
- `pnpm check` (all fourteen gates).

## 5. Copy (in tracker.json)

```text
每週黑色坑洞
每週更新 7 次，包含每日次數，上限 14 次；優先使用上面的每日次數；此剩餘次數與遊戲內顯示的數字一樣。

每日黑色坑洞
每日更新 1 次，沒用隔天會消失；點一下也會同步更新下面每週黑色坑洞次數。
```

The copy above is in `tracker.json`; the row names are the chosen labels.

## 6. Task breakdown

- **T1 Data + docs.** Add the daily row; update the weekly row per §3.2; update
  `docs/tracker-data.md`; extend `test:tracker` with the pair assertions and the
  old-value clamp fixture. Verify `pnpm test:tracker`.
- **T2 The module.** Add `src/lib/blackHole.ts` per §2.1 + the state fixtures in
  `test:tracker`. No UI change.
- **T3 The tile.** Derive the state in both row variants; add the tile variant
  (big R, small `8/14`; `每週`/14 in the name and desc); pass the custom
  `writes`. Verify on
  mobile and desktop and that every other counter is unchanged; `pnpm test:tap`.
- **T4 The pair writes.** The store action + the daily check's wiring + the
  weekly tap's daily-first rule. Verify: tick/untick and tap/drag move the fill
  and R consistently; the day bounds clamp; the two rows cannot disagree
  mid-render.
- **T5 Progress consistency.** Thread `resolved` into `TrackerSection`, `App`
  and `confetti.isSectionComplete`; add the `App` rollover tick. Verify the
  rings and the section celebration against the tile after a faked rollover.
- **T6 Copy + docs + gates.** The user's copy into `tracker.json` and
  `docs/tracker-data.md`; changelog (Features + the plan's Chores); `pnpm check`.

## 7. Verification plan

- `pnpm test:tracker` fixtures: the §2.2 worked examples; the before-Monday
  06:00 week; resolved bounds; an old raw value of 14 (bank clamps to 7); the
  sync round-trip (`R → pair → R`); `done` false in every mid-week case and
  true only at `resolved = 14`.
- `pnpm test:tap` (the daily check's write path).
- Visual (user): the big/small numbers at 44px and 56px; the fill at `8/14` on
  a Monday with everything used and the row not done; other counters unchanged;
  the daily tick and the weekly tap moving the same fill.
- Rollover: unit fixtures carry the proof; the user can also pin `now` in
  devtools. No screenshots requested.
- `pnpm check`.

As built 2026-10-19: the tracker fixtures above pass; the tile was exercised in
the dev app on desktop and at 390px (tap, right-click, keyboard, and the
mid-week `hideCompleted` case under a faked Tuesday clock — the row stays
visible at `R 0`, `9/14`); `pnpm check` passes (the sync E2E legs skip without
`pnpm dev:api`, as that gate says).

## 8. Traps

- **The tile is shared.** The variant must activate only for `black-hole`; keep
  `count`/`max`/`shown` identical for every other counter.
- **Do not pass the data max (7) to the tile.** The variant passes `max = 14`
  and `count = resolved`; the tap-at-full reset keys off `done = resolved ≥ 14`,
  never the bank ceiling — otherwise a tap at `bank = 7` would wipe the row.
- **The default store writes clamp at the data max and know nothing about the
  pair.** Custom writes are mandatory for this row.
- **The ring can lag the tile** if `resolved` is threaded into the tile but not
  into the `summarizeProgress`/hide/confetti reads.
- **`isSectionComplete` with raw values would celebrate mid-week** (bank spent).
  Thread it.
- **Two sync keys, no cross-device atomicity.** The pair writes two bucket keys;
  a mid-sync pull can transiently mix them. Same class as `recordGoalRound`'s
  parent + children.
- **Old saves hold 0..14 in a slot whose new range is 0..7.** No version bump:
  the shape and the row id/type do not change, the max change is content-only,
  and user progress wins. Clamp the bank to 0..7 in `blackHoleState`; the first
  write replaces the value. The first look can show a wrong number until the
  user syncs once — say so in the changelog.
- **Worker bundle.** `isTaskDone` / `taskCredit` are shared; pass derived
  values at client call sites, never import `blackHole.ts` there.
- CJK/CRLF: edit with the editor tools; verify bytes with node, never the
  terminal (AGENTS).

## 9. Not in this plan

- A reminder/bell lane for the black hole (the daily row is the nudge; a push
  lane is separate work).
- Automatic missed-daily writes at 06:00 (the date supplies the elapsed half).
- Renaming/merging 深淵的黑色坑洞, or any change to the purple hole.
- Showing the weekly/daily split as two visible pool counters — the point is
  one game number.
