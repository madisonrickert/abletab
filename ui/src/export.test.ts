import { describe, it, expect } from "vitest";
import { sanitize, asciiFile } from "./export";
import type { GeneratedTab } from "@tutts/core";

// A minimal fake — export.ts only calls toAscii(), so the rest can be stubbed.
const fakeTab = {
  data: { tuning: [], measures: [] },
  toLines: () => ["e|---", "B|---"],
  toAscii: () => "e|---0---|\nB|--------|\n",
} as unknown as GeneratedTab;

describe("sanitize", () => {
  it("strips path-hostile characters", () => {
    expect(sanitize('A/B:C*?"<>|')).toBe("A_B_C______");
  });
  it("strips backslashes too", () => {
    expect(sanitize("A\\B")).toBe("A_B");
  });
  it("falls back to 'tab' when empty", () => {
    expect(sanitize("   ")).toBe("tab");
  });
  it("caps very long names to a filesystem-safe length", () => {
    expect(sanitize("x".repeat(300)).length).toBe(200);
  });
});

describe("asciiFile", () => {
  it("wraps toAscii() output as a .txt text file", () => {
    const f = asciiFile("Verse", fakeTab);
    expect(f).toEqual({ name: "Verse.txt", format: "ascii", encoding: "text", data: "e|---0---|\nB|--------|\n" });
  });
});
