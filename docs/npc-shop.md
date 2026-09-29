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

### This file is expected to be current

Per the user's instruction, the ledger is updated **as the work happens**, in the
same commit as the change it describes — not swept at the end. So if you are
reading this and something below contradicts the tree or `git log`, the tree wins
and the fix is to correct this file, not to trust it. Section 0 in particular was
once five commits stale and said "nothing is queued" while nine commits of work
stood on the branch.

### Where the branch stands

`wip/shop-browser`, unmerged, **0 behind `main`** (rebased 2026-09-30), nothing
pushed. Per `AGENTS.md`, pushing is a separate decision from committing and needs
explicit approval.

The prototype era is over: the `?shopproto=` / `?gridproto=` / `?rows=1` gates are
gone, `src/proto-grid/` no longer exists, and the grid is the only shop view. See
section 5 for the fold-in that did it and the proto-era commit list it replaced.

Historical note, since the ledger was written as the work happened: commit 1 was a
discarded prototype, 2-8 the shop browser, 9-15 the gold-pin work, 16-21 the data
and test work, and the commits after that were the grid rebuild.

### What is next, in order

**No code work is left.** Every open item from this ledger is closed: gold pins
shipped, the panel shipped, the grid folded in, shop and barter coverage agrees in
both directions, and the `test:shops` blind spot that let two data defects through
is closed. What remains before this reaches users is a push, not code.

1. Push, as a separate decision.

Deliberately **not** doing, and why:

- **Item icons.** 167 distinct icons for the shop view. A capture pipeline was
  built and proven on 11 of them, then deleted: the stock-count pill in the
  in-game tile overlaps the art and could not be removed without leaving visible
  notches, and the user called the effort not worth it. Revisit only with a
  capture method that avoids the pill.
- **Reminder bells for gold pins** and **seeded gold pins** — both declined by the
  user, with reasons in section 2. Do not re-open without new information.
- **Removing `barterFilters` from the store.** Done at store v20. It was left
  persisted after the old barter explorer was deleted and nothing read it; the
  v19→v20 step deletes the field and the sync layer no longer emits or reads its
  `filter:*` keys.
- **A store version bump for gold pins.** Reasoned out in section 2; adding one
  would be wrong.
- **Widening the pin id.** `shop::<npc>::<name>` is correct because every barter
  row is curated, so the namespace is the 94 gold rows, which are unique on
  `npc::name`. If a second gold listing for one NPC and item ever appears, give
  the shop row an explicit `id` instead — widening the key orphans saved pins.

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
- **`AGENTS.md` said the store was at `v17`. It is at 19.** Corrected 2026-09-27.
  The authoritative numbers are `useAppStore.ts:305` (`initial.version`) and
  `:1110` (the persist config's `version`), which must match.
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
- **A test that passes because its setup silently failed is the same failure as
  the original bug.** A sabotage script anchored on `"\n"` did not match the
  CRLF working tree, exited non-zero, and the `test:shops` run that followed was
  green against unmodified data — which I read as the defect being caught. Check
  the setup's exit code and confirm the mutation is present before believing a
  verification. Two more setup scripts in this session "passed" for the same
  reason.
- **Guarding an edit to formatted JSON: compare parsed structures, not lines.**
  Deleting one key from `shops.json` shifts every later line, so a "exactly one
  line changed" guard reported 1434 differences and refused a correct edit. A
  verbatim substring guard fails too, because the file is pretty-printed. What
  holds is a recursive diff of the before/after objects asserting exactly one
  change at exactly one path. Assert the *meaning* of the edit, not its shape in
  the file.
- **Do not hand-write a measured number into this file.** "23 barter-only, 14
  mixed" was typed from a hunch; measured, it is 24 and 13. Every count in
  section 4 came from a script that wrote a UTF-8 file, and re-running it after a
  data change is the only way these stay true.
- **Two house rules, both learned the hard way in the grid prototype.**
  1. **Never truncate; always wrap.** A cost line forced to one line with
     `truncate` turned 麗莎's two 10-character names into 稀有鍊金術再燃… . A
     wrapped second line costs height but hides nothing. The one exception is the
     tile's title, which keeps `line-clamp-2 min-h-[2.7em]`: that reservation is
     what every tile on the grid aligning its limit row depends on, and the longest
     real title is 13 characters against 18 that fit, so two lines is never
     reached by real data.
  2. **Never use the `title` attribute.** No HTML tooltips anywhere in `src/`.
     The last one (on the schedule button in `SchedulePopover.tsx`) was removed and
     it keeps its `aria-label`; the popover it opens carries the same label. React
     component *props* named `title` (`TrackerSection title=`, `ExpRow title=`) are
     unaffected — they are props, not attributes.
- **Fitting text to a width: what was tried, what failed, and the tool that
  actually does it.** This is the long one; it cost most of a session.
  - **The problem.** 麗莎 has two barter rows whose cost line, 稀有鍊金術再燃燒催化劑
    ×50, is 181px at 14px against a 144px content box in a 4-column tile.
  - **Hardcoding the width fails** as soon as the reader's font differs. A reader
    with a larger default font changes both the glyph widths AND the tile width
    (measured: the 4-column content box goes 144px at root ×1, 181px at ×1.25,
    162px at ×2 at the same viewport).
  - **A CSS clamp cannot fit text.** `clamp(min, 100cqw / N, max)` needs one
    divisor to encode "the widest run in em", but the ratio the text needs varies
    per item and per breakpoint. Measured, `100cqw` also did not track the tile's
    content box under a scaled root font. There is no CSS `fit-content` for font
    size; anything that fits text must measure it.
  - **Measuring + `setState` oscillated at 60Hz.** The hook watched `<html>`
    attributes with a `MutationObserver`, and its own state write changed the
    layout it was watching: a two-state flip every frame, `changes=59` in a
    60-frame sample. Two more mistakes in the same hook: it wrote candidate sizes
    onto the live element (`scrollWidth` on a truncating block always equals
    `clientWidth`, so its overflow probe was a false negative), and it searched for
    "the largest size that fits", which under a large root font returns a size
    LARGER than the author's.
  - **What works if you need real fit-to-width: `@chenglou/pretext`.** MIT,
    v0.0.9, zero runtime deps. `prepare(text, font)` does the one-time canvas
    measurement and returns an opaque handle; `layout(prepared, maxWidth, lineHeight)`
    is pure arithmetic after that, no reflow. `measureLineStats(prepared, maxWidth)`
    returns `{ lineCount, maxLineWidth }`, and `maxLineWidth` is the tightest width
    that still fits the text — the shrink-wrap primitive CSS lacks. Deferred, not
    rejected; the deciding factor was that it solves a 2-of-194-tile problem.
  - **Measured cost of pretext**, because "it should be small" is not a number:
    raw ESM 145.8 KB over 8 files, **minified 46.4 KB**, **minified+gzip 16.1 KB**
    for the base entry point. **Not tree-shakeable**: the package has no
    `sideEffects: false` and `layout.js` statically pulls `analysis.js` (48.6 KB),
    `line-break.js` (31 KB) and `generated/bidi-data.js` (23.4 KB), so importing
    just `prepare` + `layout` still gives you the lot, bidi tables included.
  - **If you adopt it, three obligations, none of which runtime calculation
    removes:** (a) pass a whole font stack like
    `-apple-system, BlinkMacSystemFont, "Segoe UI", …` verbatim — that is fine,
    `ctx.font` takes a family list and resolves it the same way CSS does, so no
    font-naming change is needed; (b) resolve `rem`/`em` to px yourself and
    re-`prepare` when the root font changes, since pretext cannot read your CSS;
    (c) verify on macOS, because pretext's own `PLATFORM_BUGS.md` flags
    `-apple-system`/`system-ui` as unsafe for `layout()` accuracy there. It also
    measures the size you pass, so a browser minimum-font-size setting can make it
    confidently wrong. Prefer whole-pixel sizes;
    Firefox rounds fractional canvas font sizes, which can wrap differently.

### Running and verifying

- `pnpm check` is the gate: lint, shops, migrations, engine, quota, SQL smoke,
  fallback, sync, build. The `api-live` and `browser-e2e` sync suites skip
  loudly without `pnpm dev:api`; they do not cover this code.
- Browser checks were done with `playwright-core` driving the already-running
  dev server, in throwaway scripts under
  `C:\Users\User\AppData\Local\Temp\opencode\pwtest\`. Nothing test-related is
  committed; the repo has no browser test harness for this.
- Useful selectors: the NPC field is `getByRole("button", { name: "NPC" })`, the
  town field `name: "城鎮"`, the multi-select `name: "優先度"` (options are
  `menuitemcheckbox`), the kind field `name: "交易類型"` (options are
  `menuitemradio`), and every tile carries `data-shop-tile`. The tile a jump
  focuses carries `data-tile-key="<pinId>"`.
- **Tab count trap.** Since both tabs stay mounted (`<Activity>`), the shop tab's
  `h1` and its `getByText` matches are in the DOM even while the tracker is shown.
  Scope a locator to the visible region or you will count hidden nodes.

---

## 1. What shipped

### The fork, and how it was decided

Eight layouts were built and thrown away (variants A-M) behind a
`?shopproto=` gate. The gate is gone. The winner was **K, compact selectors**:
a town dropdown, an NPC dropdown, and one content panel. The deciding argument
was that once a direction is chosen, the remaining work is polish, and polish
done in a prototype shell gets written twice because the shell reimplements
search, pin, and selection state.

These layout rules were kept when the grid replaced the row layout; the one about
the per-NPC `金幣` / `以物易物` tab pair was retired by the grid, which does not
need a toggle because both kinds render as tiles and 類型 filters them.

| Rule | Why |
|---|---|
| All 194 shop rows, not just the curated barter ones | The old tab showed a flat 107-row curated list, hiding most real trades |
| A tab renders only when that NPC has that kind of trade | 23 of 36 NPCs are barter-only; a dead 金幣 tab is noise |
| Default order is `barter.json`, gold last | The curated order is hand-written intent; `shops.json` order is not |
| No item icons | 167 distinct icons for the shop view; not worth the capture |

### Files

| File | Role |
|---|---|
| `src/lib/shops.ts` | Adapter over `shops.json` + `barter.json`. Curated matching, `ShopDeal` with `curatedIndex` / `barterId` / `scopeAccount`, `costText`, `getText`, `pinId` |
| `src/components/MerchantPanel.tsx` | The whole tab: filters, search, jump/返回, pin resolution and the header. Exports one component |
| `src/components/shop/types.ts` | `ShopRow`, the one row type the grid and the panel both name. Lives here so neither imports the other |
| `src/components/shop/NpcFace.tsx` | The NPC portrait with its initial fallback. Moved out of the panel for the same reason |
| `src/components/shop/shared.tsx` | Grid pieces: `TradeGrid` (sectioning), `TradeLine` (the trade popover), `compareRows`, `PRIORITY`, `limitOf`, `pinButton`, `GRID` |
| `src/components/shop/Tile.tsx` | The tile, its merchant band and the price line |
| `src/components/shop/ShopGrid.tsx` | The grid entry point the panel mounts |
| `src/components/MenuSelect.tsx` | Shared dropdown-select. Takes an optional per-option `group` (rendered as a heading), optional `ariaLabel`, optional `contentClassName`, and floors the popup at the trigger width |
| `src/components/ui/dropdown-menu.tsx` | Capped to Radix's available height and made scrollable. This is what made 36 NPCs reachable |
| `src/App.tsx` | Lazy-loads `MerchantPanel` on the 商店 / 以物易物 tab. There is no A/B harness any more |

### Decisions worth remembering

- **No router.** Deep links are query params, matching the existing
  `?task=` / `?chars=` reminder convention. `?npc=` is deliberately **not**
  stripped after use, unlike those, so an NPC view is shareable and survives a
  reload. The panel reads it once on mount and forces `town` back to `all` so a
  stale town can never hide the deep-linked merchant.
- **Pins are the tracker's pins.** The grid's `pinButton` writes the store's
  `barterPins` directly, with no panel-local list. One pin per barter id, shared
  with the tracker tab, synced, and visible from a second device. Verified: pin in
  the panel, the tracker renders it, survives a tab switch and a reload.
- **The 已選 count is the tracker's count**, so it opens at the seeded default
  pins (9) rather than 0. Intended, but visible.
- **All 194 rows are pinnable.** The 100 curated barter rows pin under their
  `barter.json` id; the 94 gold rows pin under a `shop::` id. See section 2.
- **Item names are spelled one way on screen.** Parenthesis width is full-width
  everywhere the user reads, on every screen, while the data files keep the game's
  half-width spelling, and search accepts either. Owned by `docs/tracker-data.md`;
  recorded here because it touched every screen rather than one.
- **Deliberately not built:** item icons (see section 0), reminder bells and
  seeded gold pins (see section 2). Removal of `barterFilters` used to be on this
  list; it shipped at store v20 (see section 0).

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
| C: panel affordance | `Put the pin button back on the 102 rows that had none` | A pin on tiles and on uncurated rows, one shared button, `已選交易` matches on `pinId` (the tile and row components it used were later replaced by the grid; see section 5) |
| D: sync and docs | `Sync a shops.json pin, and say so in the docs` | E2 adoption case, `docs/tracker-data.md`, both READMEs |

Still deliberately not done: reminder bells (decision 1) and seeded gold pins
(decision 2), both for the reasons recorded under "Open questions — answered".

### Two premises in this ledger were wrong, and the data said so

Worth keeping, because both were reasoned rather than measured.

1. **The recommended id `shop::<npc>::<name>` collided — and then it didn't.**
   It was justified by `npc::name` being unique across the gold rows, which is
   true but irrelevant on its own, because the namespace also covered barter
   rows nobody had curated. Over the 192 rows that existed at the time (194 now,
   after 阿蘭雯 was added) `npc::name` collided **9 times**, 4 of them across
   kinds: 基利安 sells 四葉草 for 750 gold and also trades
   蒜香橄欖油義大利麵 ×1 for it; 艾琳's 銀合金錠 goes for 特殊鋼錠 ×3 *and*
   合金鋼錠 ×30; 愛麗沙's 麵粉 goes for 雞蛋 ×3 *and* 薰衣草花 ×1.

   The first fix was a fourth `::currency` segment, which made all of them
   distinct.
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
`ShopRow.pinId` carries it into the panel. Do not reuse `ShopRow.key` for this: it
includes the row's index within its NPC and is not a stable id.

### Tradeoffs taken, so they are not mistaken for oversights

- A tile's pin target is `size-6`. It was measured against the shipped row button's
  44px, and the grid kept the denser target: a tile has room for one control and the
  emerald fill makes the action read as the same one the tracker uses. The row
  buttons are gone now (section 5), so the compact target is the only one.
- A shop row keeps its yield in the title ("紙 ×5") where a barter row strips it,
  because the barter hover card spells out the full exchange and a shop row has
  no such card.
- The material breakdown shows for a barter-only item, and stays shut for one
  that is also sold, handed out as a 通關獎勵, dropped or disassembled. A
  breakdown that decomposes a trade is worth reading; one that presents a guess
  between several acquisition routes is not. The earlier "a lone route stays
  shut" rule hid the barter case along with the shop and gather ones, which is
  why 凱琳特製全麥麵包 looked broken rather than deliberately suppressed. Eleven
  items gained a `quest` route in `recipes.json` to express this, since the data
  recorded no source for them. 愛心幣 and 喵幣 are quest currencies, so `quest` is
  their real source rather than a stand-in. Five of the eleven had no entry at all
  and were suppressed only by that absence, which is the fragile form of the same
  fact: any of them becoming a barter get in `shops.json` would have started
  showing a breakdown with nothing in the data to stop it.
- 豆乳防風草蛋糕 was the one item whose own recipe was missing rather than its
  source. It now carries its 食物製作台 Lv.4 / 料理 Lv.13 recipe, along with the
  three ingredient rows missing behind it: 豆乳 and 泡水的豆子 at 食物加工設備
  Lv.4, and 防風草 gathered at 鋤地 Lv.10. Craft time is not a route field, so it
  rides an entry `note` (自行加工約需 55 分鐘 / 約需 20 分鐘), the form 傷痕花粉末
  and 銀合金錠 already use; nothing reads it. 食物加工設備 rows carry no `skill`,
  because that station has none; only 食物製作台 rows do.
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

1. **Dead code: fully resolved.** `BarterExplorer.tsx` lost its 107-row list UI
   (429 to 283 lines) along with the explorer-only `PRIORITY_ORDER` /
   `PRESENT_PRIORITIES` / `TOWNS` and nine imports. What remained was only what the
   panel reused: the two row components, the pin buttons, `BarterJsonRow`,
   `capText`. The file was misnamed for what it held and a rename to something like
   `BarterRows.tsx` was considered and rejected as churn. **The fold-in then deleted
   the file outright**: those row components existed only for the `?rows=1` view the
   grid replaced, so there was nothing left to rename. See section 5.

   `barterFilters` / `setBarterFilters` in the store were unreferenced but still
   persisted for a while. They are gone as of store v20: the field is deleted by
   the v19→v20 step and the sync layer no longer carries its `filter:*` keys. The
   panel's own 優先度 and 類型 filters are panel-local state, so there is no
   persisted filter set to keep in sync with them.

2. **`?npc=` staleness: checked, no change needed.** This was flagged
   speculatively and turned out to be wrong. Verified in the browser: selecting an
   NPC sets the param, choosing 全部 NPC clears it, 清除篩選 clears it, changing
   town clears it, a cold load of `?npc=佛格斯` selects that merchant and forces
   the town back to 全部城鎮, an unknown name is ignored and falls back to 全部商店
   with all 194 rows rather than blanking, and the param survives a tab round
   trip, which is the point of a shareable link. Nothing to fix.
3. **NPC faces and the 37-item list: done.** The NPC dropdown is grouped under
   town headings in `TOWN_ORDER` and the popup is now at least as wide as the
   trigger that opened it. The original note here blamed the 20px portraits, and
   that was wrong: inspected at 2x, most faces are distinguishable and only a
   few pairs are close. The real cost was 36 rows in one flat scroll (37 NPCs
   now) that was
   *already* town-ordered while showing nothing about it. Grouping surfaced the
   ordering that was there and cut the scan. If the faces still read poorly in
   person, `size-6` is the cheap follow-up, not the fix. The list is 37 NPCs now,
   not the 36 this was first written against.
4. **Gold tiles dropped the limit line** when the kind badges were removed. It is
   back on line 3, but the tile no longer shows which NPC it belongs to, because
   the grid is only used inside a selected merchant. Correct as-is; noting it in
   case a future all-shops grid is wanted.
5. **Gold tiles went square and were caught late: done.** Commit 10 in section 0
   was reached by making the tile reachable again without a screenshot of it, so
   the fix was to pin the invariant instead: a browser check asserts no visible
   text anywhere contains a half-width paren, which is a measurable rule rather
   than a remembered preference. Compactness itself is still only verified by
   measuring — 72px tall at 178px wide.
6. **A curated NPC missing from the shop catalog: done.** 阿蘭雯 had two curated
   trades and no `shops.json` entry, so both were injected as fallback rows and
   the NPC could not be picked in the town list. The user added the entries.
   Their 精靈的痕跡 row then missed its curated entry by one character, which is
   now fixed and, more usefully, is a failing check rather than a silent gap.
7. **A gold price was spelled out in one place and glyphed everywhere else:
   done.** A pinned gold purchase read "1,500 金幣" on the dailies while the shop
   tile read 🪙1,500. The glyph lived in a ternary inside `toItem`, and
   `costText` — which feeds both the tracker row and the row layouts — spelled the
   word. `costText` now owns the glyph and the ternary is gone, so there is one
   place that formats a price. Worth noting the pattern: the special case was
   written first and the shared helper was never updated to match, which is the
   same shape as the "measured one set, reasoned about another" mistake in
   section 2.

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
  `精靈痕跡`, which left a `situational` curated row unreachable anywhere. The
  user added the NPC to `shops.json`; the character was confirmed in game and the
  barter row corrected. Note that `pnpm test:shops` passed through **both**
  defects, because twin cap parity pairs rows by name and a name mismatch is
  invisible to it — so the check now also fails on an uncurated barter shop row,
  reusing the app's own matcher, with an `ALLOWED_UNCURATED_BARTER` escape hatch
  for a row that is deliberately uncurated.
- All 94 gold rows are unique on `npc::name`; none has a null price. This is the
  invariant that lets the pin id be `shop::<npc>::<name>`.
- Pin counts as shipped: **all 194 pinnable** — 100 under a `barter.json` id,
  94 gold rows under a `shop::` id. 194 distinct pin ids.

---

## 5. The grid, folded in

The shop view is a grid of tiles. It began as a throwaway prototype behind
`?gridproto=`, was reviewed and polished, then the gate was inverted so the grid
became the shop and the old row/tab UI moved behind a dev-only `?rows=1`. This
section records the finish: the prototype names, the `?rows=1` view and the
`BarterExplorer` row components are all deleted.

### What the prototype cost while it lived

The prototype shell reimplemented the panel's filters and selection state. That
was the known trap from the first fork (section 1: polish in a shell gets written
twice), and it held again here — the grid's filters lived in `protoPriority` /
`protoKind` and had to be threaded through every jump and 返回. Both are now the
shop's own `priorityFilter` / `kindFilter`, applied in `MerchantPanel` so every
view and count sees the same list.

### The fold-in, in order

1. `src/proto-grid/` → `src/components/shop/`; `ProtoGrid.tsx` → `ShopGrid.tsx`,
   `ProtoShop` → `ShopTiles`, `ProtoItem` → `ShopRow`, `ProtoProps` → `ShopProps`.
   `ShopGrid` then absorbed `ShopTiles` outright, since a `ShopGrid` that only
   forwarded eight props to `ShopTiles` was a second place the prop shape could
   drift. `ShopProps` stayed in `shared.tsx` and `ShopGrid` takes it directly.
2. **The circular import is gone.** It was `MerchantPanel` → `proto-grid` →
   `MerchantPanel`, on `NpcFace` and the row type. `ShopRow` now lives in
   `shop/types.ts` and `NpcFace` in `shop/NpcFace.tsx`, so both sides import a leaf
   module instead of each other.
3. The `?rows=1` view and its components are deleted: `MerchantRows`,
   `MerchantGrid`, `PlainRow`, `NpcTabToggle`, `TabContent`, the `NpcTab` type and
   the `npcTab` state. The row type's `barterRow` field went with them — its only
   consumer was the row UI, so `ShopRow` no longer reaches into `barter.json`.
4. `BarterExplorer.tsx` is deleted. `BarterRowDesktop` / `BarterRowMobile` /
   `BarterPinButton` / `MobilePinButton` / `capText` existed only for the row view;
   the grid pins through `shared.tsx`'s `pinButton` and states the cap inline in
   the deal card. `BarterJsonRow` was only a cast alias and is inlined.
5. `data-proto-tile` → `data-shop-tile`.

### Why `ShopRow` instead of widening per component

`MerchantItem` and `ProtoItem` were the same shape, one a structural superset of
the other, and the grid accepted `MerchantItem[]` while rendering `ProtoItem`. That
worked by structural typing and cost nothing at runtime, but it meant two names for
one thing and a type whose home was the module that consumed it. One type, in a
leaf module, is what let the cycle go.

### Verified

`pnpm check` green. In-browser at 1440px: `商店 / 以物易物` header, 39 tiles on the
`必換、推薦` default, 47 with 一次性 ticked, 194 after 清除篩選, 94 with 金幣 and 100
with 以物易物 (sum 194), 194 merchant-band buttons on the unfiltered view, band click
opens 安黛莉's shop with filters kept and a 返回 chip, 返回 restores the full list,
and a town filter sections by merchant with portrait headers. Zero console errors,
and zero `[contain-intrinsic-size]` nodes — proof the row UI is not merely hidden.


