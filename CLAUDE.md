# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev            # next dev
npm run build          # next build
npm run lint           # eslint (flat config, eslint-config-next core-web-vitals + typescript)
npm test               # vitest run  — unit tests, node environment, lib/**/*.test.ts only
npm run test:watch
npm run test:e2e       # next build && playwright test (chromium, serial, port 3100)
```

Single unit test: `npx vitest run lib/domain/draw.test.ts -t "name of the case"`
Single e2e test: `npx playwright test e2e/draw.spec.ts -g "Stop actually stops"`

E2E deliberately runs against the production build, never `next dev` — dev mode double-invokes
effects and its timing is not representative of the projector laptop. Don't "fix" this by
pointing the webServer at `next dev`.

`webServer` uses `reuseExistingServer`, so a `next start` left listening on 3100 from an earlier
run will be reused and your new build never gets served. If e2e fails in ways that make no sense
(pages stuck on "Loading event…"), kill whatever holds 3100 and re-run before debugging the code.

## Architecture

An offline, browser-only lucky draw for live events. There is no server and no API route: the
draw runs entirely in the tab, backed by IndexedDB. Everything about the design follows from
two constraints — **a winner announced on screen must already be committed**, and **the result
must be verifiable after the fact**.

### Event sourcing is the whole model (`lib/domain/`)

State is never edited. It is always `fold(events)` over an append-only log of `DrawEvent`s.

- `types.ts` — `DrawEvent` union, `StoredEvent` (`seq`, `at`, `event`), and the folded `DrawState`
  (which carries `Map` indexes plus `drawCount`, the RNG nonce source).
- `events.ts` — `applyEvent` is the **only** place state changes shape; `assertBatchValid` validates
  a whole batch (including intra-batch conflicts) *before* anything is persisted or shown.
- `rng.ts` — PCG-XSH-RR seeded from `(settings.seed, nonce)`, with rejection sampling in
  `nextBelow` to avoid modulo bias. Also `computeCommitment`, the pre-event hash over seed +
  roster + prize manifest.
- `draw.ts` — `computeDraw` is pure: it picks winners and returns the `WINNER_DRAWN` events that
  reproduce them. `verifyLog` replays a log and re-derives every winner.
- `selectors.ts` — derived reads (eligibility, remaining stock, prize order). Never compute these
  ad hoc in components.

Never call `Math.random()`, `Date.now()`, or touch the DOM inside `lib/domain/`. Determinism there
is what makes `verifyLog` and the published commitment meaningful. In particular, `computeDraw`
uses `splice` (not swap-remove) on the candidate pool so a replay rebuilding eligibility in roster
order sees the same pool; and `WINNER_REVOKED` deliberately does **not** decrement `drawCount`,
because reusing a nonce would make the re-draw reproduce the pick it was meant to replace.

### Write path (`lib/store/`)

`useEventStore.commit()` (zustand) is the only write path: validate → persist in one IndexedDB
transaction → fold → broadcast. `undoLast` cuts the log back to before the last `WINNER_DRAWN`.
Rehearsal mode keeps commits in memory and skips persistence.

`WriterLease` (localStorage heartbeat) elects a single writer across tabs. Only the lease holder
may commit; every other window is read-only and must say so.

### Two windows, one writer (`lib/channel.ts`)

`/stage` is the projector view and the **only** writer. `/control` is the presenter remote: it
posts `cmd:*` commands and mirrors `evt:*` broadcasts, and never commits. `/` is setup. The
channel has no "force reload" message by design — one arriving mid-draw would destroy the
in-flight chain.

### The draw engine (`lib/engine/draw-engine.ts`)

A plain class outside React, subscribed to via `useSyncExternalStore`, so re-renders cannot
disturb a running draw. Its contract:

- Cancellation is an `AbortSignal` read at await time, never a value captured in a closure, and
  every timer is registered so `stop()` can clear it (`pendingTimerCount` is exposed for tests).
- `run()` rejects re-entry, so click + spacebar + remote command still produce exactly one draw.
- **Commit first, reveal second** — `onCommit` resolves before the wall starts sweeping toward a
  name.

`useStageController` is the single funnel for starting a draw (button, spacebar, remote command
all go through `draw()`), and keeps live values in a ref so handlers never read stale state.

### Persistence and IO (`lib/persist/`)

`db.ts` owns the `lucky-draw-v3` IndexedDB (`events` / `assets` / `meta`). `import.ts` turns
CSV/XLSX rows into participants — each row gets its own id, names are never identities.
`backup.ts` exports/imports a versioned bundle (log + assets as data URLs); restoring reproduces
the event exactly.

`e2e/helpers.ts` seeds that database directly at version 1. If you change the schema, change the
helper too or every e2e test hangs on a page that never becomes ready.

## UI

`components/setup/*` for `/`, `components/stage/*` for `/stage`, `components/ui/*` is shadcn/ui
(radix base, `nova` preset — `components.json`). Styling is Tailwind v4 with everything declared
in `app/globals.css`.

**Two palettes, and mixing them is the easy mistake.** `--base-*` / `--ink-*` / `--gold*` are the
*stage* ramp and never change — the stage, the name wall and the backdrop are built on them and
are always dark because they point at a projector. The shadcn semantic tokens (`--background`,
`--card`, `--border`, `--muted-foreground`, …) are what flip between light and dark. So:

- On operator surfaces (`/`, `/control`) use `bg-card`, `text-foreground`,
  `text-muted-foreground`, `border-border`, and `text-gold-ui` / `text-gold-ui-strong` for the
  accent. A `bg-base-800` or `text-ink-100` there pins that element dark and it will not survive a
  theme switch.
- On the stage keep using the `base`/`ink`/`gold` classes. `/stage` pins itself with a `dark`
  class on its root; don't remove it.
- `text-gold-ui` exists because the stage gold is tuned to glow on near-black and turns to mud on
  white; the light theme darkens it.
- **Gold means "winner" (or "live on stage"), nothing else.** Primary buttons are ink
  (`bg-primary` is near-black in light, near-white in dark), and switches, sliders, progress bars,
  selected rows and status text are neutral. A gold control next to a gold winner name made both
  read as equally important. If you reach for gold, ask whether it marks a winner.

Theming is `next-themes` (`attribute="class"`, default dark, system enabled) via
`components/theme-provider.tsx`, toggled by `components/theme-toggle.tsx`.

Use `.ui-eyebrow` for small caps labels on operator surfaces, **not** `.stage-label` —
`.stage-label` is sized for a projector and, being an unlayered rule, its `font-size` beats any
Tailwind `text-*` utility you pair with it.

Stage sound effects are [soundcn](https://soundcn.xyz) assets (CC0, base64 inside TS modules, so
still offline) in `lib/sounds/`, played by `lib/hooks/use-sound.ts`. Add one with
`npx shadcn@latest add https://www.soundcn.xyz/r/<name>.json`, then move the file from `lib/` into
`lib/sounds/` and point its import at `./sound-types`. Don't use soundcn's own `useSound` hook — it
sets React state on every play, which is wasted work for a fire-and-forget tick.

Khmer text needs the `:lang(km)` / `.km` font rule to avoid clipped diacritics. `useFrameBudget`
steps visual quality down when FPS drops; `usePrefersReducedMotion` shortens spins. Honor both in
new stage visuals — the name wall drops its sweep band at `minimal` quality and under reduced
motion.

### The stage (`app/stage/page.tsx`)

A fixed one-viewport grid: `h-dvh`, `overflow-hidden`, `grid-rows-[minmax(0,1fr)_auto]`
(stage / error). **It must never scroll** — it is the one screen in the building nobody can
scroll, and an earlier `min-h-dvh` column put the Draw button below the fold once the winners
rail filled up. Anything added here goes inside an existing row, and the stage row stays `min-h-0`.

The audience sees only the name wall and the winners rail — no top bar. The control bar
is an absolutely positioned overlay that appears on pointer movement and fades after ~2.5s idle
(keyboard shortcuts always work). The Rehearsal / Read-only pills are the one exception and only
render when true.

The prize is not shown on the stage (only an `sr-only` h1, which e2e waits on). Status
(read-only, rehearsal) is compact pills overlaid top-left, not full-width banners — a banner row
costs the wall vertical space permanently. `WinnersRail` scrolls inside itself and is capped, and
holds its width even before the first winner (an empty spacer) — appearing on the first reveal
used to reflow every column of the wall under the winner's name.

There is no separate winner-reveal screen: **the wall is always mounted and the last name
standing is the reveal.** The stage passes `targetId={snapshot.revealed ?? snapshot.target}` so
the wall holds the winner through the reveal hold, and `landed` to play the final round.

**Nothing on the stage may render committed-but-unrevealed state.** The engine commits a winner
*before* starting the wall towards them — that ordering is what makes "announced but never saved"
impossible — so for the whole spin everything derived from `state` already knows the answer. The
winners rail printed the name beside the drum while the audience watched it turn, and the
remaining count and pips gave it away too. `unrevealed` (in `app/stage/page.tsx`) is the count of
such winners: always 0 or 1, and 1 only while the wall is actually running towards a target. Feed
any new audience-facing figure through it, the way `shownRemaining`, `eligible` and
`WinnersRail`'s `hideCount` do. `e2e/draw.spec.ts` → "no spoilers" pins this down; it has been
verified to fail when the adjustment is removed.

`/control` is held to the same rule. It was once deliberately unadjusted ("the presenter's own
laptop"), but that laptop is often in view and it printed the winner the instant Draw was pressed.
The stage now broadcasts `shown` on `evt:phase` — how many winners, in log order, have actually
been revealed, with the run's baseline taken inside `draw()` before anything commits — and the
remote renders everything through `revealedView(state, shown)`. Don't let the remote infer this
from phases: the next commit of a batch lands while the phase still says `revealing`. Commands
still read the real state. `e2e/draw.spec.ts` → "never shows a winner before the drum lands"
has been verified to fail with the cap removed.

The remote may change only `LiveSettings` (timing, sound, motion) via `cmd:patchSettings`, which
the stage runs through `sanitizeLiveSettings` before committing. Never the seed or prize order.

An uploaded background is usually a busy photo, so it renders at low opacity under a radial scrim
local to the centre column. Names have to win against whatever someone uploaded.

### The name wall (`components/stage/name-wall.tsx`)

Every eligible name on screen at once, knocked out in halves (236 → 118 → … → 2 → 1) until the
committed winner is the last one standing. It replaced a spinning name reel, which showed five
names out of hundreds: nobody saw themselves, and nothing said "everyone is in this". Constraints
to preserve:

- **It reveals, it never picks.** `targetId` is the winner the engine already committed. The
  knock-out order comes from `lib/stage/wall-plan.ts` (`planWall`), which is unit-tested never to
  knock out the winner, to leave exactly `ceil(alive / 2)` after every round, and to be
  deterministic per (pool, winner). It uses its own small PRNG on purpose — never pull
  presentation randomness from `lib/domain/rng.ts`, whose nonces the log depends on.
- **The pool includes the target.** `eligibleParticipants` has already dropped the winner by the
  time the wall starts (commit first), so the stage adds it back. Entries are ids, not names, so
  two people with the same name are two tiles.
- **The final round waits for `landed`.** Rounds before the last run on the wall's own clock
  (`RUN_SHARE` of the spin) and stop with two names standing; the last knock-out only plays when
  the engine reveals. Suspense scaling stretches the engine's spin, not the wall's, so the wall
  must never land on its own.
- **The run is keyed on `targetId` alone.** Quality, reduced motion, duration and `onTick` are read
  through a ref. `useFrameBudget` downgrades exactly when frames slip — as an effect dependency it
  would restart the sweep mid-reveal (the reel this replaced had that bug: the winner slid off the
  payline a second after landing).
- **Canvas, not DOM.** One element per name is the v2 failure that "500 participants do not
  inflate the DOM" catches. The only DOM text is the count line and, once landed, the winner
  overlay (`data-testid="wall-winner"`) — it must not exist before the reveal. Past the point
  where text would drop under `MIN_FONT` the wall draws dots, and gives the dots their names back
  once 40 or fewer remain.
- The canvas exposes `data-pool-size` and `data-alive` for tests; `e2e/draw.spec.ts` → "the wall"
  checks it lands on exactly the committed winner without naming them early.

## Comment style

Existing comments explain *why*, and several cite a concrete v2 failure the current design
prevents (stale closures breaking Stop, multiple writers overwriting winners, name-keyed
identities, unrendered performance monitors). Keep that tone; don't strip those rationales.
