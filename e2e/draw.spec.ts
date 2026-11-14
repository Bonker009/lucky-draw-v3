import { expect, test } from "@playwright/test";
import { drawnWinnerIds, readLog, seedEvent } from "./helpers";

/**
 * These tests exist because of two specific failures at last year's event:
 * the Stop button did nothing and the app froze, and the same people were
 * drawn more than once. Each is pinned down here.
 */

test.describe("the stage", () => {
  test.beforeEach(async ({ page }) => {
    await seedEvent(page, {
      participants: 200,
      prizes: [
        { name: "Grand Prize", quantity: 3 },
        { name: "Runner Up", quantity: 25 },
      ],
      spinDurationMs: 300,
    });
  });

  test("Stop actually stops a long batch", async ({ page }) => {
    await page.goto("/stage");
    await expect(page.getByRole("heading", { name: "Grand Prize" })).toBeVisible();

    // Drive it the way the control window does: select and draw all 25.
    await page.evaluate(() => {
      const bc = new BroadcastChannel("lucky-draw-v3");
      bc.postMessage({ kind: "cmd:selectPrize", prizeId: "z1" });
      bc.postMessage({ kind: "cmd:draw", prizeId: "z1", count: 25 });
      bc.close();
    });

    // Let a few winners land, then stop.
    await page.waitForTimeout(1500);
    const started = Date.now();
    await page.keyboard.press("s");

    // The count must stop climbing almost immediately. v2 would have ground
    // through all 25 regardless.
    await page.waitForTimeout(400);
    const settled = await drawnWinnerIds(page);
    await page.waitForTimeout(1500);
    const afterWaiting = await drawnWinnerIds(page);

    expect(Date.now() - started).toBeLessThan(5000);
    expect(afterWaiting.length).toBe(settled.length);
    expect(afterWaiting.length).toBeLessThan(25);

    // And the page is still alive and interactive.
    await expect(page.getByRole("heading", { name: "Runner Up" })).toBeVisible();
  });

  test("the page stays responsive while a draw runs", async ({ page }) => {
    await page.goto("/stage");
    await page.evaluate(() => {
      const bc = new BroadcastChannel("lucky-draw-v3");
      bc.postMessage({ kind: "cmd:draw", prizeId: "z1", count: 20 });
      bc.close();
    });
    await page.waitForTimeout(800);

    // A round trip through the main thread under 1s means we are not blocked.
    const latency = await page.evaluate(async () => {
      const t0 = performance.now();
      await new Promise((r) => requestAnimationFrame(r));
      return performance.now() - t0;
    });
    expect(latency).toBeLessThan(1000);

    await page.keyboard.press("s");
  });
});

test.describe("no duplicate winners", () => {
  test("hammering the draw trigger produces exactly one draw", async ({
    page,
  }) => {
    await seedEvent(page, {
      participants: 100,
      prizes: [{ name: "Prize", quantity: 50 }],
      spinDurationMs: 600,
    });
    await page.goto("/stage");
    await expect(page.getByRole("heading", { name: "Prize" })).toBeVisible();

    // Spacebar spam plus simultaneous remote commands — v2's three unguarded
    // triggers were how one press became several draws.
    await page.evaluate(() => {
      const bc = new BroadcastChannel("lucky-draw-v3");
      for (let i = 0; i < 5; i++) {
        bc.postMessage({ kind: "cmd:draw", prizeId: "z0", count: 1 });
      }
      bc.close();
    });
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press("Space");
    }

    await page.waitForTimeout(3000);
    const winners = await drawnWinnerIds(page);
    expect(winners.length).toBe(1);
  });

  test("a full event never repeats a name", async ({ page }) => {
    await seedEvent(page, {
      participants: 60,
      prizes: [
        { name: "A", quantity: 10 },
        { name: "B", quantity: 20 },
        { name: "C", quantity: 30 },
      ],
      spinDurationMs: 50,
      revealHoldMs: 50,
    });
    await page.goto("/stage");
    await expect(page.getByRole("heading", { name: "A" })).toBeVisible();

    for (const prizeId of ["z0", "z1", "z2"]) {
      const count = { z0: 10, z1: 20, z2: 30 }[prizeId]!;
      await page.evaluate(
        ([id, n]) => {
          const bc = new BroadcastChannel("lucky-draw-v3");
          bc.postMessage({ kind: "cmd:draw", prizeId: id, count: n });
          bc.close();
        },
        [prizeId, count] as const,
      );
      // Each winner takes spin + hold; wait generously for the batch.
      await page.waitForTimeout(count * 150 + 2000);
    }

    const winners = await drawnWinnerIds(page);
    expect(winners.length).toBe(60);
    expect(new Set(winners).size).toBe(60);
  });
});

test.describe("no spoilers", () => {
  /**
   * The engine commits a winner and only then starts the drum towards them,
   * so nothing can be announced that was not saved. Everything derived from
   * the folded state therefore knows the answer for the whole spin, and the
   * winners rail was printing the name beside the reel while the audience
   * watched it turn.
   *
   * Two draws, not one: with no winners yet the rail does not render at all,
   * and an absent element would make the negative assertion pass for the
   * wrong reason.
   */
  test("the rail does not name a winner before the drum lands", async ({
    page,
  }) => {
    const nameOf = (id: string) => `Guest ${id.slice(1).padStart(4, "0")}`;

    await seedEvent(page, {
      participants: 50,
      prizes: [{ name: "Grand Prize", quantity: 3 }],
      // Long enough to sample the page while the drum is still running.
      spinDurationMs: 3000,
      revealHoldMs: 300,
    });
    await page.goto("/stage");
    await expect(
      page.getByRole("heading", { name: "Grand Prize" }),
    ).toBeVisible();

    const draw = () =>
      page.evaluate(() => {
        const bc = new BroadcastChannel("lucky-draw-v3");
        bc.postMessage({ kind: "cmd:draw", prizeId: "z0", count: 1 });
        bc.close();
      });

    const rail = page.getByRole("complementary");

    // One winner, all the way through, so the rail is on screen and populated.
    await draw();
    await expect(rail).toContainText("Guest", { timeout: 20_000 });
    const afterFirst = await drawnWinnerIds(page);
    expect(afterFirst).toHaveLength(1);
    await expect(rail).toContainText("Winners · 1");

    // Now start a second draw and look at the page mid-spin.
    await draw();
    await page.waitForTimeout(1200);

    const committed = await drawnWinnerIds(page);
    expect(committed).toHaveLength(2);

    // Committed, but the drum is still turning: it must not be readable.
    await expect(rail).not.toContainText(nameOf(committed[1]));
    await expect(rail).toContainText("Winners · 1");
    await expect(rail).toContainText(nameOf(committed[0]));

    // And once the drum stops, it appears.
    await expect(rail).toContainText(nameOf(committed[1]), {
      timeout: 20_000,
    });
    await expect(rail).toContainText("Winners · 2");
  });
});

test.describe("durability", () => {
  test("a reload replays the committed winners exactly", async ({ page }) => {
    await seedEvent(page, {
      participants: 50,
      prizes: [{ name: "Prize", quantity: 10 }],
      spinDurationMs: 200,
    });
    await page.goto("/stage");
    await expect(page.getByRole("heading", { name: "Prize" })).toBeVisible();

    await page.evaluate(() => {
      const bc = new BroadcastChannel("lucky-draw-v3");
      bc.postMessage({ kind: "cmd:draw", prizeId: "z0", count: 3 });
      bc.close();
    });
    await page.waitForTimeout(3 * 900 + 1500);

    const before = await drawnWinnerIds(page);
    expect(before.length).toBe(3);

    await page.reload();
    await expect(page.getByRole("heading", { name: "Prize" })).toBeVisible();

    const after = await drawnWinnerIds(page);
    expect(after).toEqual(before);
    await expect(page.locator("text=/Winners · 3/")).toBeVisible();
  });

  test("killing the tab mid-draw leaves no half-committed winner", async ({
    page,
  }) => {
    await seedEvent(page, {
      participants: 50,
      prizes: [{ name: "Prize", quantity: 10 }],
      spinDurationMs: 3000,
    });
    await page.goto("/stage");
    await expect(page.getByRole("heading", { name: "Prize" })).toBeVisible();

    await page.evaluate(() => {
      const bc = new BroadcastChannel("lucky-draw-v3");
      bc.postMessage({ kind: "cmd:draw", prizeId: "z0", count: 5 });
      bc.close();
    });
    // Interrupt while the very first reel is still spinning.
    await page.waitForTimeout(900);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Prize" })).toBeVisible();

    const winners = await drawnWinnerIds(page);
    // Commit happens before the spin, so exactly one winner is recorded and
    // it is a whole record, not a partial one.
    expect(winners.length).toBe(1);
    expect(new Set(winners).size).toBe(winners.length);
  });

  test("the draw runs with the network cut off", async ({ page, context }) => {
    await seedEvent(page, {
      participants: 40,
      prizes: [{ name: "Prize", quantity: 5 }],
      spinDurationMs: 200,
    });
    await page.goto("/stage");
    await expect(page.getByRole("heading", { name: "Prize" })).toBeVisible();

    await context.setOffline(true);

    await page.evaluate(() => {
      const bc = new BroadcastChannel("lucky-draw-v3");
      bc.postMessage({ kind: "cmd:draw", prizeId: "z0", count: 2 });
      bc.close();
    });
    await page.waitForTimeout(2 * 900 + 1500);

    expect((await drawnWinnerIds(page)).length).toBe(2);
    await context.setOffline(false);
  });
});

test.describe("control window", () => {
  test("drives the stage and mirrors it back", async ({ context, page }) => {
    await seedEvent(page, {
      participants: 80,
      prizes: [{ name: "Grand Prize", quantity: 4 }],
      spinDurationMs: 300,
    });

    await page.goto("/stage");
    await expect(
      page.getByRole("heading", { name: "Grand Prize" }),
    ).toBeVisible();

    const control = await context.newPage();
    await control.goto("/control");

    // Assert on behaviour, not on copy: the control window only enables Draw
    // once the stage has answered its snapshot request.
    const drawButton = control.getByRole("button", { name: "Draw", exact: true });
    await expect(drawButton).toBeEnabled({ timeout: 15_000 });
    await expect(control.getByText("No stage window")).toHaveCount(0);

    await drawButton.click();

    // The projector announces a winner. There are two status regions on the
    // stage (the visible reveal and the screen-reader one), so scope to the
    // one that carries the announcement text.
    await expect(
      page.locator('[role="status"]', { hasText: /Guest \d{4}/ }).first(),
    ).toBeVisible({ timeout: 15_000 });

    // ...and the control window mirrors whoever is on screen.
    await expect(control.getByText(/Guest \d{4}/).first()).toBeVisible({
      timeout: 15_000,
    });

    expect((await drawnWinnerIds(page)).length).toBe(1);
    await control.close();
  });

  async function openLinkedControl(
    context: import("@playwright/test").BrowserContext,
    page: import("@playwright/test").Page,
  ) {
    await seedEvent(page, {
      participants: 80,
      prizes: [{ name: "Grand Prize", quantity: 4 }],
      spinDurationMs: 300,
      revealHoldMs: 100,
    });
    await page.goto("/stage");
    await expect(page.getByRole("heading", { name: "Grand Prize" })).toBeVisible();
    const control = await context.newPage();
    await control.goto("/control");
    const drawButton = control.getByRole("button", { name: "Draw", exact: true });
    await expect(drawButton).toBeEnabled({ timeout: 15_000 });
    return { control, drawButton };
  }

  test("space draws once, even when held down", async ({ context, page }) => {
    const { control } = await openLinkedControl(context, page);

    // Auto-repeat arrives as repeated keydowns with `repeat: true`.
    await control.keyboard.down(" ");
    await control.keyboard.down(" ");
    await control.keyboard.down(" ");
    await control.keyboard.up(" ");

    await expect
      .poll(async () => (await drawnWinnerIds(page)).length, { timeout: 15_000 })
      .toBe(1);
    await page.waitForTimeout(1500);
    expect((await drawnWinnerIds(page)).length).toBe(1);
    await control.close();
  });

  test("undo needs a second press", async ({ context, page }) => {
    const { control, drawButton } = await openLinkedControl(context, page);
    await drawButton.click();
    await expect
      .poll(async () => (await drawnWinnerIds(page)).length, { timeout: 15_000 })
      .toBe(1);

    const undo = control.getByRole("button", { name: "Undo last" });
    await expect(undo).toBeEnabled({ timeout: 15_000 });
    await undo.click();
    await page.waitForTimeout(500);
    expect((await drawnWinnerIds(page)).length).toBe(1);

    await control.getByRole("button", { name: "Confirm undo" }).click();
    await expect
      .poll(async () => (await drawnWinnerIds(page)).length, { timeout: 10_000 })
      .toBe(0);
    await control.close();
  });

  test("toggles the stage sound", async ({ context, page }) => {
    const { control } = await openLinkedControl(context, page);
    // The seed starts muted.
    await control.getByRole("button", { name: "Unmute stage sound" }).click();
    await expect(
      control.getByRole("button", { name: "Mute stage sound" }),
    ).toBeVisible({ timeout: 10_000 });

    const log = await readLog(page);
    expect(
      log.some(
        (e) =>
          e.event.type === "SETTINGS_PATCHED" &&
          (e.event as { patch?: { soundEnabled?: boolean } }).patch
            ?.soundEnabled === true,
      ),
    ).toBe(true);
    await control.close();
  });

  test("never shows a winner before the drum lands", async ({
    context,
    page,
  }) => {
    const nameOf = (id: string) => `Guest ${id.slice(1).padStart(4, "0")}`;
    await seedEvent(page, {
      participants: 50,
      prizes: [{ name: "Grand Prize", quantity: 3 }],
      spinDurationMs: 3000,
      revealHoldMs: 300,
    });
    await page.goto("/stage");
    await expect(page.getByRole("heading", { name: "Grand Prize" })).toBeVisible();
    const control = await context.newPage();
    await control.goto("/control");
    const drawButton = control.getByRole("button", { name: "Draw", exact: true });
    await expect(drawButton).toBeEnabled({ timeout: 15_000 });

    await drawButton.click();
    await page.waitForTimeout(1200);

    // Committed, but the drum is still turning.
    const committed = await drawnWinnerIds(page);
    expect(committed).toHaveLength(1);
    const winners = control.getByRole("region", { name: "Winners" });
    await expect(winners).not.toContainText(nameOf(committed[0]));
    await expect(winners).toContainText("0 of 3");

    // Once it lands, the remote catches up.
    await expect(winners).toContainText(nameOf(committed[0]), { timeout: 15_000 });
    await expect(winners).toContainText("1 of 3");
    await control.close();
  });

  test("sets the spin length to any typed value", async ({ context, page }) => {
    const { control } = await openLinkedControl(context, page);
    const spin = control.getByLabel("Spin in seconds");
    await spin.fill("27.5");
    await spin.press("Enter");

    await expect
      .poll(async () =>
        (await readLog(page)).some(
          (e) =>
            e.event.type === "SETTINGS_PATCHED" &&
            (e.event as { patch?: { spinDurationMs?: number } }).patch
              ?.spinDurationMs === 27500,
        ),
      { timeout: 10_000 })
      .toBe(true);
    await expect(spin).toHaveValue("27.5");
    await control.close();
  });

  test("notices when the stage goes away", async ({ context, page }) => {
    const { control, drawButton } = await openLinkedControl(context, page);
    await page.close();

    await expect(control.getByText("Stage lost")).toBeVisible({ timeout: 10_000 });
    await expect(drawButton).toBeDisabled();
    await control.close();
  });
});

test.describe("the reel", () => {
  test("every eligible name goes past on a single spin", async ({ page }) => {
    await seedEvent(page, {
      participants: 60,
      prizes: [{ name: "Prize", quantity: 5 }],
      spinDurationMs: 2500,
    });
    await page.goto("/stage");
    await expect(page.getByRole("heading", { name: "Prize" })).toBeVisible();

    // Record every label the drum shows, frame by frame, for one spin.
    const seen = await page.evaluate(async () => {
      const names = new Set<string>();
      const bc = new BroadcastChannel("lucky-draw-v3");
      bc.postMessage({ kind: "cmd:draw", prizeId: "z0", count: 1 });
      bc.close();
      const until = performance.now() + 4000;
      while (performance.now() < until) {
        document
          .querySelectorAll(".reel-track span")
          .forEach((el) => el.textContent && names.add(el.textContent));
        await new Promise((r) => requestAnimationFrame(r));
      }
      return [...names];
    });

    const everyone = Array.from(
      { length: 60 },
      (_, i) => `Guest ${String(i).padStart(4, "0")}`,
    );
    const missing = everyone.filter((n) => !seen.includes(n));
    expect(missing).toEqual([]);

    // And the DOM stays flat: a window of rows, not one per participant.
    expect(await page.locator(".reel-track > div").count()).toBeLessThan(10);
  });
});

test.describe("scale", () => {
  test("500 participants do not inflate the DOM", async ({ page }) => {
    await seedEvent(page, {
      participants: 500,
      prizes: [{ name: "Prize", quantity: 30 }],
      spinDurationMs: 300,
    });
    await page.goto("/stage");
    await expect(page.getByRole("heading", { name: "Prize" })).toBeVisible();

    await page.evaluate(() => {
      const bc = new BroadcastChannel("lucky-draw-v3");
      bc.postMessage({ kind: "cmd:draw", prizeId: "z0", count: 10 });
      bc.close();
    });
    await page.waitForTimeout(6000);
    await page.keyboard.press("s");

    const nodes = await page.evaluate(
      () => document.getElementsByTagName("*").length,
    );
    // v2 rendered every participant; this must stay flat.
    expect(nodes).toBeLessThan(800);
  });
});

test.describe("photo session", () => {
  test("shows every winner of a prize at once, driven from control", async ({
    context,
    page,
  }) => {
    await seedEvent(page, {
      participants: 60,
      prizes: [
        { name: "Grand Prize", quantity: 3 },
        { name: "Runner Up", quantity: 2 },
      ],
      spinDurationMs: 50,
      revealHoldMs: 50,
    });
    await page.goto("/stage");
    await expect(
      page.getByRole("heading", { name: "Grand Prize" }),
    ).toBeVisible();

    // Draw all three of the first prize.
    await page.evaluate(() => {
      const bc = new BroadcastChannel("lucky-draw-v3");
      bc.postMessage({ kind: "cmd:draw", prizeId: "z0", count: 3 });
      bc.close();
    });
    await expect
      .poll(async () => (await drawnWinnerIds(page)).length, {
        timeout: 20_000,
      })
      .toBe(3);

    const winners = await drawnWinnerIds(page);

    const control = await context.newPage();
    await control.goto("/control");

    // Grand Prize is exhausted, so the running order has already moved on.
    // Pick it explicitly, the way an operator would before a photo session.
    await control
      .getByRole("button", { name: /Grand Prize/ })
      .first()
      .click();

    const photoPanel = control.getByRole("region", { name: "Photo session" });
    const photoButton = photoPanel.getByRole("button", {
      name: /Grand Prize \(3\)/,
    });
    await expect(photoButton).toBeEnabled({ timeout: 15_000 });
    await photoButton.click();

    // The board replaces the reel and lists all three, numbered.
    const board = page.getByRole("region", { name: /Grand Prize/ });
    await expect(board).toBeVisible({ timeout: 10_000 });
    await expect(board.getByText("3 winners")).toBeVisible();
    await expect(board.getByRole("listitem")).toHaveCount(3);
    // Names only — the prize is in the heading, not repeated on every row.
    await expect(board.getByText("Grand Prize")).toHaveCount(1);

    for (const id of winners) {
      const name = `Guest ${id.replace("p", "").padStart(4, "0")}`;
      await expect(board.getByText(name, { exact: true })).toBeVisible();
    }

    // Control reports the board is up, and can take it back down.
    await expect(photoPanel.getByText("On screen")).toBeVisible({
      timeout: 10_000,
    });
    await photoPanel
      .getByRole("button", { name: "Back to the draw" })
      .click();
    await expect(board).toBeHidden({ timeout: 10_000 });

    await control.close();
  });

  test("a photo call never interrupts a running draw", async ({ page }) => {
    await seedEvent(page, {
      participants: 60,
      prizes: [{ name: "Prize", quantity: 10 }],
      spinDurationMs: 800,
      revealHoldMs: 400,
    });
    await page.goto("/stage");
    await expect(page.getByRole("heading", { name: "Prize" })).toBeVisible();

    await page.evaluate(() => {
      const bc = new BroadcastChannel("lucky-draw-v3");
      bc.postMessage({ kind: "cmd:draw", prizeId: "z0", count: 5 });
      // A photo call requested mid-spin must be ignored, not swap the screen
      // out from under a winner who is being revealed.
      bc.postMessage({ kind: "cmd:showRoster", scope: "z0" });
      bc.close();
    });

    await page.waitForTimeout(1200);
    await expect(page.getByRole("region", { name: /Prize/ })).toHaveCount(0);

    await page.keyboard.press("s");
  });
});

test("a long photo-call list scrolls itself", async ({ page }) => {
  await seedEvent(page, {
    participants: 200,
    prizes: [{ name: "Consolation", quantity: 120 }],
    spinDurationMs: 10,
    revealHoldMs: 10,
  });
  await page.goto("/stage");
  await expect(page.getByRole("heading", { name: "Consolation" })).toBeVisible();

  await page.evaluate(() => {
    const bc = new BroadcastChannel("lucky-draw-v3");
    bc.postMessage({ kind: "cmd:draw", prizeId: "z0", count: 120 });
    bc.close();
  });
  await expect
    .poll(async () => (await drawnWinnerIds(page)).length, { timeout: 60_000 })
    .toBe(120);

  await page.evaluate(() => {
    const bc = new BroadcastChannel("lucky-draw-v3");
    bc.postMessage({ kind: "cmd:showRoster", scope: "z0" });
    bc.close();
  });

  const list = page.getByRole("region", { name: /Consolation/ }).getByRole("list");
  await expect(list).toBeVisible({ timeout: 10_000 });

  // 120 names cannot fit one screen at this size, so the board must overflow
  // and then move on its own rather than clipping the tail.
  const overflow = await list.evaluate(
    (el) => el.scrollHeight - el.clientHeight,
  );
  expect(overflow).toBeGreaterThan(0);

  const before = await list.evaluate((el) => el.scrollTop);
  await page.waitForTimeout(5000);
  const after = await list.evaluate((el) => el.scrollTop);
  expect(after).toBeGreaterThan(before);
});
