import { describe, expect, it } from "vitest";
import { BLOCK_TOLERANCE_FOR_1M, closeTo1MBoundary, crossed100KBoundary, next1MBoundary } from "../../src/utils.ts";

describe("crossed100KBoundary", () => {
  it.each([
    { from: 550_000, to: 599_999, expected: false, label: "within same window" },
    { from: 550_000, to: 699_999, expected: true, label: "crosses boundary" },
    { from: 550_000, to: 600_000, expected: true, label: "crosses boundary (`to` inclusive)" },
    { from: 100_000, to: 150_000, expected: true, label: "crosses boundary (`from` inclusive)" },
    { from: 800_000, to: 1_000_500, expected: true, label: "crosses multiple boundaries" },
    { from: 99_999, to: 100_000, expected: true, label: "one step to boundary" },
  ])("$label: [$from, $to] → $expected", ({ from, to, expected }) => {
    expect(crossed100KBoundary(from, to)).toBe(expected);
  });

  it("throws when from >= to", () => {
    expect(() => crossed100KBoundary(100_001, 100_000)).toThrow();
    expect(() => crossed100KBoundary(100_000, 100_000)).toThrow();
  });
});

describe("next1MBoundary", () => {
  it.each([
    { round: 0, expected: 1_000_000, label: "at zero" },
    { round: 500_000, expected: 1_000_000, label: "mid-period" },
    { round: 999_999, expected: 1_000_000, label: "one before boundary" },
    { round: 1_000_000, expected: 2_000_000, label: "at boundary, next is 2M" },
    { round: 1_500_000, expected: 2_000_000, label: "mid second period" },
  ])("$label: $round → $expected", ({ round, expected }) => {
    expect(next1MBoundary(round)).toBe(expected);
  });
});

describe("closeTo1MBoundary", () => {
  it.each([
    { round: 1_000_000 - BLOCK_TOLERANCE_FOR_1M, expected: true, label: "at exact tolerance boundary" },
    { round: 1_000_000 - BLOCK_TOLERANCE_FOR_1M - 1, expected: false, label: "one block outside tolerance" },
    { round: 999_999, expected: true, label: "one block before 1M" },
    { round: 1_000_000, expected: false, label: "at 1M boundary (next is 2M, far away)" },
    { round: 500_000, expected: false, label: "far from boundary" },
    { round: 2_000_000 - BLOCK_TOLERANCE_FOR_1M, expected: true, label: "close to 2M boundary" },
  ])("$label: $round → $expected", ({ round, expected }) => {
    expect(closeTo1MBoundary(round)).toBe(expected);
  });
});
