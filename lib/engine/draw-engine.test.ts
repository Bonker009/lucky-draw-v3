import { describe, expect, it, vi } from "vitest";
import {
  DrawEngine,
  spinDuration,
  type RunOptions,
  type RunRequest,
} from "./draw-engine";

function request(count: number): RunRequest {
  return { prizeId: "z0", count };
}

/** Stands in for the store: hands back a winner id and records the call. */
function committer(sink?: string[]) {
  return async (index: number) => {
    const id = `p${index}`;
    sink?.push(id);
    return id;
  };
}

function options(over: Partial<RunOptions> = {}): RunOptions {
  return {
    spinDurationMs: 30,
    suspenseScaling: false,
    revealHoldMs: 20,
    onCommit: committer(),
    ...over,
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("DrawEngine cancellation", () => {
  it("stops a long batch promptly instead of running to completion", async () => {
    const engine = new DrawEngine();
    const committed: string[] = [];

    const started = Date.now();
    const run = engine.run(
      request(20),
      options({ spinDurationMs: 50, onCommit: committer(committed) }),
    );

    await new Promise((r) => setTimeout(r, 120));
    engine.stop();
    await run;

    const elapsed = Date.now() - started;
    // v2's Stop was wired through a stale closure and did nothing; a
    // 20-winner batch here would take many seconds.
    expect(elapsed).toBeLessThan(600);
    expect(committed.length).toBeLessThan(20);
    expect(engine.getSnapshot().phase).toBe("stopped");
  });

  it("leaves no pending timers after a stop", async () => {
    const engine = new DrawEngine();
    const run = engine.run(request(10), options({ spinDurationMs: 500 }));
    await tick();
    expect(engine.pendingTimerCount).toBeGreaterThan(0);
    engine.stop();
    await run;
    expect(engine.pendingTimerCount).toBe(0);
    expect(engine.isRunning).toBe(false);
  });

  it("keeps winners that were already committed when stopped", async () => {
    const engine = new DrawEngine();
    const committed: string[] = [];
    const run = engine.run(
      request(8),
      options({ spinDurationMs: 40, onCommit: committer(committed) }),
    );
    await new Promise((r) => setTimeout(r, 100));
    engine.stop();
    await run;
    expect(committed.length).toBeGreaterThan(0);
    expect(engine.getSnapshot().batch.length).toBeLessThanOrEqual(
      committed.length,
    );
  });

  it("can stop before the very first commit resolves", async () => {
    const engine = new DrawEngine();
    let commits = 0;
    const run = engine.run(
      request(5),
      options({
        onCommit: async (i) => {
          commits++;
          await new Promise((r) => setTimeout(r, 50));
          return `p${i}`;
        },
      }),
    );
    engine.stop();
    await run;
    expect(commits).toBe(1);
    expect(engine.getSnapshot().phase).toBe("stopped");
  });
});

describe("DrawEngine re-entry", () => {
  it("ignores a second run while one is in flight", async () => {
    const engine = new DrawEngine();
    const committed: string[] = [];
    const opts = () =>
      options({ spinDurationMs: 20, onCommit: committer(committed) });

    // Click, spacebar and a remote command, all in the same tick.
    await Promise.all([
      engine.run(request(3), opts()),
      engine.run(request(3), opts()),
      engine.run(request(3), opts()),
    ]);

    expect(committed).toEqual(["p0", "p1", "p2"]);
  });

  it("runs again cleanly after finishing", async () => {
    const engine = new DrawEngine();
    const done = vi.fn();
    await engine.run(
      request(2),
      options({ spinDurationMs: 10, onBatchComplete: done }),
    );
    expect(done).toHaveBeenCalledTimes(1);
    await engine.run(
      request(2),
      options({ spinDurationMs: 10, onBatchComplete: done }),
    );
    expect(done).toHaveBeenCalledTimes(2);
  });
});

describe("DrawEngine reset", () => {
  it("lands on idle even though the aborted run unwinds afterwards", async () => {
    const engine = new DrawEngine();
    void engine.run(request(10), options({ spinDurationMs: 300 }));
    await tick();

    await engine.reset();

    // The aborted run's own catch runs a microtask later; it must not repaint
    // "stopped" over the reset.
    await new Promise((r) => setTimeout(r, 50));
    expect(engine.getSnapshot().phase).toBe("idle");
    expect(engine.getSnapshot().revealed).toBeNull();
  });

  it("frees the engine so the next draw is not swallowed", async () => {
    const engine = new DrawEngine();
    void engine.run(request(10), options({ spinDurationMs: 300 }));
    await tick();

    await engine.reset();
    expect(engine.isRunning).toBe(false);

    // Undo followed immediately by Draw must actually draw.
    const committed: string[] = [];
    await engine.run(
      request(2),
      options({ spinDurationMs: 10, onCommit: committer(committed) }),
    );
    expect(committed).toEqual(["p0", "p1"]);
  });
});

describe("DrawEngine commit ordering", () => {
  it("commits before revealing, every time", async () => {
    const engine = new DrawEngine();
    const order: string[] = [];
    await engine.run(
      request(3),
      options({
        spinDurationMs: 5,
        onCommit: async (i) => {
          order.push(`commit:p${i}`);
          return `p${i}`;
        },
        onReveal: (id) => {
          order.push(`reveal:${id}`);
        },
      }),
    );
    expect(order).toEqual([
      "commit:p0",
      "reveal:p0",
      "commit:p1",
      "reveal:p1",
      "commit:p2",
      "reveal:p2",
    ]);
  });

  it("never reveals a winner whose commit was rejected", async () => {
    const engine = new DrawEngine();
    const revealed: string[] = [];
    await engine.run(
      request(3),
      options({
        spinDurationMs: 5,
        onCommit: async (i) => {
          if (i === 1) throw new Error("duplicate winner rejected");
          return `p${i}`;
        },
        onReveal: (id) => {
          revealed.push(id);
        },
      }),
    );
    expect(revealed).toEqual(["p0"]);
    expect(engine.getSnapshot().error).toMatch(/duplicate winner rejected/);
  });

  it("ends the batch cleanly when the pool runs dry", async () => {
    const engine = new DrawEngine();
    const revealed: string[] = [];
    await engine.run(
      request(10),
      options({
        spinDurationMs: 5,
        // Only two people left, though ten were requested.
        onCommit: async (i) => (i < 2 ? `p${i}` : null),
        onReveal: (id) => {
          revealed.push(id);
        },
      }),
    );
    expect(revealed).toEqual(["p0", "p1"]);
    expect(engine.getSnapshot().phase).toBe("celebrating");
    expect(engine.getSnapshot().error).toBeNull();
  });
});

describe("spinDuration", () => {
  it("returns the base duration when scaling is off", () => {
    expect(spinDuration(5000, 1, false)).toBe(5000);
    expect(spinDuration(5000, 20, false)).toBe(5000);
  });

  it("stretches only the last four, longest at the finale", () => {
    expect(spinDuration(5000, 20, true)).toBe(5000);
    expect(spinDuration(5000, 4, true)).toBe(6250);
    expect(spinDuration(5000, 1, true)).toBe(11000);
  });

  it("is capped so a slow setting cannot stall the show", () => {
    expect(spinDuration(20000, 1, true)).toBe(15000);
  });
});

describe("DrawEngine batch reveal", () => {
  const batch = { batchReveal: { spotlightMax: 8 } };

  it("commits the whole batch before the single spin, then spotlights in order", async () => {
    const engine = new DrawEngine();
    const order: string[] = [];
    const spins: string[][] = [];
    const unsubscribe = engine.subscribe(() => {
      const s = engine.getSnapshot();
      if (s.phase === "spinning" && s.targets.length && spins.at(-1) !== s.targets) {
        spins.push(s.targets);
      }
    });
    await engine.run(
      request(3),
      options({
        ...batch,
        spinDurationMs: 5,
        onCommit: async (i) => {
          order.push(`commit:p${i}`);
          return `p${i}`;
        },
        onReveal: (id) => {
          order.push(`reveal:${id}`);
        },
      }),
    );
    unsubscribe();
    expect(order).toEqual([
      "commit:p0",
      "commit:p1",
      "commit:p2",
      "reveal:p0",
      "reveal:p1",
      "reveal:p2",
    ]);
    // One spin, towards all three.
    expect(spins).toEqual([["p0", "p1", "p2"]]);
    expect(engine.getSnapshot().phase).toBe("celebrating");
    expect(engine.getSnapshot().batch).toEqual(["p0", "p1", "p2"]);
  });

  it("reveals a batch over the spotlight limit in one step", async () => {
    const engine = new DrawEngine();
    const reveals: string[] = [];
    await engine.run(
      request(12),
      options({
        ...batch,
        spinDurationMs: 5,
        onReveal: (id) => {
          reveals.push(id);
        },
      }),
    );
    expect(reveals).toEqual(["p11"]);
    expect(engine.getSnapshot().batch).toHaveLength(12);
  });

  it("keeps the whole committed batch when stopped mid-spin", async () => {
    const engine = new DrawEngine();
    const committed: string[] = [];
    const revealed: string[] = [];
    const run = engine.run(
      request(3),
      options({
        ...batch,
        spinDurationMs: 400,
        onCommit: committer(committed),
        onReveal: (id) => {
          revealed.push(id);
        },
      }),
    );
    await new Promise((r) => setTimeout(r, 50));
    engine.stop();
    await run;
    expect(committed).toEqual(["p0", "p1", "p2"]);
    expect(revealed).toEqual([]);
    expect(engine.getSnapshot().phase).toBe("stopped");
    expect(engine.pendingTimerCount).toBe(0);
  });

  it("spins once for however many the pool still had", async () => {
    const engine = new DrawEngine();
    const reveals: string[] = [];
    await engine.run(
      request(5),
      options({
        ...batch,
        spinDurationMs: 5,
        onCommit: async (i) => (i < 2 ? `p${i}` : null),
        onReveal: (id) => {
          reveals.push(id);
        },
      }),
    );
    expect(reveals).toEqual(["p0", "p1"]);
  });

  it("runs a one-winner draw the ordinary way", async () => {
    const engine = new DrawEngine();
    const reveals: string[] = [];
    await engine.run(request(1), options({ ...batch, spinDurationMs: 5, onReveal: (id) => { reveals.push(id); } }));
    expect(reveals).toEqual(["p0"]);
  });
});
