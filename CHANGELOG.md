# Changelog

Reader-facing log of user-visible changes. Newest first. Each entry links its commit.

## 2026-09-03 — Unreleased batch (pins, data, perf, branding)

### Features
- Barter notes now show on the desktop explorer too (were mobile-only): quiet 12px muted-gray line with a hairline indent so it reads as an aside, barter tab only — pinned tracker rows stay note-free
- Barter tab drops the 採集技能 filter + skill chart (gatherSkill was source-copied noise); stale saves pin back to 全部 so nobody is trapped in a filter with no control, no store bump
- Barter tab drops the duplicate priority quick-pills (the select does the same job) and the mobile 展開篩選 collapse (two selects fit inline on all screens)
- All dropdowns unified on one non-modal DropdownMenu pattern (new `MenuSelect`): barter filters + custom-task dialog (icon/section/kind/type) leave Radix Select behind — no more body scroll-lock shifting header/pill on mobile
- PWA update discovery: `sw.js` revalidates on foreground (10-min throttle) + reconnect, so resumed apps take deploys via the existing auto-takeover toast instead of needing force-restart; deliberately no hourly poll and no interaction triggers (mid-session reloads lose UI state)
- Barter header drops stale wording (點擊切換, 代幣 — no token shop in-app)
- READMEs stop claiming character reorder + skill filtering (neither exists)

### Fixes
- Sync rebuilt on bucketed keys (store v13): every value now carries the Taipei day/week cycle it was set in, reads consider only the current cycle, and a reset prunes memory without writing anything — resets can no longer delete anything on any device, which kills the entire wipe class (late-wake tombstones, stale-tab poisoning, echo nulls, marker gating) at the root; the sync protocol no longer contains reset deletes at all
- Old cycle values age out server-side via a 60-day GC (tombstoned once); v12 saves migrate silently with values untouched; pre-rev-3 devices in the same session neither see nor destroy new-format values
- Sync stops eating daily checks across devices: server PATCH was read-modify-write on one blob, so two devices pushing in the same window resolved to last-record-wins — the loser's keys vanished, pulls adopted the loss, and tombstones made it permanent (looked like focus makes the other device truth; weeklies survived only because they're tapped once). PATCH is now a single HSET on one hash per session (atomic per-field last-writer-wins); pre-hash records upgrade transparently, API shapes unchanged
- Pulls now fold the just-acknowledged push over the GET result and all sync fetches are `no-store` (client + `Cache-Control` header), so a lagged or cached read can never resurrect a pre-push absence and cascade into a wipe
- Sync stops the late-wake wipe: a device opening for the first time after its peer already reset used to tombstone the peer's same-bucket checks (every morning the second device woke, the first device's dailies died). Resets now compare synced bucket markers first — late resets wipe locally but suppress tombstones and re-adopt the peer's values; link/import arrivals stamp the current bucket so they never wipe on next tick
- Sync stops the same-browser stale-tab wipe: the diff base was shared across tabs while memory is per-tab, so a suspended tab waking up diffed stale memory against another tab's fresh base and tombstoned live keys it never saw (no reset involved — markers can't catch it). Bases are now per-tab (sessionStorage, memory fallback), the shared copy only seeds tabs born later
- Sync stops deleting overflow characters: the 6-character cap slice dropped a 7th character from memory while the base kept its keys, so the next push tombstoned a character nobody removed. Pulls now scrub sliced ids from the base; their keys stay server-side and re-adopt if a slot frees
- Sync seen-markers are monotonic: a lagged or cached read can no longer walk them backward and downgrade the next catch-up reset into a full tombstoning reset (the repeated `acc:* → null` wipe pattern)
- Sync tombstones send exactly once: the diff used to re-broadcast every historical null on each push, so `null`s on the wire were mostly echoes of old deletions masking fresh ones (and bloating payloads); a null now always means a fresh deletion
- Sync is now guarded by a regression gate (`pnpm test:sync`, in `pnpm check`): engine scenarios (late-wake suppression, reset propagation, adopt stamping), 300 randomized reset key-exactness runs, stale-tab/cap harnesses, live API concurrency checks, and real-Edge two-device E2E — all against real code, no unit tests
- 兼職 is now a single checkbox (18:00 refresh only) instead of a 0/2 counter; saves with a count of 1–2 carry over as checked (store v11→v12)
- 每日挑戰 max 10→8 and 每週挑戰 max 11→9 (member-only 2 split out in the text); stored counts above the new max clamp down on load, rest untouched
- `timeGated` retired everywhere: no more amber time badge on rows, and the 新增自訂 form no longer offers 時間限制 (old custom values are stripped on load, store v11→v12)

### Features
- Footer links the now-public GitHub repo (inline mark + link, no dependency — installed lucide has no brand icons)
- Header overall progress counts everything the sections count: pinned barter + custom tasks now move the top `done/total`; section and header share one ruler (`lib/progress.ts`, partial counter credit included)
- Desktop custom rows use the same ⋯ dropdown (編輯/隱藏/刪除) as mobile instead of three gutter icons; freed gutter space goes back to row text
- Row ⋯ menu rebuilt on Radix DropdownMenu (new `ui/dropdown-menu.tsx` + dep): portal escapes the section card clip, auto-flips near edges, dismisses on outside-click/Escape
- Desktop floating pill gains the missing remove-character button (same 2+ guard as mobile's 刪除角色)
- Every destructive action now confirms first: shared promise-based `ConfirmDialog` (Radix) fronts character removal (all 4 sites), custom-task deletion (row ⋯ menu, both variants) and 清除本區; reset-all already had its two-tap inline confirm
- Character switchers (floating pill + mobile tabs) swapped from Radix Select (always scroll-locks: scrollbar vanishes, body padding shifts the fixed pill) to non-modal DropdownMenu radio lists — page never moves; `ui/dropdown-menu` gains radio items
- Mobile floating pill: tapping the character name opens the roster jump (‹ › stay for adjacent steps)
- Mobile floating pill drops the ‹ › stepper — name dropdown is the switcher
- Mobile pill name slot fixed at 12ch (no jump on switch, truncate inside); pill containers use svw instead of vw
- Mobile pill ⋯ menu rebuilt on the shared Radix dropdown — the old absolute menu was clipped by the pill's overflow-hidden (added for the fill meter); also gains outside-click/Escape dismiss
- Floating pills use a solid fill meter instead of the horizontal bar: the pill background fills with progress at zero extra width (prototyped as `prototype/pill-progress`, fill won; fill color round 2 picked emerald to match the done-language)
- Open-sourcing Phase 2: data text under CC BY-NC 4.0 (`DATA_LICENSE`, NPC art excluded as NEXON fan-use with takedown); fetcher scripts are private-local only (gitignored, never committed, never published), all references rewritten manual-only
- Open-sourcing Phase 1 attribution: in-app footer 資料來源 row (6 source links + 非官方 NEXON/devCAT disclaimer + 以遊戲內為準 + takedown via GitHub issue); README 出處與授權 section records per-source take-vs-not-take; `docs/tracker-data.md` gains a source-terms section (NEXON consent clause → disclaimer path, yenyen grant scope, Femiwiki BY-SA chain, Taiwan scraping posture)
- 巴哈姆特 citations dropped everywhere (docs cross-refs + new attribution): day-one counts treated as public knowledge per user, not cited sources
- Barter notes now hand-owned voice: 8 evaluative notes rewritten (incl. cat-merchant game quote paraphrased), 10 empty notes filled, 11 blueprint notes say 學會後可取消釘選
- Second notes pass: source-voiced lines rewritten in our words (egg rows → 公雞腳下偷雞蛋, chain rows → 後續可向X兌換 formal, 詐騙/爆倉/漂漂 retired)
- Barter dedupe: 3 exact-duplicate `yen-` rows dropped (98→95 rows; notebook ids kept, no migration bump — v6 prune generalizes); `在燃燒`→`再燃燒` typo fixed in `dun-st6/st7` name+give; server-sharing conflicts (`tir-l3`/`col-c2`/`col-c3` vs yenyen rows) held for in-game verification
- Barter server-sharing verdict (in-game): `tir-l3`/`col-c2`/`col-c3` are all 伺服器-shared — notebook counts stand (1次/5次/10次), 3 `yen-` twins dropped (95→92 rows)
- README intro no longer says "heavily inspired" — credits live in 出處與授權 + footer
- READMEs rebuilt user-facing: `README.md` (EN) sells the product with key features, new `README-zh_TW.md` in native TW voice (says 繁體中文版, not 正體中文版), headers link each other; techy parts moved to `docs/development.md` + `docs/storage.md` (storage doc now in English); AGENTS.md gate now covers both READMEs
- `tracker.json` replaces `builtin.ts`: both data files are hand-owned JSON sources of truth
- Single global pin list: fork/personal model removed, tap toggles for all characters (old saves reset to must defaults)
- Barter explorer filters persist across reloads (selects only; search stays session-only, stale towns reset to all)
- Idle-deferred localStorage writes with flush on tab hide/close; rapids taps never block the UI
- Hidden rows move to a bottom sub-category in every section and no longer count toward progress
- Explorer skill chart reacts to filters, sits below the controls, and never jumps (stable rows + animated widths)
- Deferred search input: keystrokes stay instant while the 98-row list updates in background
- Suggest-only fetchers (`suggest-tracker` / `suggest-barter`); `pnpm check` gate (lint + migration fixtures + build)
- Mobile barter rows: two-line layout with 20px NPC avatar in the title, priority chip on its own line, bare give → get with no truncation, and hidden `note` surfaced as a 📝 line (desktop rows unchanged)
- Mobile barter filter card: selects/pills collapse behind a native 展開篩選 disclosure and the skill chart is desktop-only (pure RWD, desktop pixel-identical); search placeholder shortens to 搜尋, pin toggle matches input height, and the pinned-notes legend stays visible outside the collapse
- Mobile v1 finalized: two-line task rows, single-line progress pill with character stepper, compact header, wrapping character tabs, two-line barter rows, collapsible barter filters (desktop unchanged throughout); all prototype rigs removed
- Default barter pins are a hand-owned list (`src/data/defaultPins.json`) instead of derived must-priorities; `pnpm suggest-barter` proposes list additions/removals/stale ids on source drift (matched by trade, not churny yenyen ids)
- Weekly counter tiles for 召喚結界 / 黑色坑洞 show remaining (剩 N / 7, mobile + desktop) with the fill still rising from the bottom with used progress; new first-class `countdown` (倒數) task type, also offered in 新增自訂 with 次數上限 kept (display-only, no save migration)
- Counter/countdown tiles support hold-to-grab quick-adjust: hold 0.3s (haptic) then drag up/down ±1 per 14px, release to end; tap +1 / full-tap-reset and desktop right-click −1 unchanged, mobile long-press popup suppressed; the gesture teaches itself on tap (touch) or hover (desktop) until the first successful grab, then retires it; keyboard arrows adjust a focused tile; no `title` tooltips
- Cross-device sync (Upstash Redis, free tier): header button (icon-only circle on mobile, 跨裝置同步 pill on desktop, `whitespace-nowrap`; emerald tint when linked, matching the done-state green) opens one shadcn/ui dialog showing the live URL (tap-to-copy with inline 已複製 bubble), 複製, 重新產生連結 and 取消同步 (both inline-confirmed); progress auto-pushes in the background while linked (debounced, flushed on tab hide), so the dialog never loads; fresh profiles opening a `?s=` link adopt silently, others confirm via 同步到此裝置; conflicting pushes surface 雲端有較新的進度 (取用雲端 / 保留本機並上傳) on next dialog open instead of silent overwrite; ids are server-minted, sessions evergreen, no login; the binding is reflected in the URL (`?s=`, `replaceState` — address bar is shareable, no history spam, stripped on cancel)
- Sync links survive PWA buckets: manifest `handle_links: preferred` opens tapped links straight in the installed app (Chrome 122+; older browsers fall back to shared-profile storage + pull); new 用連結加入此裝置 paste field in the sync dialog reuses the adopt/confirm/conflict path for buckets a tap can never reach (iOS web app, mismatched Android browsers — same browser for install + links still advised); footer install hint extended to Samsung Internet (menu → 加到主畫面, no `beforeinstallprompt` there)
- Conflict-free sync (replaces 409 + 取用雲端/保留本機 dialog + amber badge): every mutation is an absolute set of flat keys (`v:`, `acc:`, `hide:`, `pin:`, `custom:`, `char:`, `meta:`, `pref:`, `filter:`), server stamps per-key arrival order via PATCH, client diffs against a retained base (deletes as retained null tombstones) and pull-applies wholesale after flushing local edits; ordering stays per-device local, reset markers stay local; v1 blob sessions upgrade in place on first push — verified live (disjoint edits converge, same-key arrival wins, deletes hold)
- Sync design documented in `docs/sync.md` (protocol, key space, findings→decisions, quota budget, verification matrix)
- Linked devices now pull on return: switching back to the tab (or fresh load) does one cheap read — converged state advances silently, real divergence stages the 雲端有較新的進度 dialog instead of waiting for your next edit to 409
- Header countdown isolated into its own component: the 1/sec tick no longer re-renders task lists; header never wraps (nowrap + truncating title), countdown floor is 12px, `(Asia/Taipei)` dropped from the subtitle
- Dialog titles are `h1` (modal isolates the accessibility tree) with left alignment and a separator below; `aria-labelledby`→title and `aria-describedby`→description verified in-DOM; shared dialog is the upstream shadcn radix pattern (a Base-UI registry variant was evaluated and rejected — it would restyle every button)
- PWA installable: hand-owned `manifest.webmanifest` (standalone, existing 192/512 + padded maskable icon), Android/desktop 安裝 App button via `beforeinstallprompt` plus iPhone 分享 → 加入主畫面 hint in the footer; nothing renders when already standalone
- Offline + no-stall updates via `generateSW` default (`src/sw.ts` hand-written NetworkFirst evaluated and dropped — same offline behavior, less owned code): navigations serve the precached shell, new builds take over all tabs immediately (`skipWaiting` + `clientsClaim`) with auto-reload and a build-stamp 已更新到新版本 toast; hashed assets cache-first, NPC art stale-while-revalidate, `/api/*` denylisted (never cached/queued) — verified live (offline reload renders, rebuild-under-open-page updates with toast; the only delta vs NetworkFirst is one briefly-stale render on the very first load after a deploy)

### Fixes
- Tracker rows: dropped hunt / 以物易物-check / life-weekly / acc-guild-weekly; added weekly-goals / guild-challenges / friend-challenges
- Tracker data: added 每日挑戰 (daily counter 0/10) and 每週挑戰 (weekly counter 0/11); 亡靈之塔 counter→check (old numbers show as done, next tap clears); 黑色坑洞 daily→weekly (existing progress carries over, now resets Mondays — no save migration needed)
- 亡靈之塔 back to counter 0/20 now that hold-drag makes big counts practical (was check 2026-09-04); saves with it checked carry over as 20 done (store v10→v11)
- 黑色坑洞 countdown max 7→14 to match 每週最多 14 次 (existing counts carry over, just a higher ceiling)
- Barter rows: removed 需先換 suffixes
- Character rename form contrast and padding; footer credit/link removed; uniform 釘選/已釘選 button width
- Footer action buttons wrap on narrow viewports so 重置所有資料 no longer overflows
- 重置所有資料 uses an inline two-tap confirm (確認清除 / 取消) instead of the native blocking dialog
- Mobile top header padding-y tightened to 10px (desktop stays 12px)
- Desktop character tabs show rename/delete only on the active pill; inactive pills are name-only
- Desktop character tab row wraps instead of scrolling when it overflows
- Account-section hide is now global: one tap hides for every character (daily/weekly stay per-character); saves with per-char-hidden account ids migrate automatically (store v9→v10)
- Removed unused `date-fns` / `date-fns-tz` dependencies; fixed newly-surfaced lint failures without behavior change (add-task form reset via remount key, theme init via lazy state, dead fetcher variable dropped)
- Barter rows skip off-screen layout/paint via `content-visibility` with intrinsic-size scroll placeholders (desktop + mobile)

### Chores
- Agent rule: every commit must update this changelog in the same commit (AGENTS.md pre-commit gate)
- Sync live suites SKIP honestly on the 10/hr/IP create budget (retry within the hour) and exit via drain instead of `process.exit` (hard-crashed Node on Windows)
- Dev-namespace API budgets raised (create 500/hr, rest 600/min) so `pnpm test:sync` never trips rate limits; prod budgets unchanged (gated on server-side namespace, clients can't choose it)
- Preview deployments are now staging: `SYNC_KEY_PREFIX=mabiroutine:dev:` in the Vercel Preview scope (was prod data); live test suites take `SYNC_TEST_BASE` to verify a deployed build
- `pnpm dev:api` runs the full stack locally (`vercel dev` + Vite on :52608); `pnpm dev` stays plain Vite (`dev` can't invoke `vercel dev` — it spawns the dev script, so that's a refused infinite loop)
- Vercel Analytics mounted at app root (`@vercel/analytics/react`)
- Retired the frozen-desktop rule: UI changes now consider both desktop and mobile variants (code comments updated; history entries left as-is)

## 2026-09-03 (`e036f45`)

### Features
- Mobile-only layouts via `useIsMobile` (<640px); desktop UI frozen pixel-identical to the released build (`e036f45`)
- Mobile tracker rows go two-line with zero ellipsis: badges on their own line, 44px tap tiles, ghost eye / ⋯ menu, edge-hug drag grip, full-bleed sections (`e036f45`)
- Mobile compact pill goes single-line: progress + ‹ character › stepper + add + ⋯ menu with inline rename (`e036f45`)
- Mobile header goes single-line (O1): wordmark only + stacked daily/weekly countdown on the right (`e036f45`)

### Chores
- Pill / header throwaway prototypes (`?variant=`, DEV-only) stay wired for the next loop (`e036f45`)

## 2026-09-03 (`a9d8c84`)

### Features
- Tap-tile counters: tap +1, full tile taps back to 0, right-click / long-press −1, progress fills inside the tile (`a9d8c84`)
- Sub-group bleed bands: 以物易物 / 已隱藏 rows stay pixel-equal to top-level rows, band bleeds 8px past them (`a9d8c84`)
- NPC portraits: 76×76 circle avatars on barter rows with placeholder fallback (`a9d8c84`)
- Real Radix Select replaces native dropdowns across character tabs, filters, dialogs (`a9d8c84`)
- Barter explorer card layout C: get-resource title + NPC·town, 你給→你拿 line with right-aligned limit (`a9d8c84`)
- Tracker barter rows share the explorer card design at fixed 88px-min compact height (`a9d8c84`)
- 每日 N 次 barter pins render a counter (max N); 每日 1 次 stays a checkbox (`a9d8c84`)
- 50px emoji / NPC avatar alignment in tracker rows (`a9d8c84`)

### Chores
- Crop script + ledger for NPC portraits; npc-raw excluded from git (`a9d8c84`)

## 2026-09-02 (`e4494aa`)

### Features
- Barter explorer list view with collapsible sections (`e4494aa`)
- TW70 barter seed with 10 must-pins as defaults (`e4494aa`)

### Fixes
- Square checkbox style on tracker rows (`e4494aa`)

## 2026-09-02 (`f0635e0`)

### Features
- Daily / weekly / account tracker with per-character isolation and 06:00 Asia/Taipei resets (`f0635e0`)
- TW-only dataset: 20 builtin tasks, barter merge, hardcoded 黑色坑洞 7+7 and 召喚結界 7 (`f0635e0`)
- Custom tasks with add / edit dialog, drag reorder, hide, JSON import/export (`f0635e0`)
