import { describe, it, expect } from "vitest";
import { buildTuning, runPipeline } from "./tab-pipeline";

describe("buildTuning", () => {
  it("reverses UI order to tutts thin->thick (Standard Guitar pitches)", () => {
    const t = buildTuning(["E2", "A2", "D3", "G3", "B3", "E4"], 20);
    // thin->thick: E4=64, B3=59, G3=55, D3=50, A2=45, E2=40
    expect(t.strings.map((s) => s.pitch)).toEqual([64, 59, 55, 50, 45, 40]);
    expect(t.nfrets).toBe(20);
  });
});

describe("runPipeline", () => {
  const notes = [
    { midi: 40, startBeats: 0, durationBeats: 1 },
    { midi: 45, startBeats: 1, durationBeats: 1 },
    { midi: 50, startBeats: 2, durationBeats: 1 },
    { midi: 55, startBeats: 3, durationBeats: 1 },
  ];

  it("produces non-empty alphaTex with a tuning directive", () => {
    const out = runPipeline({
      notes,
      stringNames: ["E2", "A2", "D3", "G3", "B3", "E4"],
      fretCount: 20,
      quantizeGrid: "1/16",
      tempo: 120,
      timeSig: { numerator: 4, denominator: 4 },
      title: "Test Riff",
      tuningLabel: "Standard Guitar",
    });
    expect(out.tex).toContain("\\tuning");
    expect(out.tex).toContain("\\title");
    expect(out.tex.length).toBeGreaterThan(20);
    expect(Array.isArray(out.warnings)).toBe(true);
    expect(out.tab.toAscii().length).toBeGreaterThan(0);
  });

  it("quantizeGrid 'off' preserves an off-grid onset that a coarse grid would snap", () => {
    // A note at beat 0.5 sits off the 1/4 (one-beat) grid; "off" must leave it,
    // while "1/4" snaps it — so the two renderings must differ. This pins the
    // module's own `"off" -> undefined` mapping (the snapping itself is tutts').
    const offGrid = [
      { midi: 40, startBeats: 0, durationBeats: 0.5 },
      { midi: 45, startBeats: 0.5, durationBeats: 0.5 },
      { midi: 50, startBeats: 1.5, durationBeats: 0.5 },
    ];
    const common = {
      stringNames: ["E2", "A2", "D3", "G3", "B3", "E4"],
      fretCount: 20,
      tempo: 120,
      timeSig: { numerator: 4, denominator: 4 },
      title: "Test",
      tuningLabel: "Standard Guitar",
    };
    const off = runPipeline({ ...common, notes: offGrid, quantizeGrid: "off" });
    const snapped = runPipeline({ ...common, notes: offGrid, quantizeGrid: "1/4" });
    expect(off.tex.length).toBeGreaterThan(20);
    expect(off.tab.toAscii().length).toBeGreaterThan(0);
    expect(off.tex).not.toBe(snapped.tex); // "off" did not snap to the 1/4 grid
  });
});
