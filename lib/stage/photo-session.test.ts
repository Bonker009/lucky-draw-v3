import { describe, expect, it } from "vitest";
import {
  PHOTO_INITIAL,
  applyPhotoAction,
  clampGroup,
  groupCount,
  groupSlice,
  type RosterEntry,
} from "./photo-session";

const roster: RosterEntry[] = Array.from({ length: 23 }, (_, i) => ({
  participantId: `p${i}`,
  name: `Guest ${i}`,
  n: i + 1,
}));

describe("photo groups", () => {
  it("pages a roster in tens, numbering continuously", () => {
    expect(groupCount(23)).toBe(3);
    expect(groupCount(10)).toBe(1);
    expect(groupCount(0)).toBe(1);
    expect(groupSlice(roster, 1).map((r) => r.n)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(groupSlice(roster, 2).map((r) => r.n)).toEqual([21, 22, 23]);
  });

  it("clamps a group out of range", () => {
    expect(clampGroup(9, 23)).toBe(2);
    expect(clampGroup(-1, 23)).toBe(0);
  });
});

describe("applyPhotoAction", () => {
  it("checks people in and out, and a check-in clears a no-show", () => {
    let s = applyPhotoAction(PHOTO_INITIAL, { type: "absent", participantId: "p1", absent: true }, roster);
    expect(s.absent).toEqual(["p1"]);
    s = applyPhotoAction(s, { type: "here", participantId: "p1", here: true }, roster);
    expect(s.here).toEqual(["p1"]);
    expect(s.absent).toEqual([]);
    s = applyPhotoAction(s, { type: "here", participantId: "p1", here: false }, roster);
    expect(s.here).toEqual([]);
    expect(s.absent).toEqual([]);
  });

  it("marks everyone in the current group here, except no-shows", () => {
    let s = applyPhotoAction(PHOTO_INITIAL, { type: "group", group: 1 }, roster);
    s = applyPhotoAction(s, { type: "absent", participantId: "p12", absent: true }, roster);
    s = applyPhotoAction(s, { type: "allHere" }, roster);
    expect(s.here).toHaveLength(9);
    expect(s.here).not.toContain("p12");
    expect(s.here).not.toContain("p0");
  });

  it("ignores anything that is not a valid request for this roster", () => {
    const before = PHOTO_INITIAL;
    expect(applyPhotoAction(before, { type: "here", participantId: "nobody", here: true }, roster)).toBe(before);
    expect(applyPhotoAction(before, { type: "mode", mode: "dance" }, roster)).toBe(before);
    expect(applyPhotoAction(before, { type: "group", group: "2" }, roster)).toBe(before);
    expect(applyPhotoAction(before, null, roster)).toBe(before);
    expect(applyPhotoAction(before, { type: "group", group: 99 }, roster).group).toBe(2);
  });
});
