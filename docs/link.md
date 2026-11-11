# MabiRoutine Link: the app-side feed

The desktop producer (`MabiRoutine Link`) reads the game listener and serves
tracker observations on `127.0.0.1`. This app is the consumer and the
only durable writer: it applies a row to its own store, and the existing sync
persists it.

The producer is not shipped with the app. A user installs it separately, turns
the experimental 即時連結 switch on, and opens the app; it auto-links to the
loopback producer. A pairing code exists on the wire for `--require-code`, but
the beta has no UI for it.

## Transport

The app probes `127.0.0.1:6278` on load without user action. The probe is
silent: it never shows an error and never starts the 1 s poller. When nothing
answers it retries on a 2 s, 4 s, 8 s, 16 s, 32 s, 60 s ladder for the life of
the tab, so a Link started after the browser, or restarted mid-session, is
picked up on its own. There is no connect or disconnect control: the
experimental toggle is the switch, and turning it off reloads without the feed.
Only a producer that answers moves the status to 已連線.

The feature is off by default and behind 實驗性功能 (footer). With it on, the
menu shows one row (`即時連結` · 未連線 / 連線中 / 已連線 / 連線失敗 / 即時 /
未更新) and nothing else; there is no Link panel. A snapshot poller that took
over after a socket drop keeps reading frames, so the freshness words still
describe them. Support evidence lives on the desktop (Link's log,
and the tray menu once the desktop build is packaged) plus two browser-console
lines the app prints itself: one on connect naming the producer's version and
id, one on a refusal the producer cannot see (an unmatched character, a stale
bucket).

| route | method | what |
|---|---|---|
| `/link/1/snapshot` | GET | one snapshot document |
| `/link/1/health` | GET | producer id, version, mode, `lastFrameAt`, uptime, counts |
| `/link/1/stream` | GET | server-sent events, same objects as the socket |
| `/link/1/socket` | GET | WebSocket, `hello` then `snapshot` then `delta` |

- Bind is `127.0.0.1:6278` by default (`MBRT` on a phone keypad).
- **Auto-link is the default.** A browser request with an allowed `Origin` needs
  no token. A request with no `Origin` (curl, CLI) still needs
  `?token=<32 hex>` (or `X-Link-Token`, or `Authorization: Bearer`).
- `Origin` must be this app's origin or a localhost origin. Anything else is
  refused before the WebSocket handshake. The Origin check is the browser gate.
- For a shared PC the producer can run with `--require-code`; every request then
  needs the token. The beta has no app UI for entering it, so auto-link is the
  supported mode and a code-mode producer stays a developer setup.
- The socket URL is `ws://127.0.0.1:6278/link/1/socket`, with an optional
  `?token=…` only in code mode.
- The producer sends `hello`, then `snapshot`, then `delta`. The client sends
  `{"type":"ping"}` every 20 s when idle; three missed pongs means reconnect.
- Chrome may show a Local Network Access prompt on the first connection. It is a
  browser permission, not a pairing code; allow it once. The background probe
  stays on the socket and never polls; the 1 s `GET /snapshot` fallback is used
  only after a Connect, or after a link that has connected before.

## Envelope

Every message is one JSON object:

```json
{
  "protocol": "mabiroutine.link/1",
  "type": "snapshot | delta | hello | pong | error",
  "seq": 42,
  "generated": "2026-11-09T12:04:00+08:00"
}
```

`seq` increases within one producer run. Ignore `seq <= last`; a gap
(`seq > last + 1`) forces a fresh snapshot. A snapshot reports the current
`seq` and does not advance it.

## Row

```json
{
  "task": "daily-dungeon",
  "character": { "gameId": 1001, "name": "角色A" },
  "value": 1,
  "kind": "done",
  "at": 1794209040.12,
  "op": 170497,
  "confidence": "proven",
  "finished": false
}
```

| field | meaning |
|---|---|
| `task` | an app task id, a shop/barter pin id, or an aux id |
| `character.gameId` | the in-game character id |
| `character.name` | the in-game name used for the local identity match |
| `value` | absolute value; the app clamps it to its own row |
| `kind` | `done`, `count`, or `remaining` |
| `at` | the frame's epoch seconds; the app buckets from this |
| `op` | opaque provenance id; never a lookup table in this repo |
| `confidence` | `proven` or `observed` |
| `finished` | `true` once the task is complete for good; the app hides that row. Optional, and a later message never unhides it |

A row is addressed by `(task, character.gameId)`. Account tasks still carry the
observing character, but the app writes them to `accountValues` because its
task definition says so.

## First link

On the first snapshot the app learns the in-game character names:

- an exact name match binds silently;
- an untouched placeholder (`角色 N`, no progress) is renamed to the game name;
- when every local character is still a placeholder, missing game characters
  are created up to the six-character cap;
- a name the user typed is never overwritten, and an existing custom roster is
  not duplicated just because the names differ;
- one local and one game character bind even if the names differ, so a label
  like `Main` still receives the rows.

The binding is device-local (`match` in `mabiroutine:link`). A later in-game
rename does not rename the local character; the `gameId` keeps the binding.

## Active character

Snapshots and deltas carry `active: { gameId, at } | null`, the listener's last
appearing-character identity. When the `gameId` has a local match, the app makes
that character the active tab. An unmatched character does not switch the tab. A
character switch with no row change arrives as a delta with `rows: []`.

## Apply rules

1. **Identity is local.** Match `character.name` to exactly one app character.
   Persist `match[gameId] = cid` in device-local storage. No match or two
   matches leaves a character row unresolved; an account-scope row skips the
   match, because its character is provenance. Apply never creates a character;
   first-link adoption does.
2. **The app owns the bucket.** Compute the bucket from `at` with the app's own
   06:00 Taipei daily and Monday 06:00 weekly rule. A row from an older bucket
   is refused. A grouped parent's sub-counters carry over and are re-stamped.
3. **Monotonic per row.** Keep the last applied `at` per
   `(scope, owner, task, bucket)` and ignore anything not newer.
4. **The wire never beats a pin.** A user tap records a device-local pin for
   that row and bucket. Nothing is recorded while the switch is off, since only
   the feed reads a pin. While the pin exists, the feed does not apply to it.
5. **Unknown is dropped.** An unresolved task or character is counted and
   printed to the browser console. Nothing is created from the feed.
6. **Market rows are offered.** A shop or barter id that is not pinned in the
   app is never written; it applies only once the user pins that deal from the
   merchant panel. With no Link panel there is no offer list to act on.
7. **Stale is explicit.** `lastFrameAt` older than 30 s shows 未更新 and a
   closed socket shows 連線失敗. Neither is rendered as current.

### Special rows

- `barrier`: the wire value is **remaining**; the app stores **used**, so the
  tile can show `max - used`.
- `black-hole`: the app stores the weekly bank (0..7) and today's daily check.
  The wire sends weekly remaining, today's remaining, and `black-hole-daily`.
  Compose the trio once per message:
  `bank = clamp(14 - weeklyRemaining - elapsed - todayUsed, 0, 7)`, where
  `elapsed = 6 - blackHoleX(at)` and `todayUsed` comes from the daily check.
  A check or count whose `at` is not in the current daily bucket is ignored:
  after the 06:00 roll it belongs to yesterday, and trusting it stores a bank
  one too low and shows the tile one too high.
  `black-hole-today` is an aux input, not a stored row.
- `parttime-active` is aux telemetry; the app's row is `parttime`.
- `tower`: the value is the attempts **used**. `finished` turns true at the
  150-floor cap and the app hides the row; nothing in the feed clears it.

## Device-local state

The token, `match`, pins, watermarks, the black-hole inputs and `lastFrameAt`
live in `localStorage` under `mabiroutine:link`. They are **not** in the synced
store: the token is private to the install, and `cid` is a local random id.

Pin key: `account:{task}@{bucket}` or `{cid}:{task}@{bucket}`.
Watermark key: the same shape.

## Running it locally

The app reads the feed at `127.0.0.1:6278`, so the desktop service that serves
the listener's state has to run first. Start in this order:

1. the game, logged in
2. the capture listener that writes the tracker state file
3. the desktop service on port 6278
4. `pnpm dev` in this repo, then enable 即時連結 in 實驗性功能 at the footer

The menu row shows the phase: 即時 while frames are fresh, 未更新 after 30 s
without one (quiet is not disconnected), and 未連線 when nothing is listening. Auto-link needs no code for a page
served from a localhost origin. The service's `--require-code` is out of scope
for this beta: the app has no pairing UI, so auto-link is the only supported
mode. Restarting the service is safe: the app reconnects and takes a fresh
snapshot.

## Ownership

The wire belongs to the producer: a row's meaning, value or cadence changes
there first, with a protocol version bump when an older app would read it wrong.
This file is the app-side contract. Apply, buckets, identity and the menu row are
ours. A producer change that needs new app behaviour arrives as a note naming
the commit, never as a silent change to the snapshot.

## What the app must not do

- Write to the producer. The feed is read-only at this side.
- Create a tracker row or custom task from a wire id. Character creation is
  limited to first-link adoption, which renames a placeholder or fills an empty
  roster; apply itself creates nothing.
- Put the token, pins or watermarks into the synced key space.
- Publish a producer opcode table. `op` is displayed as provenance, not decoded.
