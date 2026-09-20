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
- **Commit first, reveal second** — `onCommit` resolves before the reel starts spinning toward a
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
*stage* ramp and never change — the stage, the reel and the backdrop are built on them and are
always dark because they point at a projector. The shadcn semantic tokens (`--background`,
`--card`, `--border`, `--muted-foreground`, …) are what flip between light and dark. So:

- On operator surfaces (`/`, `/control`) use `bg-card`, `text-foreground`,
  `text-muted-foreground`, `border-border`, and `text-gold-ui` / `text-gold-ui-strong` for the
  accent. A `bg-base-800` or `text-ink-100` there pins that element dark and it will not survive a
  theme switch.
- On the stage keep using the `base`/`ink`/`gold` classes. `/stage` pins itself with a `dark`
  class on its root; don't remove it.
- `text-gold-ui` exists because the stage gold is tuned to glow on near-black and turns to mud on
  white; the light theme darkens it.

Theming is `next-themes` (`attribute="class"`, default dark, system enabled) via
`components/theme-provider.tsx`, toggled by `components/theme-toggle.tsx`.

Use `.ui-eyebrow` for small caps labels on operator surfaces, **not** `.stage-label` —
`.stage-label` is sized for a projector and, being an unlayered rule, its `font-size` beats any
Tailwind `text-*` utility you pair with it.

Khmer text needs the `:lang(km)` / `.km` font rule to avoid clipped diacritics. `useFrameBudget`
steps visual quality down when FPS drops; `usePrefersReducedMotion` shortens spins. Honor both in
new stage visuals — the reel already drops its motion blur and its rumble below `full` quality.

### The stage (`app/stage/page.tsx`)

A fixed one-viewport grid: `h-dvh`, `overflow-hidden`,
`grid-rows-[auto_minmax(0,1fr)_auto_auto]` (top bar / stage / error / controls). **It must never
scroll** — it is the one screen in the building nobody can scroll, and an earlier `min-h-dvh`
column put the Draw button below the fold once the winners rail filled up. Anything added here
goes inside an existing row, and the middle row stays `min-h-0`.

The centre column is a `grid-rows-[1fr_auto_1fr]`, which is what puts the drum on the exact
optical centre; the prize header sits bottom-aligned in the top track. Status (read-only,
rehearsal) is compact pills in the top bar, not full-width banners — a banner row costs the reel
vertical space permanently. `WinnersRail` scrolls inside itself and is capped.

There is no separate winner-reveal screen: **the reel is always mounted and the name it stops on
is the reveal.** The stage passes `target={snapshot.revealed ?? snapshot.target}` so the drum
holds the winner through the reveal hold, and `landed` to trigger the payoff styling.

**Nothing on the stage may render committed-but-unrevealed state.** The engine commits a winner
*before* starting the drum towards them — that ordering is what makes "announced but never saved"
impossible — so for the whole spin everything derived from `state` already knows the answer. The
winners rail printed the name beside the reel while the audience watched it turn, and the
remaining count and pips gave it away too. `unrevealed` (in `app/stage/page.tsx`) is the count of
such winners: always 0 or 1, and 1 only while the drum is actually running towards a target. Feed
any new audience-facing figure through it, the way `shownRemaining`, `eligible` and
`WinnersRail`'s `hideCount` do. `e2e/draw.spec.ts` → "no spoilers" pins this down; it has been
verified to fail when the adjustment is removed.

The operator surfaces are deliberately *not* adjusted — `/control` is the presenter's own laptop
and should see the truth as soon as it is committed.

An uploaded background is usually a busy photo, so it renders at low opacity under a radial scrim
local to the centre column, and the drum housing is near-opaque with a backdrop blur. Names have
to win against whatever someone uploaded.

### The reel (`components/stage/reel.tsx`)

The spin is one Web Animations API animation on one node, in four phases (wind-up → run → brake →
overshoot-and-settle), with motion blur keyframed alongside the transform. Constraints to
preserve:

- The strip is a fixed `RUNWAY + VISIBLE_ROWS` rows regardless of roster size, and `target` is a
  prop — the reel reveals the winner, it never picks one.
- The spin effect is keyed on `target` alone, never on a "spinning" flag — the drum has to hold
  its landed position once the engine moves on to `revealing`.
- Row height is measured from the viewport (`DRUM_VIEWPORT_SHARE`) so the drum fits a 720p beamer;
  font size is derived from it. Resizing re-renders, but only between spins.
- The drum curve is the static `.reel-barrel` / `.reel-glare` overlays, not per-row 3D. Modelling
  a real cylinder would mean a rotateX per row per frame.
- Decoration (`.reel-rumbling` while spinning; `.reel-impact` / `.winner-pop` / `.payline-sweep` /
  `.payline-lock` on landing) is applied imperatively to refs so it never re-renders mid-spin, and
  goes on the *housing*, never the track — the track owns the spin transform. All of it is gated
  on `reducedMotion`, and the rumble additionally on `quality === "full"`.
- Re-adding an animation class in the frame it was removed is coalesced and never plays; the
  `replay()` helper forces a reflow in between.
- **`quality` must never be an effect dependency here.** `useFrameBudget` downgrades exactly when
  frames slip — which is when the confetti fires and the drum is blurring. As a dependency it
  re-ran the spin effect mid-reveal, cancelling the finished animation and starting a fresh spin,
  so the winner slid off the payline a second after landing. It is read through `qualityRef`.
- The cabinet state lives as `is-spinning` / `is-win` classes on the `.reel-drum` wrapper, which
  drive the marquee bulbs (`bulb-breathe` idle → `bulb-chase` spinning → `bulb-strobe` on the
  stop) and the `.reel-bloom` lamp. Bulb count is fixed at `BULBS`; the chase is a staggered
  `animation-delay`, not per-frame work.

## Comment style

Existing comments explain *why*, and several cite a concrete v2 failure the current design
prevents (stale closures breaking Stop, multiple writers overwriting winners, name-keyed
identities, unrendered performance monitors). Keep that tone; don't strip those rationales.
