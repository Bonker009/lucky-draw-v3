# Testing Lucky Draw

A ready-to-draw test environment in one command. No Node, no build steps, no data entry.

## 1. Start it

You need **Docker Desktop** (running) and a copy of this repository.

**macOS / Linux / Git Bash on Windows**

```bash
./docker-run.sh
```

It builds the image the first time (a few minutes), picks a free port starting at 3000, waits until
the app answers, and prints the links. Stop it with `./docker-run.sh down`.

**Windows PowerShell** (no Git Bash)

```powershell
docker compose up --build -d
```

That serves on port 3000 (set `$env:HOST_PORT = "8080"` first to use another port). Stop it with
`docker compose down`.

## 2. Open the demo

Go to **http://localhost:3000/demo** (or the port the script printed).

It loads a sample event straight away: **250 participants and four prizes with photos** (motorbike,
smartphone, headphones, gift voucher). Then use its two buttons:

- **Open stage**: the projector screen. Press **F** for fullscreen.
- **Open control**: the presenter's remote. Open it in **another tab or window of the same
  browser**.

> The stage and the control talk through the browser itself, so they must be in the **same browser on
> the same computer**. A control opened on a phone or in a different browser will say "No stage".

**Start over** at any time by opening `/demo` again (or pressing *Reset demo*). Your data lives only
in your browser, so testers never see each other's draws.

## 3. What to try

On the **control** unless noted.

| Area | Try | Expect |
|---|---|---|
| Prize reveal | Prize reveal panel → **Show**, then **Reveal** | Covered card ("Up next · 1 to be won"), then the prize unveils. Draw takes the screen back. |
| Prize styles | Setup → Presentation → *Prize reveal*: try all five | Cover lift, running order, departures board, louvre shutter, focus pull |
| Single draw | How many **1** → **Draw** | Name wall knocks out in halves; winner in gold with sparkles, fanfare, confetti |
| Batch draw | How many **3** → **Draw** | One knock-out to the last 3, then each is called forward in turn ("Winner 2 of 3") |
| Big batch | Gift voucher, **All** | Lands all at once |
| Draw styles | Setup → Presentation → *Draw style*: try all five | Wall, split-flap, envelope, letter reels, classic reel |
| Photo session | Photo session → a prize | Numbered names; tick people off in the check-in list; mark a no-show; switch to **Backdrop** |
| Big photo call | Photo session on the gift voucher (25) | Pages in groups of 10 with ‹ › |
| Stop / Undo | **Stop** mid-spin; **Undo last** (press twice) | Stops at once; undo removes the last winner |
| Stage keys | On the stage: Space draw, S stop, R prize reveal, P photo board, B backdrop, ← → groups | Same as the control |
| Fairness | Setup → Fairness → **Verify the draw** | Every winner re-derived from the log |
| Reduced motion | Control → *Reduced motion* on | Animations hold still; the draw still works |
| Light / dark | Theme toggle on setup and control | Both readable; the stage stays dark |

## 4. Reporting a problem

Please include:

- what you did, what you expected and what happened
- which screen (setup, stage, control), which draw style and prize-reveal style
- browser and screen size
- a screenshot, and if you can, a backup: Setup → Data → **Export backup** (this file reproduces the
  event exactly)

## For developers

`npm test` runs the unit tests, and `npm run test:e2e` builds and runs the browser suite (see
`CLAUDE.md`). `/demo` replaces the browser's event with the sample one; if the browser holds an event
that is not the demo, it asks first.
