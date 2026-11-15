import { describe, expect, it } from "vitest";
import {
  FLAP_LETTER_MS,
  FLAP_SLOW_MS,
  FLAP_TYPING_MS,
  FLAP_WORD_GAP_MS,
  revealTimes,
} from "./flap-plan";

const tiles = (s: string, cols = 22) => {
  const pad = Math.floor((cols - s.length) / 2);
  return Array.from({ length: cols }, (_, i) => s[i - pad] ?? " ");
};

describe("revealTimes", () => {
  it("lands letters in reading order, the first one slow-down after the reveal", () => {
    const chars = tiles("SOKHA");
    const { settleAt } = revealTimes(chars);
    const letterTimes = chars.flatMap((c, i) => (c.trim() ? [settleAt[i]] : []));
    expect(letterTimes[0]).toBe(FLAP_SLOW_MS);
    for (let k = 1; k < letterTimes.length; k++) {
      expect(letterTimes[k] - letterTimes[k - 1]).toBe(FLAP_LETTER_MS);
    }
  });

  it("gives a word break its own beat", () => {
    const chars = tiles("SOK DARA");
    const { settleAt } = revealTimes(chars);
    const letterTimes = chars.flatMap((c, i) => (c.trim() ? [settleAt[i]] : []));
    expect(letterTimes[3] - letterTimes[2]).toBe(FLAP_LETTER_MS + FLAP_WORD_GAP_MS);
    expect(letterTimes[2] - letterTimes[1]).toBe(FLAP_LETTER_MS);
  });

  it("never lets a blank go still before the letters around it", () => {
    const chars = tiles("SOK DARA");
    const { settleAt } = revealTimes(chars);
    const first = chars.findIndex((c) => c.trim());
    const space = chars.indexOf(" ", first);
    // Leading blanks land with the first letter, the space with the D.
    for (let i = 0; i < first; i++) expect(settleAt[i]).toBe(settleAt[first]);
    expect(settleAt[space]).toBe(settleAt[space + 1]);
    // Trailing blanks land with the last letter: the board ends on the name.
    expect(settleAt[chars.length - 1]).toBe(Math.max(...settleAt));
  });

  it("fits any name, two rows included, inside the padded hold", () => {
    for (const name of ["A", "SOKHA CHAN", "SOKUNTHEARY CHANTHAVY", "MARIA DEL CARMEN RODRIGUEZ"]) {
      const chars = [...tiles(name.slice(0, 16), 16), ...tiles(name.slice(16), 16)];
      const { settleAt, doneAt } = revealTimes(chars);
      expect(doneAt).toBeLessThanOrEqual(FLAP_TYPING_MS + 1e-6);
      expect(Math.max(...settleAt)).toBeLessThan(doneAt);
      // Still in reading order.
      for (let i = 1; i < settleAt.length; i++) {
        expect(settleAt[i]).toBeGreaterThanOrEqual(settleAt[i - 1]);
      }
    }
  });
});
