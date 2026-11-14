import { describe, expect, it } from "vitest";
import { fitFontSize, lineCount, splitRows, type Measure } from "./fit-text";

// A monospace-ish stand-in: every character is 0.5em wide.
const measure: Measure = (text, px) => text.length * px * 0.5;

describe("lineCount", () => {
  it("wraps on spaces", () => {
    // "Sokunthea Rin" at 20px: words 90 and 30 wide, space 10 — 130 in all.
    expect(lineCount("Sokunthea Rin", 20, 130, measure)).toBe(1);
    expect(lineCount("Sokunthea Rin", 20, 120, measure)).toBe(2);
  });

  it("reports an unbreakable word as not fitting", () => {
    expect(lineCount("Vongsakthavichitrachan", 40, 300, measure)).toBe(Infinity);
  });
});

describe("fitFontSize", () => {
  const box = { maxWidth: 380, maxLines: 3, max: 92, min: 40, measure };

  it("keeps a short name at full size", () => {
    expect(fitFontSize("Dara", box)).toBe(92);
  });

  it("shrinks a long name until it fits the lines it has", () => {
    const name = "Sreymom Rachana Chanthavong Ouk";
    const px = fitFontSize(name, box);
    expect(px).toBeLessThan(92);
    expect(lineCount(name, px, box.maxWidth, measure)).toBeLessThanOrEqual(3);
    // And it is the largest size that does.
    expect(lineCount(name, px + 2, box.maxWidth, measure)).toBeGreaterThan(3);
  });

  it("shrinks until a single long word fits on its own line", () => {
    // 22 characters: fits a 500px line from 44px down.
    const px = fitFontSize("Vongsakthavichitrachan Sok", { ...box, maxWidth: 500 });
    expect(px).toBe(44);
    expect(measure("Vongsakthavichitrachan", px)).toBeLessThanOrEqual(500);
  });

  it("returns the floor when nothing fits", () => {
    expect(fitFontSize("x".repeat(200), box)).toBe(40);
  });
});

describe("splitRows", () => {
  it("leaves a short name on one row", () => {
    expect(splitRows("Sokunthea Rin", 18)).toEqual(["Sokunthea Rin"]);
  });

  it("splits a long name at the space nearest its middle", () => {
    expect(splitRows("Sreymom Rachana Chanthavong Ouk", 18)).toEqual([
      "Sreymom Rachana",
      "Chanthavong Ouk",
    ]);
  });

  it("keeps a name with no space whole", () => {
    expect(splitRows("Vongsakthavichitrachansok", 18)).toEqual(["Vongsakthavichitrachansok"]);
  });
});
