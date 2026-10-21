# App menu, changelog, and the update prompt

Status: planned. `docs/plans/**` is a record of a point in time; the **ledger**
at the end is the only status surface. Change a row in the same commit that
changes its state.

Reviewed 2026-10-20; the findings are folded in below (baseline, sync engine
extraction, update-nudge suppression, gate registration).

## Start here

The changelog does not get a surface of its own. It becomes one row in a new
header menu, and that row opens a drawer. The menu replaces the theme toggle and
folds in sync and the data actions; the footer keeps attribution and install.

Two Markdown files carry the record: `CHANGELOG.md` stays the English technical
log, and `CHANGELOG-zh_TW.md` holds only the user-facing copy, starting at the
first release after this plan ships. A script derives
`src/data/whatsNew.generated.json` from the zh file and commits it. No GitHub
Releases workflow, no runtime fetch.

Order: menu shell → theme → sync engine → data rows → changelog → dot policy →
update prompt → gates. The menu shell comes first because every other piece is a
row in it; building the drawer first means mounting it twice. The sync row is
fourth, not third, because it needs an extraction (see Menu) and moving it is the
only step that triggers the live `test:sync` legs.

The evaluation build in the working tree (`?wn=a`, `?wn=c`, behind a `DEV` gate)
is scaffolding, not this plan: it keeps the strip and the deep links, both of
which are dropped below. It is uncommitted on purpose and is expected to be
reworked rather than extended.

## The rule

**Header holds state that changes on its own. Menu holds choices and actions.
Drawer holds content. Footer holds attribution.**

- Theme leaves the header: it only changes when the user acts, and the current
  toggle silently drops `prefers-color-scheme` — it writes an explicit
  `dark`/`light` on first touch, so the group who needed the control is the
  group that loses system-following. Its replacement is a three-state row.
- Sync leaves the header *after* its menu row carries live state, not before.
- The changelog gets an address — `CHANGELOG-zh_TW.md`, where every heading is
  linkable — which is why it needs neither a banner nor a deep link.
- Bahamut and Discord are the announcement; GitHub is the archive; the menu is
  the reader. They are not competing options.

## Header

Final state: `countdown · ☰`.

The countdown stays: it changes every second and it is the only reason to look
at the header. The theme toggle is replaced by the menu in step 2, so the header
drops from three controls to three (countdown, sync, ☰) and then to two when the
sync row lands.

The trigger is a hamburger, not `⋯`. The mobile character pill already spends
`⋯` on character-scoped actions, and two identical glyphs with different scopes
a few hundred pixels apart is the confusion to avoid. The glyph carries the
scope: `☰` is the app, `⋯` is the character.

The mobile countdown is two stacked lines today. Compress it only if a fourth
control ever returns; with theme gone there is no fourth control, so this is not
part of the build.

## Menu

`DropdownMenu` anchored to the trigger, `modal={false}` for the same reason the
character switcher uses it (Radix's scroll lock shifts the fixed pill), portalled
so the sticky blurred header cannot become the containing block.

Contract, so it does not rot into a junk drawer:

- Eight rows at most, one divider, no submenus; 外觀 is a single row of three
  compact radio segments; 安裝 App and 有新版本 appear only while relevant
  (installable, update waiting).
- Anything past that is a row that opens a drawer, not another item.

| Row | State shown | Opens |
|---|---|---|
| 有新版本 · 重新載入 | only while `updateReady` | reload |
| 更新記錄 | `最新 · 10/20`; amber dot on ☰ until the menu is opened (shared by sync) or the release window passes | changelog drawer |
| 同步 | `已連結 · 2 分鐘前` / `未連結` / `同步失敗` | sync dialog |
| 外觀 | three segments: 淺色 / 跟隨系統 / 深色 | inline, menu stays open |
| 安裝 App | only while installable | native prompt, or a steps dialog |
| — divider — | | |
| 匯出 JSON | | file save |
| 匯入 JSON | | file picker |
| 重置所有資料 | | confirm; destructive |

Not in the menu: 提醒設定 (deferred), `ExpSettingsDialog` (footer — the
experiment shell stays there for the next flag), attribution (footer),
character actions (pill).

**The sync row is not a button move.** `SyncButton` owns the background loop,
the visibility/reconnect handlers, the debounced push, the 6h absence logic and
the dialog. Inside a dropdown it unmounts whenever the menu closes, which stops
the engine. Extract instead:

- `useSyncEngine` mounted once in App: the loop, handlers, debounce, dialog
  state.
- `useSyncStatus` (external store): `linked`, `lastSyncedAt`, `failing`.
- The menu row subscribes to the store; a second `同步` entry point opens the
  same controlled dialog.
- `SyncToasts` stays where it is, mounted at App level.

This touches `src/sync/**`, so it triggers the live `test:sync` legs; budget
`pnpm dev:api` in the build order.

No dot on the trigger for sync: one glyph cannot mean two things. Sync failure
stays the existing three-failure toast plus the row's text.

## Changelog

Two Markdown files, two audiences:

- `CHANGELOG.md` — the English record. Technical, one section per release, every
  commit touches it (existing rule).
- `CHANGELOG-zh_TW.md` — the user-facing copy. zh_TW only, one section per
  release that has something to say. This is the app's source *and* the
  player-facing archive on GitHub.

```md
## 2026-10-20 — 預設置頂整理
<!-- release: 2026-10-20 — The default-pin audit -->

### 新功能
- 預設置頂新增五個必換的以物易物：麗莎的兩張催化劑、伊文的遙遠的星辰印章、茉莉的赤紅深淵的化石，以及阿爾米斯的銀合金錠。

### 修正
- 手機上連續快速點擊不再重複寫入。
```

- The marker names the English heading **verbatim**. It is invisible on GitHub,
  it is the release id, and it is what the parity gate compares. It beats
  slugging the label, which half the time is partly Chinese.
- **Baseline:** the file starts at the first release shipped after this plan, so
  the oldest section *is* the baseline. History before it stays English on
  GitHub; no backfill.
- After the baseline, a release with nothing user-facing carries
  `<!-- whats-new: none -->` under its English heading. That is the only way to
  say "intentional" instead of "forgotten" — internal `### Features` entries
  exist (test-gate refactors, comment purges) and must not force player copy.
- No `AGENTS.md` language exception is needed: this mirrors `README-zh_TW.md`, a
  user-facing document that is already zh_TW. The changelog section of
  `AGENTS.md` gains one authoring line and the `test:whatsnew` trigger bullet.

The app's entries are derived, not fetched:

- `scripts/whats-new.mjs` parses the zh file into
  `{ release, date, kind: "feature" | "fix", text }[]`, newest first, and writes
  `src/data/whatsNew.generated.json`.
- No slice: the JSON covers every section in the file. The file starts at the
  baseline, so this is small by construction; the drawer never silently caps the
  unread window.
- `--check` parses to memory and compares; `--write` is the cut step. The gate
  uses `--check`, so `pnpm check` never writes.
- Both Markdown files and the JSON are committed with the code, so the deploy
  that needs them already contains them. This is exactly what a GitHub Release
  cannot do — if one is ever added, it is created after the push.
- No fetch, no API route, no token, no rate limit, no offline gap.
- `whatsNew.generated.json` lives under `src/data` but is **generated**, not
  hand-edited; the `.generated.` name is the warning. `AGENTS.md` says
  `src/data/*.json` is hand-edited — add the exception there when this ships.

The changelog is a page, not an inbox. There is no seen marker and no unread
count: the drawer renders every release, and the row's `最新 · MM/DD` is just the
newest heading. The only state is the ☰ nudge.

- `whatsNewNudged` lives in the store (schema v23), not `localStorage`: it is the
  newest feature release the account has acknowledged. It rides the sync key
  space as `meta:whatsnew`, so opening the menu on one linked device quiets the
  dot on the others; the merge keeps the later release id, so an offline device
  cannot resurrect an old dot.
- The dot points at the newest `feature` release that is not acknowledged and
  whose Taipei heading date is today or the day before. A fixes-only release
  never dots. A fresh save has no marker and therefore no dot; the first menu
  open seeds it with the then-current release, so a later feature release
  re-arms it.
- Opening the menu acknowledges it. The acknowledgement does not change what the
  drawer renders; the page always carries the full record.
- Rendering: every release, newest first, grouped under the zh heading date
  (Asia/Taipei). Two releases on one day share a heading and keep their own
  bullets — the "aggregated but date-separated" shape.
- Kind tag per bullet, from `### 新功能` / `### 修正`.

No `tab` field and no jump link. A link that lands on a tab instead of the thing
it describes teaches people to ignore links, and with two tabs it is noise. The
bar for a future link is "it lands on the exact target" — only the shop jump
params meet that today.

## GitHub Releases, later (not this plan)

The archive is the rendered `CHANGELOG-zh_TW.md`: every release heading is
linkable, and its history is the archive's history. A Releases workflow is
deferred: it adds a tag and a second body to a cut that already happens up to
three times a day, and because a release would be created after the push, the app
would either lag one release or need a runtime fetch to stay current.

If shareable per-release pages are ever wanted, generate them at cut time from
the same section: the zh section becomes the visible body, the English record
goes inside `<details>`. The app does not read them, so the ordering problem
disappears.

## Dot policy

Badges fatigue for two reasons: they accumulate, and red means "something is
wrong". Rules:

- Amber, 6px, no number **on the dot**; the row carries `最新 · MM/DD`, not a
  count.
- Only for the newest unacknowledged `feature` release. A fixes-only release
  never dots.
- Acknowledged by opening the menu, not the drawer. The marker is the synced
  `whatsNewNudged` (`meta:whatsnew`), so a linked phone and desktop go quiet
  together; the page is unaffected. A newer feature release re-arms it.
- Expires after the release's Taipei day and the day after, so an ignored dot
  cannot sit for two weeks. The changelog is day-granular, so this is a
  calendar window, not 24 hours from the release.

The row is the page's latest date; the dot is a one-release nudge with a short
backstop. The acknowledgement is synced because it is about the person, not the
device; there is no unread state to disagree across devices.

## Update prompt

A waiting service worker used to be taken over silently: `onNeedRefresh` called
`updateSW(false)` unless a long-absence return armed a reload (`src/main.tsx`).
Caches refreshed, the tab kept old JS until the next navigation, and nothing
told the user a new version existed.

The waiting worker survives a reload that does not take it over — including the
6h absence path and a page opened after a deploy. Workbox re-dispatches `waiting`
at registration for a worker that was already waiting, so "a waiting worker
exists" is **not** the same as "an update just arrived". The nudge must not fire
on a page that has just loaded fresh HTML.

Stages:

1. **Suppress on boot.** A `waiting` event before registration completes, or
   within 3 seconds of it, is a pre-existing worker: take it over silently and
   set nothing. Only a later `waiting` event is a nudge. It has to be the
   *event's* timing, not the registration's `waiting` state: the client replays
   the event for a worker that was already parked, and a page that just rendered
   fresh HTML has nothing to announce. The window is anchored on registration
   rather than on module evaluation because registration runs on `load`, which a
   slow first paint can push past any fixed offset from boot.
2. **Nudge.** Mark `updateReady`; keep the cache takeover; raise one toast on the
   existing bus: `有新版本可用` + `重新載入`, with an explicit `ms` — 8s, long
   enough to act on and inside the bus's 10s action TTL (the receipt default is
   2.6s). If a `[role="dialog"]` is open or the tab is hidden, skip the toast —
   never interrupt an editor — but keep `updateReady` for the menu row.
3. **Confirm.** Accepting — the toast's button or the menu row, one shared
   `acceptUpdate` — writes a one-shot `sessionStorage` flag
   (`mabiroutine:update-receipt`) and reloads. The worker was already taken over,
   so the reload is a plain `window.location.reload()`; `updateSW(true)` after
   takeover is a no-op. The 6h absence path calls `updateSW(false)` before
   reloading and writes **no** flag: that reload was not asked for, so the page
   it lands on must not claim an update nobody accepted.
4. **Receipt.** After mount, an App effect reads and clears the flag and raises
   `已更新到最新版`. It is gated on hydration and runs after `SyncToasts` has
   mounted: the bus has no queue, so a dispatch from `main.tsx` before React
   mounts is lost. No panel opens by itself — a modal on boot is the most
   disruptive thing this feature could do; the amber dot already carries the
   status.

The ordering is the point: **the running bundle cannot describe the release it
has not loaded.** Its parsed notes predate the deploy, and fetching the new copy
would imply a runtime dependency and describe a release the user is not on yet.
Prompt before; after the reload the new bundle's dot is the payoff, never a
panel.

These are the only two toasts in the plan, and both are earned: one follows a
system event that needs a decision, the other confirms the reload the user just
asked for. The menu row outlives the nudge for anyone who ignores it. Content
itself never arrives as a toast; the bus is single-slot and does not pause on
hover, so the row is the accessible path.

Discovery already runs on visibility and reconnect, throttled; no new polling.

## Gates

`test:whatsnew`, offline, in `pnpm check`:

- the parser against fixtures: a normal section, a missing section, a malformed
  one, a marker with no section, a section with no marker;
- `src/data/whatsNew.generated.json` equals a fresh parse (`--check`, no write);
- parity with `CHANGELOG.md` from the baseline forward: every release with
  `### Features` or `### Fixes` has a zh section or `<!-- whats-new: none -->`;
  every marker resolves to a heading; no duplicates; newest-first; same order;
- the zh heading date equals the marker date;
- one marker per section, exactly; the file preamble may be `# 更新記錄` plus
  prose; a body may contain only `####`-free `### 新功能` / `### 修正` and `- `
  bullets; duplicate groups and empty sections fail;
- "no code identifiers" means no backticks, file names, paths, inline code, or
  commit-hash-shaped tokens — proper nouns like GitHub are fine.

Registering the gate is not one file:

- `package.json` script and the `GATES` entry in `scripts/check-all.mjs`;
- an `AGENTS.md` trigger bullet (the runner hard-fails without it);
- change "sixteen gates" to "seventeen" in `AGENTS.md`,
  `docs/development.md`, and the `scripts/pre-push-gate.mjs` header;
- a `docs/development.md` gate paragraph;
- the changelog entry.

No change to `scripts/pre-push-gate.mjs`'s rules; it runs `pnpm check`, which now
includes the new gate.

## Rejected

- **An inline `### 更新內容` block in `CHANGELOG.md`**: mixes languages in the
  English record, needs an exception to the language rule, and hides the
  player-facing page inside a technical file.
- **GitHub Releases as the source**: a tag and a second body per cut, and an
  ordering problem the committed file does not have.
- **Runtime fetch (API route or direct)**: no reason once the copy is committed
  with the code; it would add a failure mode to a feature that must never block
  the app.
- **A hand-kept `whatsNew.ts` array**: a second copy to keep in sync with the
  changelog, which is the drift this design exists to remove.
- **Full historical backfill**: 46 sections to write and review before the gate
  can pass; the archive starts at the feature's first release instead.
- **Strip + sheet (A)** and **one-time card (C)**: both need a second entry point
  next to the menu row and put content in flow on every load. A drawer behind one
  row does the same job with no layout shift.
- **Full-page feed with filters (B)**: a permanent navigation slot for a monthly
  read.
- **Toast for content**: receipts only.
- **Deep links**: they overpromise, and they couple the drawer to tab state.
- **Settings-only menu**: 提醒設定 is deferred and the menu also holds data
  actions, so this is an app menu (`☰`), not settings (a gear would lie).

## Cut runbook

When a release ships:

1. Label the English section: `## Unreleased` → `## <YYYY-MM-DD> — <label>`.
2. Add the zh section with the same date and a matching
   `<!-- release: ... -->` marker; 1–3 bullets, or write
   `<!-- whats-new: none -->` under the English heading when nothing is
   player-visible.
3. `node scripts/whats-new.mjs --write`.
4. Commit `CHANGELOG.md`, `CHANGELOG-zh_TW.md`, and
   `src/data/whatsNew.generated.json` together.
5. Fold the label into the tip commit as usual.

The gate fails if step 2 or 3 was skipped; the pre-push hook then blocks the
push, not the deploy.

## Ledger

| # | Piece | State | Notes |
|---|-------|-------|-------|
| 1 | Four-shape prototype | done | A/C/B/D evaluated; verdict: menu + drawer. Artifacts are throwaway. |
| 2 | Menu shell | shipped | dropdown, `modal={false}`, focus-return fix; 外觀 is its only row |
| 3 | Theme hook and row | shipped | App-level `useTheme`; `system` + `matchMedia`; unknown → system; 外觀 is one row of three icon segments |
| 4 | Sync engine extraction and row | shipped | `useSyncEngine` + `useSyncStatus`; the menu row carries the state; live `test:sync` legs |
| 5 | Data rows | shipped | 匯出／匯入／重置 under the divider; reset confirms via `ConfirmDialog`; footer keeps `ExpSettingsDialog` + attribution |
| 6 | `CHANGELOG-zh_TW.md` | shipped | root file with a preamble; its one section is the 2026-10-20 baseline (older releases stay English); `whats-new: none` for internal releases from here on |
| 7 | Parser and generated JSON | shipped | `scripts/whats-new.mjs`: `parseZh` + `--write` / `--check`, no other mode; strict, every unknown construct throws with its line; 3 entries at the baseline |
| 8 | Changelog drawer | shipped | page, not inbox: every release rendered newest first, row shows `最新 · MM/DD`, no seen marker; `MM/DD` groups with a 新功能/修正 tag; mounted beside the menu so it outlives the close |
| 9 | Dot policy | shipped | 6px amber on the ☰ trigger, `aria-hidden`, no number; newest unacknowledged `feature` release, 0–1 Asia/Taipei calendar days; opening the menu acknowledges it via the synced `whatsNewNudged` (`meta:whatsnew`); fixes-only never dots |
| 10 | Update prompt | shipped | a `waiting` event at registration (before it completes, or within 3s of it) is a replayed pre-existing worker: takeover only, nothing set, nothing shown; a later one marks `updateReady` (`src/lib/updatePrompt.ts`) and raises one 8s toast (`有新版本可用` + `重新載入`) unless a dialog is open or the tab is hidden; the ☰ row (`有新版本 · 重新載入`) is the durable path and shares `acceptUpdate`; accept writes `mabiroutine:update-receipt` then reloads, and the App effect raises `已更新到最新版` after `SyncToasts` mounted; the 6h path reloads with no receipt |
| 11 | Gate registration | shipped | `scripts/check-whatsnew.mjs` (`test:whatsnew`, no deps, read-only): parser fixtures, the JSON against a fresh parse via `--check`'s own `diff`, and parity with `CHANGELOG.md` from the baseline forward — every dated release has a zh section or `<!-- whats-new: none -->`, every marker resolves, nothing duplicated or reordered, marker date = heading date, no code identifiers in bullets; registered in `GATES` + the `AGENTS.md` trigger bullet, seventeen gates |
| 12 | Cut runbook | shipped | `docs/development.md` § Cutting a release: five steps, and why the three files move in one commit (a late JSON is the previous cut in the drawer, and no build notices); `AGENTS.md` § Changelog carries the one-line authoring rule beside the release-label bullet |
| 13 | Docs and both READMEs at ship | shipped | both READMEs state the ☰ menu and its rows, 外觀 as 跟隨系統 / 淺色 / 深色 (system default), the zh-backed drawer with its amber dot, and the nudge + receipt; `SyncButton` references in `docs/sync.md`, `docs/stories.md` and `docs/sql-migration.md` became `useSyncEngine` / `SyncDialog`; the "no update toast exists" claims in `docs/development.md`, `vite.config.ts` and `src/main.tsx` are corrected; `docs/storage.md` records the synced changelog nudge (`whatsNewNudged`, `meta:whatsnew`), the device-local theme and update receipt, and the generated `whatsNew.generated.json` exception; `AGENTS.md` carves the generated file out of the hand-edited rule |
| 14 | 提醒設定 in the menu | dropped | revisit later |
| 15 | Deep links in entries | dropped | — |
| 16 | GitHub Releases workflow | deferred | generate from the zh section if shareable pages are wanted |
| 17 | 安裝 App row | shipped | row + platform steps dialog; the footer loses the button |

When every row is shipped or dropped: fold the surviving rules into
`docs/development.md` (gates, cut) and the READMEs, then delete this file — the
same end `docs/plans/floating-pill-rework.md` met when its work landed.

## Traps

- Opening any dialog from a menu item fights focus: Radix returns focus to the
  trigger as the menu closes. `onCloseAutoFocus={(e) => e.preventDefault()}` on
  the menu, then open the drawer/sync/reset dialog. Applies to every one of them,
  not just the changelog.
- `modal={false}` on the menu, or the fixed pill jumps.
- The drawer must be portalled; the sticky header's `backdrop-filter` would
  otherwise become the containing block for its fixed position.
- `theme` currently stores only `dark` / `light`; `"system"` and unknown values
  must fall through to `prefers-color-scheme`, and a `matchMedia` listener must
  apply OS changes while in system mode. A row inside a dropdown would unmount
  that listener.
- Do not reuse the amber dot for sync failures or update-ready, and do not add a
  count to the dot. The row's text carries counts.
- The receipt toast does not queue. Raise it from an App effect after mount, or
  it is lost.
- The release marker must match the English heading verbatim. That is the point:
  a reworded heading is a gate failure, not a silent re-key.
- The zh file is a subsequence of `CHANGELOG.md`, never a superset: it may skip a
  release only with `<!-- whats-new: none -->`, it may never invent one, and it
  never reorders.
- The parser must fail loudly on unknown constructs. "Ignore what you do not
  understand" turns a typo into silently missing copy, and the gate is the only
  reader that would notice.
- `src/data/whatsNew.generated.json` is generated; never hand-edit it, and keep
  the `.generated.` name so the next reader knows.
