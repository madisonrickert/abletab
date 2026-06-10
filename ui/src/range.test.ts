import { describe, it, expect } from "vitest";
import { countOutOfRange, suggestOctaveShift } from "./range";
import { Tuning } from "tutts";

// Standard guitar: E2 (40) to E4 + 20 frets (84).
const GUITAR = Tuning.standardGuitar().getPitchBounds();

describe("countOutOfRange", () => {
  it("counts notes outside the bounds", () => {
    expect(countOutOfRange([39, 40, 84, 85], GUITAR)).toBe(2);
  });
  it("applies an octave offset before counting", () => {
    expect(countOutOfRange([28, 29], GUITAR, 1)).toBe(0); // +12 puts both in range
  });
});

describe("suggestOctaveShift", () => {
  it("returns null when everything already fits", () => {
    expect(suggestOctaveShift([40, 60, 84], GUITAR)).toBeNull();
  });
  it("returns null for an empty clip", () => {
    expect(suggestOctaveShift([], GUITAR)).toBeNull();
  });
  it("suggests +1 octave for a part one octave too low", () => {
    expect(suggestOctaveShift([28, 30, 33], GUITAR)).toBe(1);
  });
  it("suggests a downward shift for a part too high", () => {
    expect(suggestOctaveShift([90, 92, 95], GUITAR)).toBe(-1);
  });
  it("suggests multiple octaves when needed", () => {
    expect(suggestOctaveShift([16, 18, 21], GUITAR)).toBe(2);
  });
  it("returns null when no shift improves the fit", () => {
    // In-range notes near both extremes plus one stray on each side: any shift
    // strands as many notes as it rescues.
    expect(suggestOctaveShift([39, 50, 80, 85], GUITAR)).toBeNull();
  });
  it("picks the shift that rescues the most notes when nothing fits all", () => {
    // Three low notes + one high note: +1 fixes three and strands one.
    expect(suggestOctaveShift([28, 30, 33, 85], GUITAR)).toBe(1);
  });
});
