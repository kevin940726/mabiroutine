# npc-shop ledger

Working ledger for the NPC shop browser: what shipped on `wip/shop-browser`,
why it looks the way it does, and the scoped plan for the one piece of real
work left (pinning gold-only shop purchases).

Data knowledge for the two source files lives in `docs/tracker-data.md`; this
file is about the UI and the pin model, not about scraping or field meanings.

---

## 1. Status

Branch `wip/shop-browser`, unmerged, four commits behind `main`. Three commits
on top of the prototype baseline:

- `Fix long dropdown menus overflowing the viewport`
- `Give MenuSelect an accessible name and optional option icons`
- `Replace the barter tab with the NPC shop panel`

Gold pins are **not** implemented. Everything in section 3 is unbuilt.

---

## 2. What shipped

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
| All 192 shop rows, not the 107 curated ones | The old tab hid 85 real trades |
| One `金幣` / `以物易物` tab pair **per NPC**, no page-level toggle | The toggle was page-level friction over 36 NPCs |
| A tab renders only when that NPC has that kind of trade | 23 of 36 NPCs are barter-only; a dead 金幣 tab is noise |
| Gold renders as tiles, barter keeps the full row | Gold is a price comparison (tiles scan); barter is a recipe, and the material breakdown is the point |
| Default order is `barter.json`, gold last | The curated order is hand-written intent; `shops.json` order is not |
| Curated and uncurated rows share one row style | A plainer "gold row" read as a different kind of object |
| No item icons | 167 distinct icons for the shop view; not worth the capture |

### Files

| File | Role |
|---|---|
| `src/lib/shops.ts` | Adapter over `shops.json` + `barter.json`. Curated matching, `ShopDeal` with `curatedIndex` / `barterId` / `scopeAccount`, `costText`, `getText` |
| `src/components/MerchantPanel.tsx` | The whole tab. Private helpers, exports one component |
| `src/components/BarterExplorer.tsx` | Still the home of `BarterRowDesktop` / `BarterRowMobile` / `BarterPinButton`. Its old list UI is now dead code (see 4.1) |
| `src/App.tsx` | Lazy-loads `MerchantPanel` where `BarterExplorer` used to render |

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
- **90 of 192 rows are pinnable.** See section 3.

### Verified

`pnpm check` green (shops, migrations, engine 300 iterations, quota, SQL
smoke, fallback, sync; the `api-live` and `browser-e2e` suites skip loudly
without `pnpm dev:api` and do not cover this code). In-browser at 1440px and
390px: no console errors, no horizontal overflow, deep link survives reload,
every NPC reachable by mouse.

---

## 3. Open work: pinning gold-only purchases

### Why

Some materials are only obtainable by spending gold in a shop. With pins
limited to `barter.json` ids, those materials cannot go on the dailies at all,
which is the one thing the tracker is for.

### Constraints, with evidence

1. **`barterPins` is an id list, and every consumer assumes barter ids.**
   `TrackerSection.tsx:139-149` maps each id through
   `barterJson.find(x => x.id === id)` and drops the ones that miss, so a pin
   with no `barter.json` row renders nowhere.
2. **`barterToTask` needs a `BarterJsonItem`** (`useAppStore.ts:164-189`): give,
   get, gatherSkill, limit, perChar, priority. A gold deal has none of that
   shape, so there is no conversion to reuse.
3. **Migration prune steps would delete the new ids.** Each version step
   rebuilds `valid` from tracker + barter + custom ids and prunes
   `barterPins` against it (`useAppStore.ts:416-430`, `554-568`, `612-631`).
   The v4 to v5 step additionally reseeds to the must defaults when it sees
   unknown ids (`:397-409`). A user migrating from an older version after this
   feature ships would silently lose their gold pins.
4. **The drag order is filtered at load.** `barterCustomOrder` keeps only ids
   that are both in `barter.json` and currently pinned (`:309-311`), so shop
   ids would drop out of the custom order on every load. `barterPins` itself
   passes through unfiltered (`:322`).
5. **Ordering is barter-file-based.** `canonicalBarterOrder` sorts by
   `BARTER_FILE_INDEX` with unknown ids sinking last (`:150-154`); the explorer
   mirrors it with priority then town then file index.
6. **Reminders are barter-only.** `useHourlyReminders.ts:32-37` builds a task
   map from barter rows and silently skips anything else, so a gold pin would
   get no hourly bell.
7. **Sync is already id-agnostic.** `flat.ts:64` writes `pin:<id>` and the
   merge (`:394-402`) unions every `pin:` key into `barterPins`. A new id space
   syncs for free. No `sync/session.ts` allowlist change is needed because the
   list is the same field.

### The one good piece of news

Gold rows need a stable, content-derived id, and the obvious candidates are
collision-free today: across all 94 gold rows, `npc::name` is unique (0
collisions), as is `npc::name::outQty` and the full cost tuple. No gold row has
a null price. The barter rows *do* collide on `npc::name` (愛麗沙 sells 麵粉
twice, for 雞蛋 and for 薰衣草花), which is irrelevant because barter rows
already carry a `barter.json` id.

**Recommended id: `shop::<npc>::<name>`.** No index, no cost, no quantity, so a
price change in a game patch keeps the pin alive. Documented limit: if a future
`shops.json` ever lists the same item twice for one NPC, the id collides and the
schema needs an explicit `id`. That has not happened in 94 gold rows.

### Work list

Ordered so each step is verifiable on its own.

1. **`src/lib/shops.ts`**: emit a `pinId` per deal (`deal.barterId ?? shopPinId`),
   where `shopPinId = "shop::" + npc + "::" + name`. Keep it next to the deal so
   there is one place that knows how a deal is identified.
2. **`src/lib/types.ts`**: add `"shop"` to `TaskSource`, and a
   `shopMeta?: { cost: string; costCurrency: string; outQty: number; npc: string; town: string; limit?: string }`
   beside `barterMeta`. Reuse `town`, `npc`, `priority`, `serverShared`, `order`.
3. **`src/store/useAppStore.ts`**
   - Extract the repeated `valid` set into one helper
     (`trackerIds ∪ barterIds ∪ customIds ∪ shopPinIds`) and use it in the load
     sanitizer and every prune step. This removes the trap described above and
     four copies of the same literal.
   - `shopDealToTask(deal)` next to `barterToTask` (`:164`): daily or weekly
     from the limit, `check` or `counter` from the count, `serverShared` from
     `scopeAccount`, `order` matching the barter convention (daily 80, weekly
     150) so pins interleave predictably.
   - `canonicalBarterOrder` (`:150`): keep barter ids in file order, then append
     shop ids in `shops.json` order. Both sinkers currently go to the end, so
     today a shop id would already land last, but by accident rather than by
     rule, and a *barter* id missing from the file index would interleave with
     them.
   - `reorderBarterPins` / `barterCustomOrder`: widen the load-time filter
     (`:309-311`) to the same valid set so a mixed drag order survives, and keep
     new pins appending at the end of a user's order. This is the one that makes
   decision 3 real.
4. **No store version bump.** See "No version bump is needed" above. Nothing here
   changes the persisted shape, and the branch plus the gold shop are both
   unreleased, so no user can hold a gold pin yet.
5. **`src/components/TrackerSection.tsx`**: resolve pins from both sources
   (`:139-149`) and keep the daily/weekly split that already exists.
6. **`src/components/TaskRow.tsx`**: `isBarter` is checked in five places
   (`:363`, `:373-374`, `:379-391`, `:394`, `:428`). A shop pin needs the title,
   town badge, NPC portrait and limit counter, but **no** `MaterialBreakdown`
   hover card, because a gold purchase has no material chain. Decide whether to
   widen `isBarter` or add an `isShop` branch; widening is fewer edits but
   couples shop rows to barter-only affordances.
7. **`src/components/MerchantPanel.tsx`**: restore a pin button on the 102
   currently unpinnable rows. Gold tiles get the compact icon pin back; uncurated
   barter rows get the shared `BarterPinButton`. Both write through
   `toggleBarterPin(pinId)`. Unpinning a curated row stays on `barterId`, so the
   panel and the tracker never disagree about the same trade.
8. **Reminders: deliberately untouched** (decision 1). `useHourlyReminders.ts:32-37`
   skips ids it cannot resolve, so a gold pin simply never gets a bell. No code
   change; do not "fix" it later without revisiting decision 1.
9. **Sync**: nothing to do (constraint 7). Verify with a `test:sync` case that a
   `pin:shop::` key merges into `barterPins` and survives the round trip.
10. **Fixtures and tests**
    - `pnpm check` must be green. `test:shops` is unaffected: no data file
      changes.
    - No migration fixture, because no migrate step is added.
    - The one uncovered path is the load-time `barterCustomOrder` filter; see the
      note above. A `test:sync` pin case plus manual reload-and-reorder is the
      practical coverage.
11. **Docs**: `docs/tracker-data.md:66` says the store sanitizes pins against
    `barter.json` ids. That sentence becomes false and must be rewritten in the
    same commit, per the `AGENTS.md` docs rule. `CHANGELOG.md` gets a Features
    bullet. Both READMEs say pinning feeds the dailies, which becomes true for
    gold too, so they need a re-read rather than an edit.

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

### No version bump is needed

The whole branch is unreleased, and the gold shop is unreleased too, so no user
can hold a gold pin yet. Checking the store's own trigger for a bump (a changed
persisted shape: new, renamed or removed field, or removed row ids):

- `barterPins` stays `string[]`; only its *values* widen. No shape change.
- `barterCustomOrder` stays `string[] | null`. No shape change.
- `shopMeta` is an optional key on the `Task` value type, never written for
  custom tasks, and `TaskSource` merely gains a member. Neither appears in the
  persisted state object.

So the bump collapses to nothing, and the 19 to 20 step with its no-op migrate
block is dropped. Two consequences worth keeping:

- **No migration fixture is required**, because no migrate step is added. That
  is a deliberate consequence of the no-gold-pins-yet state, not an oversight.
  If this ever ships after users can hold gold pins, both the bump and a fixture
  come back.
- **The shared `valid` helper is still worth doing.** It is not needed for
  correctness today (old prune steps cannot delete pins that cannot exist yet),
  but leaving three barter-only prune steps in the tree means the next version
  bump inherits a trap, and anyone restoring an old backup walks into it.

One gap no test covers: the load-time sanitizer that filters `barterCustomOrder`
is in the store's load path, not in `migratePersisted`, so
`scripts/migration-check.entry.ts` cannot exercise it. Widening that filter is
the one change here with no automated coverage. Worth a note in the commit body
rather than pretending `pnpm check` proves it.

### Phasing

- **Phase A, ids and model**: steps 1-3. No UI. Proves the id space and the
  mixed drag order survive a load, which is the risky part.
- **Phase B, tracker rows**: steps 5-6. A shop pin renders in the dailies.
- **Phase C, panel affordance**: step 7. The button comes back on 102 rows.
- **Phase D**: steps 9-11, sync case, docs, changelog.

Each phase is its own commit with its own changelog entry, and each ends with
`pnpm check` green. No phase contains a version bump, so none of them can strand
a user mid-migration.

---

## 4. Other known follow-ups

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

## 5. Data facts this depends on

Measured, not assumed. Re-run the counts if `shops.json` or `barter.json` change.

- `shops.json`: 192 rows, 36 NPCs, 8 towns. 94 gold (`kind` omitted), 98 barter.
- 23 NPCs are barter-only, 13 are mixed, 0 are gold-only.
- Of the 98 barter rows, 90 match a `barter.json` row exactly and 8 do not.
  17 curated must/extra rows have no `shops.json` entry and are added as
  `curated-only::` rows, excluded from the 192.
- All 94 gold rows are unique on `npc::name`; none has a null price.
- Pin counts as shipped: 90 pinnable, 102 not (94 gold + 8 uncurated barter).
