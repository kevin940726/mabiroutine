# npc-shop ledger

Working ledger for the NPC shop browser: what shipped on `wip/shop-browser`,
why it looks the way it does, and the scoped plan for the one piece of real
work left (pinning gold-only shop purchases).

Data knowledge for the two source files lives in `docs/tracker-data.md`; this
file is about the UI and the pin model, not about scraping or field meanings.

**Read section 0 first.** It is the handoff: what is next, in what order, and
the traps that cost time on this branch.

---

## 0. Start here

### Where the branch stands

`wip/shop-browser`, unmerged, **six commits ahead of the prototype baseline and
four behind `main`**. Nothing has been pushed. Per `AGENTS.md`, pushing is a
separate decision from committing and needs explicit approval; a rebase onto
`main` is required before this could go anywhere, and no conflict is expected
since the branch touches the barter tab and `main` touched sync and reordering.

Committed, oldest first:

1. `Fix long dropdown menus overflowing the viewport`
2. `Give MenuSelect an accessible name and optional option icons`
3. `Replace the barter tab with the NPC shop panel`
4. `Pin from the shop panel through the tracker's pin list`
5. `Add the npc-shop ledger`
6. `Delete the barter list UI the shop panel replaced`
7. `Group the NPC picker by town and stop the popup being narrower than its trigger`

### What is next, in order

**The gold-pin work is done.** All 194 rows are pinnable, a gold pin shows on the
dailies with its cost and limit, and it syncs. Section 2 records what shipped,
the two premises in this ledger that turned out to be wrong, and the id
namespace rules for whoever adds a third one.

Nothing is queued. If you want more from this branch, the candidates are in
section 3, and the deliberate "no" answers are in section 2 under "Open
questions — answered" — reminder bells and seeded gold pins were both declined,
with reasons, so do not re-open them without new information.

1. **Rebase onto `main`** when the user asks for it. Not before.
2. Ship it. The remaining work before this reaches users is a rebase, not code.

Deliberately **not** doing, and why:

- **Item icons.** 167 distinct icons for the shop view. A capture pipeline was
  built and proven on 11 of them, then deleted: the stock-count pill in the
  in-game tile overlaps the art and could not be removed without leaving visible
  notches, and the user called the effort not worth it. Revisit only with a
  capture method that avoids the pill.
- **A store version bump for gold pins.** Reasoned out in section 2; it would
  be wrong to add one.
- **Removing `barterFilters` from the store.** It is unreferenced but
  persisted, and removing a persisted field is a shape change that costs a bump.

### Traps on this branch

Each of these cost real time and will again.

- **Never edit a CJK-bearing source file through PowerShell.**
  `Get-Content -Raw` plus `Set-Content` round-tripped `src/lib/shops.ts` and
  `src/components/BarterExplorer.tsx` and mangled every Chinese character.
  Worse, `Set-Content -NoNewline` on an **array** silently collapsed a 429-line
  file to one line. Use the editor's own edit tool. If a file must be truncated,
  slice the array and write it **without** `-NoNewline`. After any such edit,
  `rg` output through PowerShell will look corrupted even when the file is
  fine; confirm with a real file read or a browser screenshot, not the terminal.
- **Test harnesses: write CJK literals, never `\uXXXX` escapes.** Escapes written
  into a `.mjs` file got mangled twice and produced false readings that looked
  like real bugs (a "missing" 伺服器 badge, a "missing" pin button). Both were
  harness bugs, not app bugs.
- **`element.click()` via `page.evaluate` bypasses actionability checks.** Using
  it to select dropdown items is what let a 37-item menu pass tests while the
  lower half of the list was physically unclickable: the menu panel was
  `overflow-hidden` with no max-height. Prefer a real `locator.click()`; if it
  times out with "element is outside of the viewport", that is a genuine bug.
- **`AGENTS.md` says the store is at `v17`. It is at 19**
  (`useAppStore.ts:216` and the persist config at `:1037`). Trust the code.
- **Never name an item, NPC or string that came out of a terminal.** PowerShell
  mangles CJK on the way out, so a node script piped or redirected through it
  returns mojibake. Writing plausible-looking names over the top of that is
  fabrication, and it happened: an explanation of the pin-id collisions quoted
  an NPC and two items that do not exist anywhere in the data (0 occurrences
  across all four files), invented to fill in unreadable output. The fix is
  mechanical: have the script write the file itself with
  `fs.writeFileSync(path, text, "utf8")` and read *that* back, or query with the
  read/grep tool. Counts and ids are ASCII and survive the console, so a summary
  full of numbers can still be trusted while any prose in it cannot.
- **The load-time sanitizer has no test coverage.** The `barterCustomOrder`
  filter lives in the store's load path, not in `migratePersisted`, so
  `scripts/migration-check.entry.ts` cannot reach it. A green `pnpm check` does
  not prove it. This is the one change in Phase A with that gap.
- **The dev server is the user's.** It runs on `localhost:5173` and they start
  it. Do not start, kill, or restart a long-running dev server. A throwaway
  `pnpm exec vite preview` on another port, started and killed inside one
  command, is fine when the dev server serves stale modules.

### Running and verifying

- `pnpm check` is the gate: lint, shops, migrations, engine, quota, SQL smoke,
  fallback, sync, build. The `api-live` and `browser-e2e` sync suites skip
  loudly without `pnpm dev:api`; they do not cover this code.
- Browser checks were done with `playwright-core` driving the already-running
  dev server, in throwaway scripts under
  `C:\Users\User\AppData\Local\Temp\opencode\pwtest\`. Nothing test-related is
  committed; the repo has no browser test harness for this.
- Useful selectors: the NPC field is `getByRole("button", { name: "NPC" })`, the
  town field `name: "城鎮"`, options are `menuitemradio`, tabs are
  `[role="tablist"][aria-label="NPC 交易類型"]`, and tiles carry
  `data-shop-tile`. Barter rows are `<div>`s, not `<article>`s: count them with
  `[class*="contain-intrinsic"]`.

---

## 1. What shipped

### The fork, and how it was decided

Eight layouts were built and thrown away (variants A-M) behind a
`?shopproto=` gate. The gate is gone. The winner was **K, compact selectors**:
a town dropdown, an NPC dropdown, and one content panel. The deciding argument
was that once a direction is chosen, the remaining work is polish, and polish
done in a prototype shell gets written twice because the shell reimplements
search, pin, and selection state.

Layout rules that survived, each one a deliberate call:

| Rule | Why |
|---|---|
| All 194 shop rows, not just the curated barter ones | The old tab showed a flat 107-row curated list, hiding most real trades |
| One `金幣` / `以物易物` tab pair **per NPC**, no page-level toggle | The toggle was page-level friction over 36 NPCs |
| A tab renders only when that NPC has that kind of trade | 23 of 36 NPCs are barter-only; a dead 金幣 tab is noise |
| Gold renders as tiles, barter keeps the full row | Gold is a price comparison (tiles scan); barter is a recipe, and the material breakdown is the point |
| Default order is `barter.json`, gold last | The curated order is hand-written intent; `shops.json` order is not |
| Curated and uncurated rows share one row style | A plainer "gold row" read as a different kind of object |
| No item icons | 167 distinct icons for the shop view; not worth the capture |

### Files

| File | Role |
|---|---|
| `src/lib/shops.ts` | Adapter over `shops.json` + `barter.json`. Curated matching, `ShopDeal` with `curatedIndex` / `barterId` / `scopeAccount`, `costText`, `getText`. This is where Phase A adds `pinId` |
| `src/components/MerchantPanel.tsx` | The whole tab. Private helpers, exports one component |
| `src/components/BarterExplorer.tsx` | Misnamed now: it holds only `BarterRowDesktop` / `BarterRowMobile` / `BarterPinButton` / `BarterJsonRow` / `capText` after the dead list UI was deleted |
| `src/components/MenuSelect.tsx` | Shared dropdown-select. Now takes an optional per-option `group` (rendered as a heading), optional `ariaLabel`, optional `contentClassName`, and floors the popup at the trigger width |
| `src/components/ui/dropdown-menu.tsx` | Capped to Radix's available height and made scrollable. This is what made 36 NPCs reachable |
| `src/App.tsx` | Lazy-loads `MerchantPanel` where `BarterExplorer` used to render. The `?shopproto` prototype gate is gone, so there is no A/B harness any more |

### Decisions worth remembering

- **No router.** Deep links are query params, matching the existing
  `?task=` / `?chars=` reminder convention. `?npc=` is deliberately **not**
  stripped after use, unlike those, so an NPC view is shareable and survives a
  reload. The panel reads it once on mount and forces `town` back to `all` so a
  stale town can never hide the deep-linked merchant.
- **Pins are the tracker's pins.** The panel passes no `pinned` / `onTogglePin`
  overrides to `BarterRow*`, so those rows read and write the store's
  `barterPins` directly. One pin per barter id, shared with the tracker tab,
  synced, and visible from a second device. Verified: pin in the panel, the
  tracker renders it, survives a tab switch and a reload.
- **The 已選 count is the tracker's count**, so it opens at the seeded default
  pins (9) rather than 0. Intended, but visible.
- **All 194 rows are pinnable.** Curated barter rows pin under their
  `barter.json` id; the other 102 pin under a `shop::` id. See section 2.
- **Deliberately not built:** item icons (see section 0), reminder bells and
  seeded gold pins (see section 2), removal of `barterFilters` (see section 0).

### Verified

`pnpm check` green (shops, migrations, engine 300 iterations, quota, SQL
smoke, fallback, sync; the `api-live` and `browser-e2e` suites skip loudly
without `pnpm dev:api` and do not cover this code). In-browser at 1440px and
390px: no console errors, no horizontal overflow, deep link survives reload and
ignores an unknown name, every NPC reachable by mouse, pin shared with the
tracker and persisted, grouped NPC list one heading per town, popup never
narrower than its trigger.

---

## 2. Gold pins: shipped

Pinning gold-only purchases is **built and merged into this branch**. All 194
rows are pinnable. Phases A to D each landed as their own commit, in this order:

| Phase | Commit | What |
|---|---|---|
| A: ids and model | `Give shops.json rows a pin id, and the store a shared valid set` | `shopPinId`, `ShopDeal.pinId`, `TaskSource` += shop, `shopMeta`, `validPinnableIds`, `shopDealToTask`, mixed ordering, widened load filter |
| B: tracker rows | `Render a pinned shop purchase on the dailies` | `TrackerSection` resolves both namespaces, `TaskRow` grows a shop case |
| C: panel affordance | `Put the pin button back on the 102 rows that had none` | `GoldPinButton` on tiles, shared `BarterPinButton` on uncurated rows, `已選交易` matches on `pinId` |
| D: sync and docs | `Sync a shops.json pin, and say so in the docs` | E2 adoption case, `docs/tracker-data.md`, both READMEs |

Still deliberately not done: reminder bells (decision 1) and seeded gold pins
(decision 2), both for the reasons recorded under "Open questions — answered".

### Two premises in this ledger were wrong, and the data said so

Worth keeping, because both were reasoned rather than measured.

1. **The recommended id `shop::<npc>::<name>` collided — and then it didn't.**
   It was justified by `npc::name` being unique across the gold rows, which is
   true but irrelevant on its own, because the namespace also covered barter
   rows nobody had curated. Over all 192 rows `npc::name` collided **9 times**,
   4 of them across kinds: 基利安 sells 四葉草 for 750 gold and also trades
   蒜香橄欖油義大利麵 ×1 for it; 艾琳's 銀合金錠 goes for 特殊鋼錠 ×3 *and*
   合金鋼錠 ×30; 愛麗沙's 麵粉 goes for 雞蛋 ×3 *and* 薰衣草花 ×1.

   The first fix was a fourth `::currency` segment, which made all 192 distinct.
   That turned out to be treating the symptom. Two measurements collapsed it:
   in all 4 cross-kind pairs the **barter** side was already curated and it was
   the **gold** side that was not; and in all 5 barter-vs-barter pairs **both**
   sides were already curated. So no collision sat between two rows that both
   needed a `shop::` id.

   The real cause was upstream: 8 blueprint barter rows were failing to match on
   bracket width alone (`(3級)` vs `（3級）`), which is what left them uncurated
   in the first place. Folding that in `matchKey` made all 98 barter rows
   curated, the `shop::` namespace became exactly the 94 gold rows, and those are
   unique on `npc::name`. The short id is now correct on its own terms, and the
   currency segment is gone.

   The data was then unified as well, so the fold is defence rather than a
   necessity: `shops.json` is the checked record of the game's item text and is
   unanimously half-width (9 of 9), so the 11 full-width rows in `barter.json`
   were the drift. Prose parens in a `note` are a different thing and stay
   full-width.

   The lesson worth keeping: I reached for a key that was unique across a
   *narrower* set than the one the key had to cover, and the symptom I found
   (9 collisions) was measured on the right set while the fix was reasoned from
   the wrong one. Measure the set the key must span, not the set that is handy.
2. **Sync adoption does not filter dangling ids.** The plan implied a peer could
   not inject an id for a row that no longer exists. It can: the protocol unions
   every `pin:` key into `barterPins` and has no catalog to check against. A dead
   `shop::` id survives until a version bump prunes it, which is exactly how a
   dead barter pin has always behaved. Proven by the E2 case and by fixture T.

### Two things the work list missed, found while building

- **清除本區** resolved pins through `barterJson.find` and skipped anything
  else, so a gold counter would never have been clearable. `pinCycleOf` and
  `isServerSharedPinId` now resolve both namespaces.
- **The load-time `barterCustomOrder` filter** was barter-only, so a shop pin
  would have dropped out of the drag order on every load. Widened to the shared
  set. This is the change the ledger had flagged as having no automated
  coverage, and it still does not: `normalizePersisted` is not exported, so
  `migration-check` cannot reach it. The migrate-step prune *is* covered, by
  fixture T.

### Id namespace, for whoever edits this next

`barterPins: string[]` holds both `barter.json` ids and `shop::` ids. Valid ids
come from one helper, `validPinnableIds` in the store, which unions tracker +
barter + custom + `shopPinIds()`. Every prune step calls it. **If you add a
third id space, that helper is the only place that learns about it** — a step
that rebuilds the set by hand is how every gold pin gets deleted on the next
version upgrade. The v5 step is the one deliberate exception: it treats an
unknown id as corruption and reseeds, so it stays barter-only.

`ShopDeal.pinId` is the single place a deal's pin identity is decided, and
`MerchantItem.pinId` carries it into the panel. Do not reuse `MerchantItem.key`
for this: it includes the row's index within its NPC and is not a stable id.

### Tradeoffs taken, so they are not mistaken for oversights

- A gold tile's pin target is `size-6`, against the row button's 44px. Keeping
  the grid dense won; the emerald fill matches the row buttons so the action
  still reads as one thing.
- A shop row keeps its yield in the title ("紙 ×5") where a barter row strips it,
  because the barter hover card spells out the full exchange and a shop row has
  no such card.
- Shop pins carry no 必換 badge. Uncurated barter rows also pin under a `shop::`
  id and have no priority, so they would never show one.
- Ordering is barter.json file order, then shops.json order, both spaces sinking
  unknown ids to the end so a stale id cannot displace a real one. That is
  decision 3, and it is why the load-time order filter is load-bearing.

### Verified

`pnpm check` green. 19 migration fixtures including T. E2 proves a real `shop::`
id is adopted from a peer and a fabricated one is accepted by the protocol.
In-browser at 1440px: 14 gold tiles and 14 pin buttons on 康納, 已選 9 to 10 on
pin, the row appears in 已選交易, the tracker shows it under 以物易物已釘選 sorted
after the barter pins reading "50 金幣 · 不限次數" with no material card, and it
survives a reload. No console errors.

### Open questions — answered

Decided by the user 2026-09-27:

1. **Reminder bells: no.** Gold pins are not reminder-eligible. "Go spend gold"
   is not the same kind of reminder as "gather these eight herbs". Keep step 8
   out of the plan; do not touch `useHourlyReminders`.
2. **Seeded gold pins: no, not now.** `src/data/defaultPins.json` stays
   barter-only. Revisit later if the gold shop earns a curated must-list of its
   own.
3. **Ordering: after the barter pins, and reorderable.** Shop pins sort after
   barter pins in `shops.json` order by default, and the user can drag them
   anywhere. This makes step 3 load-bearing rather than cosmetic: the drag order
   array must accept a mixed list, not just barter ids.
4. **Account-scoped gold rows: yes.** `scope: account` mirrors barter's
   `perChar: false`, keeping value and hide state in the account scope.

### No version bump was needed, and that is load-bearing

The whole branch is unreleased and the gold shop is unreleased too, so no user
could hold a gold pin when this landed. Against the store's own trigger for a
bump (a changed persisted shape):

- `barterPins` stays `string[]`; only its *values* widen. No shape change.
- `barterCustomOrder` stays `string[] | null`. No shape change.
- `shopMeta` is an optional key on the `Task` value type, never written for
  custom tasks, and `TaskSource` merely gains a member. Neither appears in the
  persisted state object.

So the 19 to 20 step collapsed to nothing, and no migration fixture is required
for a migrate step. **This stops being true the moment the branch ships.** If
gold pins ever ship to users and the persisted shape then changes, both the bump
and a fixture come back — and the prune steps must already be calling
`validPinnableIds` by then, which they now are.

---

## 3. Other known follow-ups

1. **Dead code: done.** `BarterExplorer.tsx` lost its 107-row list UI (429 to 283
   lines) along with the explorer-only `PRIORITY_ORDER` / `PRESENT_PRIORITIES` /
   `TOWNS` and nine imports. What remains is only what the panel reuses: the two
   row components, the pin buttons, `BarterJsonRow`, `capText`. The file is now
   misnamed for what it holds; renaming it to something like `BarterRows.tsx`
   would be honest, but it churns two import sites for no behavior gain, so it
   is left alone deliberately.

   `barterFilters` / `setBarterFilters` in the store are now unreferenced but
   still persisted. They were left in place on purpose: removing a persisted
   field is a shape change, which means a store version bump, which is not worth
   spending on a filter set the new panel does not have. If the old filter
   concept ever comes back, they are still there and correct.

2. **`?npc=` staleness: checked, no change needed.** This was flagged
   speculatively and turned out to be wrong. Verified in the browser: selecting an
   NPC sets the param, choosing 全部 NPC clears it, 清除篩選 clears it, changing
   town clears it, a cold load of `?npc=佛格斯` selects that merchant and forces
   the town back to 全部城鎮, an unknown name is ignored and falls back to 全部商店
   with all 192 rows rather than blanking, and the param survives a tab round
   trip, which is the point of a shareable link. Nothing to fix.
3. **NPC faces and the 36-item list: done.** The NPC dropdown is grouped under
   town headings in `TOWN_ORDER` and the popup is now at least as wide as the
   trigger that opened it. The original note here blamed the 20px portraits, and
   that was wrong: inspected at 2x, most faces are distinguishable and only a
   few pairs are close. The real cost was 36 rows in one flat scroll that was
   *already* town-ordered while showing nothing about it. Grouping surfaced the
   ordering that was there and cut the scan. If the faces still read poorly in
   person, `size-6` is the cheap follow-up, not the fix.
4. **Gold tiles dropped the limit line** when the kind badges were removed. It is
   back on line 3, but the tile no longer shows which NPC it belongs to, because
   the grid is only used inside a selected merchant. Correct as-is; noting it in
   case a future all-shops grid is wanted.

---

## 4. Data facts this depends on

Measured, not assumed. Re-run the counts if `shops.json` or `barter.json` change,
and measure them by having a script write a UTF-8 file rather than printing to the
console (see the terminal trap in section 0).

- `shops.json`: 194 rows, 37 NPCs, 8 towns. 94 gold (`kind` omitted), 100 barter.
- 24 NPCs are barter-only, 13 are mixed, 0 are gold-only.
- All 100 barter rows match a `barter.json` row, so every barter row is curated and
  only the 94 gold rows need a `shop::` pin id. This used to be 90 of 98: eight
  blueprint trades failed to match on bracket width alone, since `shops.json`
  writes `設計圖(3級)` and `barter.json` wrote `設計圖（3級）`. `matchKey` now
  folds full-width `（）；：，` to half-width for matching only.
- **Zero** curated rows lack a shop entry, and zero shop barter rows lack a
  curated one, in both directions. The last gap in each direction was closed:
  阿蘭雯 was absent from `shops.json` entirely, so their two curated trades were
  injected as curated-only rows and could not be reached by picking the NPC; and
  their 精靈的痕跡 row then missed on one character, `精靈的痕跡` against
  `精靈痕跡`, which left a `situational` curated row unreachable anywhere. Note
  that `pnpm test:shops` passed through both of those, because twin cap parity
  pairs rows by name and a name mismatch makes it blind.
- All 94 gold rows are unique on `npc::name`; none has a null price. This is the
  invariant that lets the pin id be `shop::<npc>::<name>`.
- Pin counts as shipped: **all 194 pinnable** — 100 under a `barter.json` id,
  94 gold rows under a `shop::` id. 194 distinct pin ids.

