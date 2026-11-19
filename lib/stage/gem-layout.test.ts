import { describe, expect, it } from "vitest";
import { GEM_KINDS, KEEP_OUT, REF_H, REF_W, WALL_KEEP_OUT, inKeepOut, layoutGems } from "./gem-layout";

const SEEDS = ["stage", "photo", "a", "b", "c", "lucky", "draw", "2026"];

describe("layoutGems", () => {
  it("is deterministic per seed, and differs between seeds", () => {
    expect(layoutGems("stage")).toEqual(layoutGems("stage"));
    expect(layoutGems("stage").gems).not.toEqual(layoutGems("photo").gems);
  });

  it("never centres a gem or a sparkle over the names", () => {
    for (const seed of SEEDS) {
      const { gems, sparks } = layoutGems(seed);
      for (const g of gems) expect(inKeepOut(g.x + g.size / 2, g.y + g.size / 2)).toBe(false);
      for (const s of sparks) expect(inKeepOut(s.x, s.y)).toBe(false);
    }
    for (const r of KEEP_OUT) expect(r.x0).toBeLessThan(r.x1);
  });

  it("honours a custom keep-out, placing fewer gems rather than covering names", () => {
    for (const seed of SEEDS) {
      const { gems, sparks } = layoutGems(seed, WALL_KEEP_OUT, undefined, true);
      expect(gems.length).toBeGreaterThan(0);
      for (const g of gems) expect(inKeepOut(g.x + g.size / 2, g.y + g.size / 2, WALL_KEEP_OUT)).toBe(false);
      for (const s of sparks) expect(inKeepOut(s.x, s.y, WALL_KEEP_OUT)).toBe(false);
    }
  });

  it("spreads the wall's gems round the frame instead of heaping them in one corner", () => {
    // The wall's first keep-out left only the rail's lower half free, and every
    // gem landed there, over the winners' names.
    for (const seed of [...SEEDS, "stage-wall"]) {
      const { gems } = layoutGems(seed, WALL_KEEP_OUT, undefined, true);
      expect(gems.length).toBeGreaterThanOrEqual(5);
      const cx = gems.map((g) => g.x + g.size / 2);
      const cy = gems.map((g) => g.y + g.size / 2);
      for (let i = 0; i < gems.length; i++) {
        expect(inKeepOut(cx[i], cy[i], WALL_KEEP_OUT)).toBe(false);
        // Half off-screen at most: the centre stays inside the frame.
        expect(cx[i]).toBeGreaterThan(0);
        expect(cx[i]).toBeLessThan(REF_W);
        expect(cy[i]).toBeGreaterThan(0);
        expect(cy[i]).toBeLessThan(REF_H);
      }
      expect(cx.some((x) => x < REF_W / 2)).toBe(true);
      expect(cx.some((x) => x > REF_W / 2)).toBe(true);
    }
  });

  it("keeps gems on screen and apart", () => {
    for (const seed of SEEDS) {
      const { gems } = layoutGems(seed);
      for (const g of gems) {
        expect(g.x).toBeGreaterThanOrEqual(0);
        expect(g.y).toBeGreaterThanOrEqual(0);
        expect(g.x + g.size).toBeLessThanOrEqual(REF_W);
        expect(g.y + g.size).toBeLessThanOrEqual(REF_H);
      }
      for (let i = 0; i < gems.length; i++) {
        for (let j = i + 1; j < gems.length; j++) {
          const a = gems[i];
          const b = gems[j];
          const d = Math.hypot(a.x + a.size / 2 - (b.x + b.size / 2), a.y + a.size / 2 - (b.y + b.size / 2));
          expect(d).toBeGreaterThan(((a.size + b.size) / 2) * 0.95);
        }
      }
    }
  });

  it("places a full set, every kind at least once", () => {
    for (const seed of SEEDS) {
      const { gems, sparks } = layoutGems(seed);
      expect(gems.length).toBe(8);
      expect(new Set(gems.map((g) => g.kind)).size).toBe(GEM_KINDS.length);
      expect(sparks.length).toBe(24);
    }
  });
});
