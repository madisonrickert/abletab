import type { NoteModel, TimeSignature } from "./notation/types";
import type { InstrumentPreset } from "./instruments";

export type TabFormat = "pdf" | "ascii" | "alphatex";

/** "off" disables onset snapping; the rest map to tutts' QuantizeGrid. */
export type TabQuantize = "off" | "1/4" | "1/8" | "1/16" | "1/32";

export interface TabSettings {
  preset: string; // a preset name, or "Custom"
  tuning: string[]; // string names in UI order (reversed for tutts)
  fretCount: number;
  quantizeGrid: TabQuantize;
  formats: TabFormat[];
}

export interface TabProvenance {
  clipName: string;
  tempo: number;
  fingerprint: string;
  generatedAt: string; // ISO timestamp
}

/** Everything the webview needs to render, configure, export, and self-identify a tab. */
export interface TabPayload {
  clipName: string;
  notes: NoteModel[];
  tempo: number;
  timeSig: TimeSignature;
  presets: InstrumentPreset[];
  noteOptions: string[]; // note names for the per-string dropdowns
  settings: TabSettings;
  fingerprint: string; // of the current live notes
  lastExportFingerprint: string | null; // from last-export.json, for the staleness banner
  provenance: TabProvenance;
}

/** A single artifact the webview returns. */
export interface ExportedFile {
  name: string;
  format: TabFormat;
  encoding: "text" | "base64";
  data: string;
}

/** What the webview posts back via close_and_send (JSON-stringified). */
export interface TabResult {
  files: ExportedFile[];
  settings: TabSettings;
  fingerprint: string;
}

export const PAYLOAD_TOKEN = "__TAB_PAYLOAD_JSON__";

/**
 * Escape `<` so the JSON cannot break out of its <script type="application/json"> host
 * (prevents a literal `</script>`). JSON.parse turns `<` back into `<` on read.
 */
export function escapeForScriptJson(json: string): string {
  return json.replace(/</g, "\\u003c");
}

/** Replace the payload token in the bundled webview HTML with the escaped payload JSON. */
export function injectPayload(html: string, payload: TabPayload): string {
  if (!html.includes(PAYLOAD_TOKEN)) throw new Error("payload token not found in webview HTML");
  // Pass the replacement as a function so String.replace uses it verbatim. With a
  // string replacement, `$&`/`$'`/`` $` ``/`$$` in the JSON (e.g. a clip named
  // "$& Intro") would be expanded as special patterns and corrupt the payload.
  return html.replace(PAYLOAD_TOKEN, () => escapeForScriptJson(JSON.stringify(payload)));
}
