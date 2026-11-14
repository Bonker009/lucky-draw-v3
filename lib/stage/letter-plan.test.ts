import { describe, expect, it } from "vitest";
import { graphemes, planLetters, type LetterEntry } from "./letter-plan";

const GIVEN = ["Sokha", "Sophea", "Sokunthea", "Sothea", "Dara", "Malis", "Visal", "Rithy", "Seyha", "Bopha"];
const FAMILY = ["Chan", "Rin", "Kim", "Ly", "Meas", "Sok", "Tep"];
const pool: LetterEntry[] = [];
for (let i = 0; i < 236; i++) {
  pool.push({ id: `p${i}`, name: `${GIVEN[i % GIVEN.length]} ${FAMILY[Math.floor(i / GIVEN.length) % FAMILY.length]}` });
}

describe("planLetters", () => {
  it("locks only the winner's own letters", () => {
    const winner = pool.find((p) => p.name === "Sokunthea Rin")!;
    const plan = planLetters(pool, winner.id);
    expect(plan.letters.join("")).toBe(graphemes(winner.name).slice(0, plan.letters.length).join(""));
  });

  it("reports true counts for every prefix", () => {
    const winner = pool[42];
    const plan = planLetters(pool, winner.id);
    expect(plan.counts[0]).toBe(pool.length);
    plan.letters.forEach((_, i) => {
      const prefix = plan.letters.slice(0, i + 1).join("").toUpperCase();
      const actual = pool.filter((p) => p.name.toUpperCase().startsWith(prefix)).length;
      expect(plan.counts[i + 1]).toBe(actual);
    });
    for (let i = 1; i < plan.counts.length; i++) {
      expect(plan.counts[i]).toBeLessThanOrEqual(plan.counts[i - 1]);
    }
  });

  it("always puts the winner among finalists who share the prefix", () => {
    for (const winner of [pool[0], pool[17], pool[235]]) {
      const plan = planLetters(pool, winner.id);
      expect(plan.finalists[plan.winner].id).toBe(winner.id);
      expect(plan.finalists.length).toBeLessThanOrEqual(10);
      const prefix = plan.letters.join("").toUpperCase();
      for (const f of plan.finalists) expect(f.name.toUpperCase().startsWith(prefix)).toBe(true);
    }
  });

  it("skips the letter reels for a pool that is already small", () => {
    const small = pool.slice(0, 8);
    const plan = planLetters(small, small[3].id);
    expect(plan.letters).toEqual([]);
    expect(plan.finalists.map((f) => f.id).sort()).toEqual(small.map((f) => f.id).sort());
  });

  it("treats a Khmer name's first cluster as one letter", () => {
    const khmer: LetterEntry[] = [
      ...pool.slice(0, 30),
      { id: "k1", name: "សុខ ចាន់" },
      { id: "k2", name: "សុខា រិន" },
      { id: "k3", name: "ចាន់ ធីតា" },
    ];
    const plan = planLetters(khmer, "k1");
    expect(plan.letters[0]).toBe(graphemes("សុខ ចាន់")[0]);
    expect(plan.finalists.some((f) => f.id === "k1")).toBe(true);
  });

  it("is deterministic for the same winner", () => {
    const a = planLetters(pool, "p9");
    const b = planLetters(pool, "p9");
    expect(a.finalists.map((f) => f.id)).toEqual(b.finalists.map((f) => f.id));
  });

  it("rejects a winner outside the pool", () => {
    expect(() => planLetters(pool, "nobody")).toThrow();
  });
});
