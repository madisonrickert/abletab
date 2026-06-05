/** A stringed-instrument tuning preset. */
export interface InstrumentPreset {
  name: string;
  /**
   * String tunings in UI row order — lowest-numbered string first (4th/6th
   * string at the top), matching how a player reads a tab clef. For most
   * instruments this is low→high pitch; reentrant tunings (e.g. ukulele) are
   * listed in conventional string order. Reverse this array to get tutts'
   * thin→thick order before constructing a `Tuning`.
   */
  stringNames: string[];
  /** Default fret count for this instrument. */
  fretCount: number;
}

export const CUSTOM_PRESET_NAME = "Custom";
export const MIN_STRINGS = 4;
export const MAX_STRINGS = 8;

export const INSTRUMENTS: InstrumentPreset[] = [
  { name: "Standard Guitar", stringNames: ["E2", "A2", "D3", "G3", "B3", "E4"], fretCount: 20 },
  { name: "Bass (4-string)", stringNames: ["E1", "A1", "D2", "G2"], fretCount: 24 },
  { name: "Ukulele", stringNames: ["G4", "C4", "E4", "A4"], fretCount: 15 },
  { name: "7-String Guitar", stringNames: ["B1", "E2", "A2", "D3", "G3", "B3", "E4"], fretCount: 24 },
  { name: "Drop D", stringNames: ["D2", "A2", "D3", "G3", "B3", "E4"], fretCount: 20 },
  { name: "DADGAD", stringNames: ["D2", "A2", "D3", "G3", "A3", "D4"], fretCount: 20 },
  { name: "Open G", stringNames: ["D2", "G2", "D3", "G3", "B3", "D4"], fretCount: 20 },
];

const PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

/**
 * All chromatic note names from `C{minOctave}` to `B{maxOctave}`, ascending,
 * spelled with sharps — the spelling tutts' note parser expects (C4 = midi 60).
 * Used to populate the per-string note dropdowns.
 */
export function chromaticNoteNames(minOctave = 0, maxOctave = 6): string[] {
  const out: string[] = [];
  for (let octave = minOctave; octave <= maxOctave; octave++) {
    for (const pc of PITCH_CLASSES) out.push(`${pc}${octave}`);
  }
  return out;
}
