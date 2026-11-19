import { describe, expect, it } from "vitest";
import { refreshRateFrom } from "./use-frame-budget";

describe("refreshRateFrom", () => {
  it("reads a 60Hz screen as 60, jitter included", () => {
    expect(refreshRateFrom(16.7)).toBe(60);
    expect(refreshRateFrom(17.6)).toBe(60);
  });

  it("reads a 30Hz screen as 30, not as a slow 60", () => {
    // A projector on 4K HDMI, or a browser in energy saver: steady 33ms
    // frames. Judged against 60 this stripped the sweep and the gems.
    expect(refreshRateFrom(33.3)).toBe(30);
    expect(refreshRateFrom(31)).toBe(30);
    expect(refreshRateFrom(35)).toBe(30);
  });

  it("never asks for more than 60", () => {
    expect(refreshRateFrom(6.9)).toBe(60);
    expect(refreshRateFrom(0)).toBe(60);
  });

  it("has a floor for a screen slower than anything listed", () => {
    expect(refreshRateFrom(100)).toBe(24);
    expect(refreshRateFrom(Infinity)).toBe(24);
  });
});
