import { describe, expect, it } from "vitest";
import { computeDraw, verifyLog } from "./draw";
import { applyEvent, assertBatchValid, fold } from "./events";
import { Rng } from "./rng";
import { eligibleParticipants, remainingFor } from "./selectors";
import type { DrawEvent, DrawState, StoredEvent } from "./types";

function makeState(participantCount: number, prizes: [string, number][]) {
  const events: StoredEvent[] = [
    {
      seq: 0,
      at: 0,
      event: {
        type: "PARTICIPANTS_SET",
        participants: Array.from({ length: participantCount }, (_, i) => ({
          id: `p${i}`,
          name: `Participant ${i}`,
        })),
      },
    },
    {
      seq: 1,
      at: 0,
      event: { type: "SETTINGS_PATCHED", patch: { seed: "test-seed-0001" } },
    },
    ...prizes.map(([name, quantity], i) => ({
      seq: 2 + i,
      at: 0,
      event: {
        type: "PRIZE_UPSERTED" as const,
        prize: { id: `z${i}`, name, quantity },
      },
    })),
  ];
  return { state: fold(events), log: events };
}

/** Commit a plan the way the store does, so tests exercise the real path. */
function commit(state: DrawState, log: StoredEvent[], events: DrawEvent[]) {
  assertBatchValid(state, events);
  const baseSeq = log[log.length - 1].seq + 1;
  const stored = events.map((event, i) => ({
    seq: baseSeq + i,
    at: 1_700_000_000_000 + baseSeq + i,
    event,
  }));
  return {
    state: stored.reduce(applyEvent, state),
    log: [...log, ...stored],
  };
}

describe("computeDraw", () => {
  it("never picks the same participant twice across a whole event", () => {
    let { state, log } = makeState(500, [
      ["Grand", 3],
      ["Second", 12],
      ["Third", 40],
      ["Consolation", 120],
    ]);

    const seen = new Set<string>();
    let guard = 0;

    while (guard++ < 1000) {
      const prize = state.prizes.find((p) => remainingFor(state, p.id) > 0);
      if (!prize) break;
      const plan = computeDraw(state, prize.id, 7);
      for (const id of plan.winners) {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
      ({ state, log } = commit(state, log, plan.events));
    }

    expect(state.winners.length).toBe(175);
    expect(new Set(state.winners.map((w) => w.participantId)).size).toBe(175);
  });

  it("never awards more than a prize's quantity", () => {
    let { state, log } = makeState(100, [["Only", 5]]);
    // Ask for far more than exist; the plan must clamp.
    const plan = computeDraw(state, "z0", 50);
    expect(plan.winners).toHaveLength(5);
    ({ state, log } = commit(state, log, plan.events));
    expect(remainingFor(state, "z0")).toBe(0);
    expect(() => computeDraw(state, "z0", 1)).toThrow(/fully awarded/);
  });

  it("clamps to the eligible pool when people run out", () => {
    const { state } = makeState(3, [["Big", 10]]);
    const plan = computeDraw(state, "z0", 10);
    expect(plan.winners).toHaveLength(3);
  });

  it("refuses to draw when everybody has already won", () => {
    let { state, log } = makeState(2, [
      ["A", 2],
      ["B", 2],
    ]);
    ({ state, log } = commit(state, log, computeDraw(state, "z0", 2).events));
    expect(() => computeDraw(state, "z1", 1)).toThrow(/already won/);
  });

  it("is deterministic: the same state and nonce give the same winners", () => {
    const a = makeState(300, [["P", 10]]);
    const b = makeState(300, [["P", 10]]);
    expect(computeDraw(a.state, "z0", 10).winners).toEqual(
      computeDraw(b.state, "z0", 10).winners,
    );
  });

  it("keeps the folded state equal to a fresh fold of the log", () => {
    let { state, log } = makeState(200, [["P", 25]]);
    for (let i = 0; i < 5; i++) {
      ({ state, log } = commit(state, log, computeDraw(state, "z0", 5).events));
    }
    const refolded = fold(log);
    expect(refolded.winners).toEqual(state.winners);
    expect(refolded.drawCount).toBe(state.drawCount);
    expect([...refolded.awardedByPrize]).toEqual([...state.awardedByPrize]);
  });
});

describe("assertBatchValid", () => {
  it("rejects a batch containing the same winner twice", () => {
    const { state } = makeState(10, [["P", 5]]);
    const bad: DrawEvent[] = [
      { type: "WINNER_DRAWN", prizeId: "z0", participantId: "p1", nonce: 0 },
      { type: "WINNER_DRAWN", prizeId: "z0", participantId: "p1", nonce: 1 },
    ];
    expect(() => assertBatchValid(state, bad)).toThrow(/already won/);
  });

  it("rejects a batch that would exceed the prize quantity", () => {
    const { state } = makeState(10, [["P", 1]]);
    const bad: DrawEvent[] = [
      { type: "WINNER_DRAWN", prizeId: "z0", participantId: "p1", nonce: 0 },
      { type: "WINNER_DRAWN", prizeId: "z0", participantId: "p2", nonce: 1 },
    ];
    expect(() => assertBatchValid(state, bad)).toThrow(/only has 1/);
  });

  it("rejects an unknown participant", () => {
    const { state } = makeState(3, [["P", 5]]);
    expect(() =>
      assertBatchValid(state, [
        {
          type: "WINNER_DRAWN",
          prizeId: "z0",
          participantId: "ghost",
          nonce: 0,
        },
      ]),
    ).toThrow(/Unknown participant/);
  });

  it("refuses to shrink a prize below what it has already awarded", () => {
    let { state, log } = makeState(10, [["P", 5]]);
    ({ state, log } = commit(state, log, computeDraw(state, "z0", 3).events));
    expect(() =>
      assertBatchValid(state, [
        { type: "PRIZE_UPSERTED", prize: { id: "z0", name: "P", quantity: 2 } },
      ]),
    ).toThrow(/already awarded/);
  });

  it("refuses to delete a participant who has won", () => {
    let { state, log } = makeState(10, [["P", 5]]);
    ({ state, log } = commit(state, log, computeDraw(state, "z0", 1).events));
    const winnerId = state.winners[0].participantId;
    expect(() =>
      assertBatchValid(state, [
        { type: "PARTICIPANT_REMOVED", participantId: winnerId },
      ]),
    ).toThrow(/already won/);
  });

  it("refuses a roster replacement that would erase a winner", () => {
    let { state, log } = makeState(10, [["P", 5]]);
    ({ state, log } = commit(state, log, computeDraw(state, "z0", 1).events));
    expect(() =>
      assertBatchValid(state, [
        {
          type: "PARTICIPANTS_SET",
          participants: [{ id: "someone-else", name: "New" }],
        },
      ]),
    ).toThrow(/already won/);
  });
});

describe("revoke", () => {
  it("restores eligibility but does not reuse the nonce", () => {
    let { state, log } = makeState(50, [["P", 5]]);
    ({ state, log } = commit(state, log, computeDraw(state, "z0", 1).events));
    const first = state.winners[0].participantId;
    const drawCountAfterWin = state.drawCount;

    ({ state, log } = commit(state, log, [
      { type: "WINNER_REVOKED", prizeId: "z0", participantId: first },
    ]));

    expect(state.winners).toHaveLength(0);
    expect(remainingFor(state, "z0")).toBe(5);
    expect(eligibleParticipants(state).some((p) => p.id === first)).toBe(true);
    // The nonce counter must not rewind, or the re-draw reproduces the pick.
    expect(state.drawCount).toBe(drawCountAfterWin);
  });
});

describe("verifyLog", () => {
  it("accepts a log produced by the real draw path", () => {
    let { state, log } = makeState(400, [
      ["Grand", 2],
      ["Second", 8],
    ]);
    for (const prizeId of ["z0", "z1"]) {
      const plan = computeDraw(state, prizeId, 20);
      ({ state, log } = commit(state, log, plan.events));
    }
    const result = verifyLog(log);
    expect(result.ok).toBe(true);
    expect(result.checked).toBe(10);
  });

  it("catches a tampered winner", () => {
    let { state, log } = makeState(100, [["P", 4]]);
    ({ state, log } = commit(state, log, computeDraw(state, "z0", 4).events));

    const tampered = log.map((entry) =>
      entry.event.type === "WINNER_DRAWN" && entry.seq === log[3].seq
        ? {
            ...entry,
            event: { ...entry.event, participantId: "p99" },
          }
        : entry,
    );

    const result = verifyLog(tampered as StoredEvent[]);
    expect(result.ok).toBe(false);
    expect(result.firstMismatch?.recorded).toBe("p99");
  });
});

describe("Rng", () => {
  it("stays within bounds", () => {
    const rng = new Rng("bounds", 0);
    for (let i = 0; i < 10_000; i++) {
      const v = rng.nextBelow(7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
    }
  });

  it("is uniform enough for a draw", () => {
    const buckets = new Array(10).fill(0);
    const rng = new Rng("uniform", 42);
    const n = 200_000;
    for (let i = 0; i < n; i++) buckets[rng.nextBelow(10)]++;
    const expected = n / 10;
    for (const count of buckets) {
      expect(Math.abs(count - expected) / expected).toBeLessThan(0.05);
    }
  });

  it("gives different streams for different nonces", () => {
    const a = new Rng("same-seed", 0);
    const b = new Rng("same-seed", 1);
    const left = Array.from({ length: 20 }, () => a.nextBelow(1000));
    const right = Array.from({ length: 20 }, () => b.nextBelow(1000));
    expect(left).not.toEqual(right);
  });

  it("reproduces the same stream for the same seed and nonce", () => {
    const a = new Rng("repeat", 9);
    const b = new Rng("repeat", 9);
    expect(Array.from({ length: 50 }, () => a.next())).toEqual(
      Array.from({ length: 50 }, () => b.next()),
    );
  });
});

describe("state invariants under a long random event stream", () => {
  it("holds over 10000 draws", () => {
    let { state, log } = makeState(4000, [
      ["A", 1000],
      ["B", 2000],
      ["C", 7000],
    ]);

    const rng = new Rng("fuzz", 1);
    let drawn = 0;
    let guard = 0;

    while (guard++ < 5000) {
      const open = state.prizes.filter((p) => remainingFor(state, p.id) > 0);
      if (open.length === 0) break;
      if (eligibleParticipants(state).length === 0) break;
      const prize = open[rng.nextBelow(open.length)];
      const plan = computeDraw(state, prize.id, 1 + rng.nextBelow(5));
      ({ state, log } = commit(state, log, plan.events));
      drawn += plan.winners.length;

      expect(state.winners.length).toBe(drawn);
      expect(new Set(state.winners.map((w) => w.participantId)).size).toBe(
        drawn,
      );
      for (const p of state.prizes) {
        expect(remainingFor(state, p.id)).toBeGreaterThanOrEqual(0);
      }
    }

    // 4000 people, 10000 slots: the roster is the binding constraint.
    expect(drawn).toBe(4000);
    expect(fold(log).winners.length).toBe(drawn);
  });
});

describe("prize deletion cannot launder away winners", () => {
  it("refuses to delete a prize that has winners", () => {
    let { state, log } = makeState(20, [["P", 5]]);
    ({ state, log } = commit(state, log, computeDraw(state, "z0", 2).events));
    expect(() =>
      assertBatchValid(state, [{ type: "PRIZE_REMOVED", prizeId: "z0" }]),
    ).toThrow(/already has winners/);
  });

  it("allows deletion once the winners are revoked", () => {
    let { state, log } = makeState(20, [["P", 5]]);
    ({ state, log } = commit(state, log, computeDraw(state, "z0", 2).events));
    const revokes = state.winners.map((w) => ({
      type: "WINNER_REVOKED" as const,
      prizeId: w.prizeId,
      participantId: w.participantId,
    }));
    expect(() =>
      assertBatchValid(state, [
        ...revokes,
        { type: "PRIZE_REMOVED", prizeId: "z0" },
      ]),
    ).not.toThrow();
  });

  it("would otherwise have made a winner eligible again", () => {
    // Guards the reason the rule exists, not just the rule.
    let { state, log } = makeState(20, [
      ["A", 5],
      ["B", 5],
    ]);
    ({ state, log } = commit(state, log, computeDraw(state, "z0", 2).events));
    const winner = state.winners[0].participantId;
    // Deliberately bypass the validator: applyEvent still drops the winners,
    // which is precisely why the guard above must stop the batch from ever
    // reaching it.
    const unguarded = applyEvent(state, {
      seq: 9999,
      at: 0,
      event: { type: "PRIZE_REMOVED", prizeId: "z0" },
    });
    expect(eligibleParticipants(unguarded).some((p) => p.id === winner)).toBe(
      true,
    );
  });
});

describe("verifyLog survives real-world event edits", () => {
  it("verifies a log containing a revoke and a re-draw", () => {
    let { state, log } = makeState(80, [["P", 6]]);
    ({ state, log } = commit(state, log, computeDraw(state, "z0", 3).events));

    const victim = state.winners[1].participantId;
    ({ state, log } = commit(state, log, [
      { type: "WINNER_REVOKED", prizeId: "z0", participantId: victim },
    ]));
    ({ state, log } = commit(state, log, computeDraw(state, "z0", 2).events));

    const result = verifyLog(log);
    expect(result.ok).toBe(true);
    expect(result.checked).toBe(5);
  });

  it("verifies a log containing a reset", () => {
    let { state, log } = makeState(60, [["P", 4]]);
    ({ state, log } = commit(state, log, computeDraw(state, "z0", 4).events));
    ({ state, log } = commit(state, log, [{ type: "EVENT_RESET" }]));
    ({ state, log } = commit(state, log, computeDraw(state, "z0", 4).events));
    expect(verifyLog(log).ok).toBe(true);
  });

  it("verifies a log where the roster grew mid-event", () => {
    // The draw plans one winner at a time against current state, so a
    // participant added between draws must not break the replay.
    let { state, log } = makeState(30, [["P", 6]]);
    ({ state, log } = commit(state, log, computeDraw(state, "z0", 2).events));
    ({ state, log } = commit(state, log, [
      {
        type: "PARTICIPANT_ADDED",
        participant: { id: "late-arrival", name: "Late Arrival" },
      },
    ]));
    ({ state, log } = commit(state, log, computeDraw(state, "z0", 2).events));
    ({ state, log } = commit(state, log, computeDraw(state, "z0", 2).events));

    const result = verifyLog(log);
    expect(result.ok).toBe(true);
    expect(result.checked).toBe(6);
  });

  it("catches a batch planned against stale state", () => {
    // Planning several winners up front and committing them across a roster
    // change is exactly what the one-at-a-time draw avoids; prove a log built
    // that way is detectable rather than silently wrong.
    let { state, log } = makeState(20, [["P", 5]]);
    const stalePlan = computeDraw(state, "z0", 3);

    ({ state, log } = commit(state, log, [
      {
        type: "PARTICIPANT_ADDED",
        participant: { id: "aaa-first-in-roster", name: "Inserted" },
      },
    ]));
    ({ state, log } = commit(state, log, stalePlan.events));

    expect(verifyLog(log).ok).toBe(false);
  });
});
