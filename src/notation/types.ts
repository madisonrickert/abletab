/** A note normalized for notation. Times are in quarter-note beats from clip start. */
export interface NoteModel {
  midi: number; // MIDI note number, 0-127 (C4 = 60)
  startBeats: number; // onset in quarter-note beats
  durationBeats: number; // length in quarter-note beats
}

export interface TimeSignature {
  numerator: number; // e.g. 4
  denominator: number; // e.g. 4 or 8
}
