import { describe, expect, it } from "vitest";
import { fold } from "@/lib/domain/events";
import { applyPrizeAction } from "./prize-show";

const state = fold([
  { seq: 1, at: 0, event: { type: "PRIZE_UPSERTED", prize: { id: "z0", name: "Bike", quantity: 3 } } },
  { seq: 2, at: 0, event: { type: "PRIZE_UPSERTED", prize: { id: "z1", name: "Phone", quantity: 1 } } },
]);

describe("applyPrizeAction", () => {
  it("shows a prize covered, then reveals it, then hides it", () => {
    let s = applyPrizeAction(null, { type: "show" }, state, "z1");
    expect(s).toEqual({ prizeId: "z1", revealed: false });
    s = applyPrizeAction(s, { type: "reveal" }, state, "z1");
    expect(s).toEqual({ prizeId: "z1", revealed: true });
    expect(applyPrizeAction(s, { type: "hide" }, state, "z1")).toBeNull();
  });

  it("takes an explicit prize over the selected one", () => {
    expect(applyPrizeAction(null, { type: "show", prizeId: "z0" }, state, "z1")?.prizeId).toBe("z0");
  });

  it("ignores unknown prizes, a reveal with nothing shown, and junk", () => {
    expect(applyPrizeAction(null, { type: "show", prizeId: "nope" }, state, null)).toBeNull();
    expect(applyPrizeAction(null, { type: "reveal" }, state, "z0")).toBeNull();
    const shown = { prizeId: "z0", revealed: false };
    expect(applyPrizeAction(shown, { type: "dance" }, state, "z0")).toBe(shown);
    expect(applyPrizeAction(shown, "show", state, "z0")).toBe(shown);
  });
});
