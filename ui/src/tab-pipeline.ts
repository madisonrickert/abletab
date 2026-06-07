import { generateTab, Tuning, type GeneratedTab } from "@tutts/core";
import type { NoteModel } from "../../src/notation/types";
import type { TabQuantize } from "../../src/payload";

/**
 * Build a tutts Tuning from the UI's string list. The UI lists strings in row
 * order (lowest-numbered string first); tutts wants thin->thick, so reverse.
 */
export function buildTuning(stringNamesUiOrder: string[], fretCount: number): Tuning {
  return new Tuning([...stringNamesUiOrder].reverse(), fretCount);
}

export interface PipelineInput {
  notes: NoteModel[];
  stringNames: string[]; // UI order
  fretCount: number;
  quantizeGrid: TabQuantize;
  tempo: number;
  timeSig: { numerator: number; denominator: number };
  title: string;
  tuningLabel: string;
}

export interface PipelineOutput {
  tab: GeneratedTab;
  warnings: string[];
}

/** notes + tuning + grid -> fingered tab. Pure; no DOM, no renderer. */
export function runPipeline(input: PipelineInput): PipelineOutput {
  const tuning = buildTuning(input.stringNames, input.fretCount);
  const tab = generateTab({
    notes: input.notes,
    tuning,
    quantizeGrid: input.quantizeGrid === "off" ? undefined : input.quantizeGrid,
    tempo: input.tempo,
    timeSignatures: [
      { numerator: input.timeSig.numerator, denominator: input.timeSig.denominator, startBeats: 0 },
    ],
  });
  return { tab, warnings: [] };
}
