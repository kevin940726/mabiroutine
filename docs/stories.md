# User stories — sync & launch

UDD source of truth for sync behavior: every sync mechanism must trace to
one of these stories. New behavior starts here — story + acceptance criteria
first — and `docs/sync.md` records *how* the story is implemented, never
*what* without a story behind it. Story IDs are stable; cite them from tech
docs and commit messages (`S1`, `S3`, …).

Scope: sync + first-launch freshness only. Tracker/barter UI has no stories
yet — out of scope until a behavior dispute needs one.

## S1 — Launch shows the other device's latest

As a user who tracks on two devices, when I launch the app I see the other
device's latest checks as fast as possible, so I never tap against a stale
picture.

- Given linked and the peer pushed newer values, when I cold-boot online,
  then the peer's values render as soon as the boot pull lands (session GET
  preloaded, overlapping JS bootstrap); my own unpushed edits still land, and
  a key both sides changed since my last sync adopts the peer's value (the
  base arbitrates contests, decision 16 — arrival alone cannot tell a stale
  leftover from a fresh tap).
- Given I am offline, when I launch, then my last local state renders
  immediately with no error; sync resumes on next foreground or within 60s.
- Maps to: `index.html` preload → `takePreloaded` (`src/sync/api.ts`) →
  `pullNow` (`src/sync/SyncButton.tsx`) → `syncAndResets`
  (`src/sync/session.ts`); `docs/sync.md` Round. Gate: browser wake-pull E2E,
  E18.

## S2 — Either device's taps converge, no dialogs

As a user with two devices, when I check/uncheck/clear on either one, the
other shows it, so I never reconcile by hand.

- Given disjoint edits on both devices, when each backgrounds/foregrounds
  (or 60s passes), then both converge; same-key contests resolve silently in
  favor of the cloud (the base arbitrates, decision 16), while a live-tab
  auto-push still lands by arrival (accepted: end state wins over intent
  audit).
- Given I uncheck or zero something, when the peer pulls, then it shows
  unchecked/zero — never resurrected by my own earlier value.
- Maps to: `pushNow` + `planRound` (`src/sync/round.ts`) + `flat.ts` key
  space; `docs/sync.md` Round, findings #1/#2/#4. Gate: E4, E8, E9, E17–E20,
  tap→render E2E.

## S3 — A late-waking device never wipes its peer

As a user opening a device days later, my stale view never deletes the other
device's current progress, so I can leave a device in a drawer without fear.

- Given this device holds last week's values, when it boots after a reset,
  then it adopts the peer's current-bucket values BEFORE pruning its own,
  prunes memory-only, and pushes nothing that deletes.
- Given a reset happened anywhere, when any device pulls, then no tombstone
  for a cycle key ever crosses the wire (expiry is read-time, by bucket).
- Maps to: `syncAndResets` pull-first (`src/sync/session.ts`) + forced hook
  (`pullNow`, `src/sync/SyncButton.tsx`), `flat.ts` bucket tagging + `diffFlat`
  silences; `docs/sync.md` Reset, findings #5/#12. Gate: E1, E8, E17, P.

## S4 — A sync link onboards the new device safely

As a user opening a sync link on a new device, I join the shared progress
without endangering what's already there.

- Given this profile is pristine, when I open the link, then it adopts
  silently (there is nothing worth protecting).
- Given it holds my own progress, when I open another session's link, then
  I get a confirm dialog before any switch; cancelling strips `?s=`.
- Given the link is my own session, when I open it, then it just pulls.
- Maps to: `src/sync/session.ts` `requestImport`/`adoptState`;
  `docs/sync.md` Adopt. Gate: legacy-adopt verified live.

## S5 — Offline is a usable tracker, not an error

As a user with no network, the app still opens with my last state and takes
taps, so a dead zone never costs me progress.

- Given offline at boot, when I launch, then the last local state renders
  (persisted synchronous read) and background sync fails silent.
- Given I tap while offline, when the network returns, then pending edits
  push on the next trigger (foreground ≤60s cadence); no blocking error UI
  at any point.
- Maps to: `src/sync/api.ts` `offline()` guards, `src/lib/storage.ts`
  idle-deferred persist; `docs/sync.md` Pull (silent catch). Gate: offline
  shell render verified live.
