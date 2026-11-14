import { describe, expect, it } from "vitest";
import { planWall, roundEnds } from "./wall-plan";

describe("planWall", () => {
  it("never knocks out the committed winner", () => {
    for (const n of [2, 3, 7, 60, 236, 500]) {
      for (const w of [0, Math.floor(n / 2), n - 1]) {
        const plan = planWall(n, w, `p${w}`);
        expect(plan.outRound[w]).toBe(plan.rounds + 1);
      }
    }
  });

  it("leaves ceil(alive / 2) standing after every round", () => {
    const n = 236;
    const plan = planWall(n, 117, "seed");
    expect(plan.aliveAfter).toEqual([236, 118, 59, 30, 15, 8, 4, 2, 1]);
    for (let r = 1; r <= plan.rounds; r++) {
      const standing = Array.from(plan.outRound).filter((o) => o > r).length;
      expect(standing).toBe(plan.aliveAfter[r]);
    }
  });

  it("knocks every other name out exactly once", () => {
    const n = 61;
    const plan = planWall(n, 5, "x");
    for (let i = 0; i < n; i++) {
      if (i === 5) continue;
      expect(plan.outRound[i]).toBeGreaterThanOrEqual(1);
      expect(plan.outRound[i]).toBeLessThanOrEqual(plan.rounds);
    }
  });

  it("is deterministic for the same pool and winner", () => {
    const a = planWall(100, 42, "winner-42");
    const b = planWall(100, 42, "winner-42");
    expect(Array.from(a.outRound)).toEqual(Array.from(b.outRound));
    const c = planWall(100, 42, "winner-43");
    expect(Array.from(c.outRound)).not.toEqual(Array.from(a.outRound));
  });

  it("handles a pool of one with no rounds", () => {
    const plan = planWall(1, 0, "solo");
    expect(plan.rounds).toBe(0);
    expect(plan.aliveAfter).toEqual([1]);
  });

  it("rejects a winner outside the pool", () => {
    expect(() => planWall(10, 10, "x")).toThrow();
    expect(() => planWall(0, 0, "x")).toThrow();
  });
});

describe("roundEnds", () => {
  it("ends at 1 and gives the final rounds the most time", () => {
    const ends = roundEnds(8);
    expect(ends.at(-1)).toBeCloseTo(1);
    const spans = ends.map((e, i) => e - (ends[i - 1] ?? 0));
    expect(spans.at(-1)!).toBeGreaterThan(spans.at(-2)!);
    expect(spans.at(-2)!).toBeGreaterThan(spans[0]);
  });
});
