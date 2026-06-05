import { describe, it, expect } from "vitest";
import {
  INSTRUMENTS,
  CUSTOM_PRESET_NAME,
  MIN_STRINGS,
  MAX_STRINGS,
  chromaticNoteNames,
} from "./instruments";

const byName = (name: string) => INSTRUMENTS.find((p) => p.name === name)!;

describe("INSTRUMENTS", () => {
  it("has the seven expected presets, none named Custom", () => {
    expect(INSTRUMENTS.map((p) => p.name)).toEqual([
      "Standard Guitar",
      "Bass (4-string)",
      "Ukulele",
      "7-String Guitar",
      "Drop D",
      "DADGAD",
      "Open G",
    ]);
    expect(INSTRUMENTS.some((p) => p.name === CUSTOM_PRESET_NAME)).toBe(false);
  });

  it("every preset has 4-8 strings and a sane fret count", () => {
    for (const p of INSTRUMENTS) {
      expect(p.stringNames.length).toBeGreaterThanOrEqual(MIN_STRINGS);
      expect(p.stringNames.length).toBeLessThanOrEqual(MAX_STRINGS);
      expect(p.fretCount).toBeGreaterThanOrEqual(12);
      expect(p.fretCount).toBeLessThanOrEqual(30);
    }
  });

  it("every string name is a tutts-parseable note name (letter, optional #/b, octave)", () => {
    const re = /^[A-Ga-g][#b!]?[+-]?\d+$/;
    for (const p of INSTRUMENTS) for (const n of p.stringNames) expect(n).toMatch(re);
  });

  it("bounds are 4 and 8", () => {
    expect(MIN_STRINGS).toBe(4);
    expect(MAX_STRINGS).toBe(8);
  });

  it("reversed to thin->thick, Standard Guitar and Ukulele match tutts' native order", () => {
    // tutts: STANDARD_GUITAR = ["E4","B3","G3","D3","A2","E2"], STANDARD_UKULELE = ["A4","E4","C4","G4"]
    expect([...byName("Standard Guitar").stringNames].reverse()).toEqual(["E4", "B3", "G3", "D3", "A2", "E2"]);
    expect([...byName("Ukulele").stringNames].reverse()).toEqual(["A4", "E4", "C4", "G4"]);
  });
});

describe("chromaticNoteNames", () => {
  it("spans the requested octaves inclusively in ascending order with sharps", () => {
    const names = chromaticNoteNames(1, 2);
    expect(names[0]).toBe("C1");
    expect(names).toContain("F#1");
    expect(names[names.length - 1]).toBe("B2");
    expect(names.length).toBe(24);
  });
  it("contains every preset string name (so each can be selected in a dropdown)", () => {
    const names = new Set(chromaticNoteNames(0, 6));
    for (const p of INSTRUMENTS) for (const n of p.stringNames) expect(names.has(n)).toBe(true);
  });
  it("defaults span octaves 0-6", () => {
    expect(chromaticNoteNames()).toEqual(chromaticNoteNames(0, 6));
  });
});
