/**
 * Range fit between a clip's pitches and a tuning's playable range. Pure; no DOM.
 * tutts octave-folds out-of-range pitches onto the extreme strings, which renders
 * awkwardly — these helpers power the info bar that offers a whole-clip octave
 * shift instead.
 */

export type PitchBounds = [min: number, max: number];

/** How many of `midis` fall outside [min, max] after shifting by `octaves`. */
export function countOutOfRange(midis: number[], bounds: PitchBounds, octaves = 0): number {
  const [lo, hi] = bounds;
  const offset = octaves * 12;
  return midis.reduce((n, m) => (m + offset < lo || m + offset > hi ? n + 1 : n), 0);
}

const MAX_SHIFT = 4;

/**
 * The octave shift (relative to the current one) that leaves the fewest notes
 * out of range, or null when no shift beats staying put. Ties prefer the
 * smallest |shift|, then the downward one (low tab reads better than folded-high).
 */
export function suggestOctaveShift(midis: number[], bounds: PitchBounds): number | null {
  if (midis.length === 0) return null;
  const baseline = countOutOfRange(midis, bounds);
  if (baseline === 0) return null;
  let best: { shift: number; oob: number } | null = null;
  for (let shift = -MAX_SHIFT; shift <= MAX_SHIFT; shift++) {
    if (shift === 0) continue;
    const oob = countOutOfRange(midis, bounds, shift);
    if (
      !best ||
      oob < best.oob ||
      (oob === best.oob &&
        (Math.abs(shift) < Math.abs(best.shift) ||
          (Math.abs(shift) === Math.abs(best.shift) && shift < best.shift)))
    ) {
      best = { shift, oob };
    }
  }
  return best && best.oob < baseline ? best.shift : null;
}
