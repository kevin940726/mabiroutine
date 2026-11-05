# Shared purchase pools (plan)

Status: model A implemented, no data yet, render unverified (checklist in
`docs/npc-shop.md` §7). Uncommitted by design (AGENTS.md: feature work stays in
the working tree until reviewed).

Decided 2026-11-05 by the user: model A, the `共用` chip ships, and `pool` takes
a merchant key (`npc::town`). The chip shows only when two or more rows share the
counter; the click-through is deferred (see "Chip" below). Nothing visible
changes until a second merchant's rows land, which is 黛蓮's stall.

## What to decide

Answered: model A, chip on, `npc::town`. Left open: whether `共用` becomes a link
(see "Chip" below).

### Chip

- **Shown only when `poolSize > 1`**, i.e. when at least two recorded rows share
  the counter. A lone member would promise a partner the app cannot show, and the
  click target would be a list of one. This also makes the marker honest: it
  appears exactly when the shared counter is real in the app.
- **Not a link yet.** The name search is the wrong target: it matches the item
  across every merchant (蜂蠟 sits at three, unpooled), so "these two share" turns
  into "everyone who stocks this". A pool filter needs its own view state and URL
  parameter; that is a follow-up, not part of this model.
- Where it sits: next to 伺服器 on the limit line, amber against the scope's sky,
  because sharing and account-wide are different facts that often co-occur.

## The problem in one sentence

The client's shop **tabs** are shared between shops, so a capped stock is one
counter across every merchant that lists it, while `shops.json` records a
per-merchant cap and the app therefore allows the same weekly stock to be bought
at each merchant separately.

`scope: account` does not cover this. It answers a different question (one value
across the account's characters); a pool answers "one value across rows".

## What the client actually says

Measured from `mabiroutine-private/client-re/out/crafting/crafting.json`
(2026-11-04 sheets, 741 sheets / 469,345 rows): `NPCShopTab` ids are referenced
by shop rows, so a tab id appearing under two shops is one tab, one
`AutoRestockCycle`, and one set of `NPCShopProductPreset.restrict_amount` values.

- 176 distinct tabs are referenced; **19 are shared by two or more shops**, and
  **13 of those carry caps**.
- A tab is not one cap. One tab holds several products with different caps, e.g.
  tab `429191508` holds 25/16/7/1/1 per week for the five 裝飾 rows. So the unit
  that pools is the **product**, and the tab only explains why two merchants sell
  it.

Shared capped tabs that touch merchants we ship:

| tab | cycle | merchants we ship | what it means for us |
|---|---|---|---|
| 429191508 | weekly | 瓦爾特 (黛蓮 absent) | the five 裝飾 rows added 2026-11-04; 黛蓮 sells the same stock |
| 1972363573 | weekly | 伊文, 凱雅拉 | 伊文's nine rows share the tab with 鄧肯 / 克雷格; only 伊文 records any of the products |
| 79496750 | weekly | 迪莉絲, 馬努斯, 基利安, 康格 | 卓越恢復藥水 20/week account; none of the four records that gold row (康格's 卓越恢復藥水 is the 豆乳防風草蛋糕 barter) |
| 1177027820 | none | 任務佈告欄 (four towns) | the shared tab holds the `Repeat_*` hidden-dungeon scrolls at 2/week account; we record the per-town scrolls instead, 3/week character |
| 574640435 | weekly | 安黛莉 | 聖水 5/week account; 克莉絲 and 唐娜 are absent |
| 458200171 / 957118396 | weekly / none | 珍妮佛, 芙蘿拉, 貓商人 | `Coin_SouthRegionToken` travel stock; none of our rows matches one of these products (珍妮佛's 蘋果汁 is 10,000 gold 每週 30 次, a different listing) |
| 1978641907 / 266204304 / 709859899 | weekly / daily | 貓商人 | the client has two NPC sheets both named 貓商人 (npc#1108772160 and #996411319), and both list these tabs, so this is one stall's stock recorded once, not two merchants sharing a counter |

**No shipped product is duplicated across two of our merchants today.** Two
independent passes over our 244 rows against every capped pooled product
(name + price, then price + cap + cycle + currency) returned 0 matches under two
merchants. So this is not a present wrong number; it is the shape that goes wrong
the day 黛蓮, 克莉絲, 唐娜 or a healer's gold row ships.

Counterexample that rules out inference: 蜂蠟 is 3,600 gold, 每週 30 次 at
瓦爾特, 吉爾摩 and 康納. Three merchants, identical name, price and cap, three
separate stocks. Any model that derives a pool from "same item, same cap" merges
them wrongly.

## Semantics a pool must carry

1. One counter for N catalog rows. Buying at any member lowers the same number.
2. Members keep their own catalog identity: merchant, town, price, tile, portrait.
   The pool changes the counter, not the shop.
3. The cap is a pool property (times + period + scope), and every member must
   agree on it, or the data is wrong and the gate should say so.
4. Orthogonal to `scope`. A pool may be character-scoped (伊文's shared tab) or
   account-scoped (the 裝飾 rows above). `scope` keeps meaning "across characters".

## Data model

Recommended: one optional string on the option, naming the **merchant whose row
owns the counter**:

```json
{ "name": "裝飾製作零件+", "pool": "瓦爾特::杜巴頓", "priority": "must", ... }
```

Why this shape:

- **It reuses the existing id space.** The pool's pin id is the canonical row's
  `shop::<npc>::<name>`, which is the id the three 裝飾 rows already carry and
  are seeded under (`DEFAULT_PINS`). A new `pool::` namespace would orphan every
  pin saved since 2026-11-04 and drop them from new saves, because
  `seedMissingDefaultPins` only adds ids the server never saw.
- **It is explicit.** The alternative (first member in file order owns the
  counter) breaks silently when a re-sort moves a row, and the repo already has
  one incident of file order being load-bearing by accident.
- **It is checkable.** The gate can resolve the target, compare the pair, and
  fail with a message that names both rows.

`pool` carries `npc::town` (the existing `merchantKey`), not a bare NPC name:
the client ships two NPC sheets both named 貓商人, and a bare name cannot say
which one owns the counter. The derived pin id still spells `shop::<npc>::<name>`,
so the field and the id disagree on shape on purpose: one is identity, the other
is a persisted key that must not change.

Rejected:

| option | why not |
|---|---|
| Derive pools from the client tab id | we deliberately do not import the client's shop structure; tab ids are also volatile across repacks |
| Infer from name + price + cap | 蜂蠟 at three merchants is the counterexample |
| New `pool::<key>` id namespace | orphans the pins shipped on 2026-11-04, and needs a remap step plus a sync-key story |
| A file-level `pools` table | two places to keep in step, and the gate would still have to walk rows to render one |

Gate additions (`test:shops`): target resolves to a row in the same file; same
item name; same `cost.amount` and `cost.currency`; same `limit.times`,
`limit.period` and `scope`; at least two members; the canonical row carries no
`pool` itself; a member's own `shop::` id must not be minted (`shopPinIds()`
returns canonical ids only), or a future save can pin the dead twin.

## App behaviour: two candidate models

Both share the same data, the same value key and the same gates. They differ in
what a pin means.

### Model A: one pooled row (recommended)

- Pinning either merchant's tile pins the pool id, so the tracker shows **one**
  row for the stock: name = item, desc = `金幣 5,000 · 杜巴頓 · 瓦爾特 / 黛蓮`.
- The counter, the hide flag, the drag order and the section denominator all key
  on the pool id. One purchase, one row, one number.
- The catalog keeps both tiles (each merchant's stock), each with a pin button
  that resolves to the same pin.
- Cost display: the row shows the price once, which is correct only while every
  member charges the same. The gate enforces that today.

### Model B: per-merchant rows, one shared counter

- Pinning 瓦爾特's tile and 黛蓮's tile gives **two** rows, each with its own
  name/merchant, both reading and writing the same counter.
- Honest to "these are two ways to spend one stock", but the section denominator
  and 已選 N count the stock twice, and hiding one row leaves the other.
- Costs may be shown per merchant, so unequal prices would work if the game ever
  does that.

### What both need at the tile

The tile must say the stock is shared, or the shared counter looks like a bug.
Two candidates for the limit line, both cheap:

- append a `共用` chip next to the existing `伺服器` text;
- or make the merchant band read `與 瓦爾特 共用`.

The prototype renders the first one.

### What does not change

- Gold pins stay out of the header denominator (App maps pins through
  `barterTaskForPin` only) and out of reminders (2026-09-27 decision).
- `scope: account` still means 伺服器, still renders `每週 N 次（伺服器）`.
- Prices stay per row; the pool is a counter, not a bundle.

## Migration, sync and prune

- **No store version bump.** `barterPins` stays `string[]`; the pool's id is an
  existing `shop::` id; `DEFAULT_PINS` is unchanged.
- **No sync change.** The value rides `acc:shop::瓦爾特::裝飾製作零件@<week>` as
  it already does; `taskKind` resolves the id through `shopDealsByPinId()` and
  already returns weekly. The only new requirement is that a pooled partner's
  own id never reaches `shopPinIds()`.
- **Prune is already safe** for canonical ids (`validPinnableIds` includes
  `shopPinIds()`), and becomes safe for partners by virtue of them never being
  minted.
- **Removing the canonical merchant** from the file is a pin-id change by
  definition. The gate fails on the dangling `pool` target, which is the loud
  version of a thing that is already destructive.

## Edge cases to settle

1. `pool` field shape: `npc::town` (recommended) vs bare `npc`. Bare names are
   shorter but ambiguous for same-name sheets; the derived id uses the bare name
   either way, so `npc::town` is self-checking.
2. Unequal prices across members: gate rejects today. If it ever happens in game,
   the row needs a range or "from N gold", which is a display decision.
3. Character-scoped pools (伊文's tab) share a value only within the active
   character. Model A does this for free (the value is per character by
   `serverShared: false`); Model B also does.
4. Where a pooled row sits in the pinned group, and what 在商店中查看 opens:
   the canonical merchant's `npc::town` group and shop (model A), or each
   merchant's own group (model B). Model A means pinning from 黛蓮's tile lands
   the row under 瓦爾特's group and jumps to 瓦爾特's stall. Cheap to accept if
   the row's description names both merchants; the alternative is model B's
   duplicate rows.
5. Whether 黛蓮's own shop (portrait, town, other tabs) lands in the same change
   or before it. The pool is only observable once a second member exists.

## Implementation sketch (for model A)

Shipped 2026-11-05, except the data: `pool` resolves to the owner's pin id, the
task description lists the members, `shared` renders the 共用 marker at
`poolSize > 1`, and `test:shops` gates the pair plus a fixture that proves the
success path. No row carries `pool` yet.

Six touch points, no new id namespace and no store shape change:

| file | change |
|---|---|
| `src/data/shops.schema.json` | add optional `pool: { type: "string" }` to `option`, described as `npc::town` of the row that owns the counter |
| `src/lib/shops.ts` | carry `pool` on `ShopDeal`; a partner's `pinId` resolves to `shopPinId(canonicalNpc, name)`; a `poolMembers(pinId)` helper returns the member deals in file order; `shopPinIds()` skips partners |
| `src/store/useAppStore.ts` | `shopDealToTask` builds the desc from `poolMembers` when there is more than one; nothing else keys on `deal.id` (already `pinId`) |
| `src/components/shop/Tile.tsx` | the `共用` marker next to the limit line, from `pool != null` |
| `scripts/check-shops.entry.ts` | the gate list above; the existing pin-id collision check still covers the id itself |
| `docs/npc-shop.md`, `docs/tracker-data.md` | the scope/pool distinction, and the shop ledger's `scope` sentence |

Tests that must be re-run: `test:shops` (new gate), `test:migrations` (fixture A seeds
`DEFAULT_PINS` unchanged), `test:sync` (the value key is an existing id; the live legs
apply because `useAppStore.ts` changes), `test:drag` (pin order ids unchanged),
`test:icons` and `test:fallbacks` (a new tile marker, no new art).

## Spike

`docs/plans/shared-pool-model.html` is a throwaway logic prototype: double-click
it, no build, no server. It runs both models against the real 瓦爾特 / 黛蓮
numbers and lets you:

- buy at either merchant and watch the other's remaining count move;
- pin, unpin, hide, and re-pin from the other merchant;
- roll the week over and see what survives;
- switch model A / model B and compare what the tracker shows.

Scenarios it is built to expose, in order: a fresh pin at 瓦爾特, buying the
weekly stock out across both merchants, a week rollover with one purchase in the
new week, and a character-scoped pool (the 伊文 shape) to check that the account
badge does not appear.

The reducer behind the page was exercised headlessly before handing it over, so
the mechanics below are not the open question; the feel is:

| check | result |
|---|---|
| model A pins once, renders one row | 1 pin, 1 row |
| model A buys the cap at 瓦爾特 | remaining 0 for 黛蓮 too, one counter keyed by the canonical pin id |
| model B pins both merchants | 2 pins, 2 rows, 1 counter, both rows read the same number |
| week rollover | counts cleared, pins and hides kept |
| character scope | 伊文's count is per character; the account pool survives a character switch |
| cap | buying past `times` is a no-op |

## Out of scope

- 黛蓮's shop data itself (needs her town, portrait, and her other tabs).
- Making the client tab a first-class object in the data.
- The 貓商人 duplicate NPC sheet.
- Counting gold pins in the header denominator (a separate gap, if it is one).
