# MIDI Tablature Extension — Design

**Date:** 2026-06-05
**Status:** Approved for planning
**Author:** Madison Rickert (with Claude)

## Overview

An Ableton Live extension that renders a MIDI clip as stringed-instrument **tablature**. The user right-clicks a MIDI clip, chooses **"Show Tab"**, and a modal webview opens showing the rendered tab with controls for instrument preset, tuning, string count, fret count, and quantize grid. The tab can be exported to **PDF**, **ASCII tab (.txt)**, and **alphaTex (.txt)**. Settings persist between opens.

The extension is a near-sibling of the existing [sheet music extension](../../../../ableton-sheet-music-extension/). It reuses that project's Node-extension + webview architecture, payload/messaging contract, and build machinery almost verbatim. The difference is the rendering core: instead of a MusicXML notation engine, it uses the locally-developed [`tutts`](../../../../tutts/) library — `@tutts/core` for MIDI→fretboard fingering and `@tutts/alphatab` to emit alphaTex — rendered by [AlphaTab](https://alphatab.net/).

**Extension display name:** "Tablature".

## Goals

- Render any MIDI clip as readable tablature inside Live, with no round-trip to external tools.
- Configurable tuning, string count (4–8), and fret count, with presets for common stringed instruments.
- Export to PDF, ASCII tab, and alphaTex source.
- Remember the user's instrument/tuning/format choices between sessions.
- Lean on `tutts` for all fingering and rhythm logic — the extension adds only the Live integration, the preset/tuning UI, and the export plumbing.

## Non-goals (v1)

- Standard notation staff alongside the tab (tab-only).
- PNG export (PDF + the two text formats cover the use cases).
- Exposing `tutts`' difficulty-metric weights — they stay at library defaults; there is no compelling reason to make them tunable.
- Editing the tab in the webview (it is a read/render/export surface, not an editor).
- Guitar Pro (`.gp`) export — AlphaTab imports that format but does not export it.

## Existing tools survey

The problem decomposes into three already-solved pieces, so the extension is mostly integration:

- **Fingering engine** — `@tutts/core` (`generateTab`). Frames fingering as a Hidden Markov Model and runs Viterbi to choose the easiest-to-play sequence. Speaks Ableton's beat-based `NoteModel` (`{ midi, startBeats, durationBeats }`) natively, so clip notes drop in with no adapter. Pure, zero-dependency, already unit-tested.
- **Notation adapter** — `@tutts/alphatab` (`toAlphaTex`). Maps `tutts`' renderer-neutral `TabData` to alphaTex: reconciles string numbering, decomposes durations into note values with dots/rests/ties, splits polyphony into voices, and returns `{ tex, voiceCount, warnings }`.
- **Renderer** — `@coderline/alphatab` (^1.6.0). Renders alphaTex to SVG in the browser.

The extension itself builds on the sheet music extension's proven shell rather than reimplementing Live integration, payload injection, settings persistence, or the build pipeline.

## Architecture

Three layers, mirroring the sheet music extension:

```
Live MIDI clip
   │  ctx.getObjectFromHandle(handle, MidiClip)
   ▼
[Node extension]  src/extension.ts
   │  toNoteModels()  (BigInt → number)          ← reused verbatim
   │  build TabPayload, inject into bundled HTML, ctx.ui.showModalDialog()
   ▼
[Webview]  ui/  (single-file Vite bundle)
   │  build Tuning from selected preset / custom string list + fret count
   │  generateTab({ notes, tuning, quantizeGrid })        @tutts/core
   │  toAlphaTex(tab.data, { title, tempo })               @tutts/alphatab
   │  AlphaTab ScoreRenderer (core.engine = "svg") → SVG chunks → DOM
   │  exports: PDF (svg2pdf), ASCII (tab.toAscii()), alphaTex (tex)
   ▼  postResult({ files, settings, fingerprint })  via close_and_send
[Node extension]  write files → storageDir/tabs/, reveal first in Finder
```

### Reused essentially verbatim from the sheet music extension

- `src/file-url.ts` — `pathToFileURL` helper.
- `src/notation/notes.ts` — `toNoteModels(clip.notes)`. The `NoteModel` shape is identical between the sheet music extension and `@tutts/core`, so SDK notes feed `tutts` with no conversion.
- `src/notation/fingerprint.ts` — FNV-1a hash for change/staleness detection.
- `src/payload.ts` injection pattern — `injectPayload()` + `escapeForScriptJson()` (`<` → `<`).
- Settings + last-export persistence (`readJson` fallback pattern, `settings.json`, `last-export.json`).
- `close_and_send` postMessage protocol (webkit / chrome webview detection).
- BigInt coercion at every SDK numeric boundary (`Number(...)`).
- Build config: `build.ts` (esbuild → CJS, `.html` as text loader), `vite.config.ts` (`viteSingleFile`), `vitest.config.ts`, `tsconfig.json` + `ui/tsconfig.json`, `manifest.json`, `scripts/setup-sdk.mjs`, `scripts/package.mjs`, the CI workflow.

### Dropped (sheet-music-specific, not needed)

The entire MusicXML engine: `musicxml.ts`, `durations.ts`, `clef.ts`, `key.ts`, `transpose.ts`. `tutts` owns all fingering, rhythm, measure, and tie logic.

### New code

- `src/instruments.ts` — instrument preset table (pure, unit-tested).
- `src/payload.ts` — tab-specific payload/result/settings contract (replaces the chart one).
- `ui/src/main.ts` — the tab pipeline, the tuning/preset UI, and the export logic.
- One bundled font asset (Bravura) for offline AlphaTab rendering.

## Components

### `src/extension.ts`

A copy of the sheet music entry point, changed in these specifics:

- Command id: `tablature.showTab`.
- Context menu: `ctx.ui.registerContextMenuAction("MidiClip", "Show Tab", "tablature.showTab")`.
- Output directory: `storageDir/tabs/`.
- Reads from the clip/song: `clip.name`, `clip.notes` (→ `toNoteModels`), `song.tempo`, and the scene time signature (numerator/denominator, with the same "≤0 means unset → default 4/4" guard the sheet music extension uses). It does **not** read key signature (irrelevant to tab).
- Builds a `TabPayload`, injects it into the bundled HTML, writes to the temp dir, and opens it with `ctx.ui.showModalDialog(fileUrl(uiPath), 900, 640)`.
- On result: persists settings, writes any exported files to `storageDir/tabs/`, records the last-export fingerprint, and reveals the first written file in Finder.

### `src/instruments.ts` (new, pure, unit-tested)

A preset table. Each preset is `{ name, stringNames, fretCount }`, where `stringNames` is low→high. The webview builds a `tutts` tuning via `new Tuning(stringNamesThinToThick, fretCount)` (reversing to `tutts`' thin→thick order).

| Preset | Strings (low → high) | Default frets |
|---|---|---|
| Standard Guitar | E2 A2 D3 G3 B3 E4 | 20 |
| Bass (4-string) | E1 A1 D2 G2 | 24 |
| Ukulele | G4 C4 E4 A4 | 15 |
| 7-String Guitar | B1 E2 A2 D3 G3 B3 E4 | 24 |
| Drop D | D2 A2 D3 G3 B3 E4 | 20 |
| DADGAD | D2 A2 D3 G3 A3 D4 | 20 |
| Open G | D2 G2 D3 G3 B3 D4 | 20 |
| Custom | (user-defined) | 20 |

Standard Guitar and Ukulele match `tutts`' native presets; the rest are defined here.

### `src/payload.ts` (new contract)

```ts
interface TabPayload {
  clipName: string;
  notes: NoteModel[];
  tempo: number;
  timeSig: { numerator: number; denominator: number };
  presets: InstrumentPreset[];           // from instruments.ts
  settings: TabSettings;
  fingerprint: string;
  lastExportFingerprint: string | null;
  provenance: { clipName: string; tempo: number; fingerprint: string; generatedAt: string };
}

interface TabSettings {
  preset: string;                        // preset name, or "Custom"
  tuning: string[];                      // string names, low → high
  fretCount: number;
  quantizeGrid: "off" | "1/4" | "1/8" | "1/16" | "1/32";
  formats: Array<"pdf" | "ascii" | "alphatex">;
}

interface TabResult {
  files: ExportedFile[];                 // ExportedFile unchanged from sheet music
  settings: TabSettings;
  fingerprint: string;
}
```

`DEFAULT_SETTINGS`: preset "Standard Guitar", its tuning + 20 frets, `quantizeGrid: "1/16"`, `formats: ["pdf"]`.

### `ui/` (webview)

The webview parses the payload, builds the tuning, runs the `tutts` pipeline, and renders with AlphaTab.

**Pipeline (re-run on any control change, pure functional re-render):**

1. Build `tuning = new Tuning(stringNamesThinToThick, fretCount)`.
2. `const tab = generateTab({ notes, tuning, quantizeGrid: grid === "off" ? undefined : grid })`.
3. `const { tex, warnings } = toAlphaTex(tab.data, { title: clipName, tempo })`.
4. Render `tex` with AlphaTab → SVG → inject into `#score`.
5. Stash `tab` (for `toAscii()`) and `tex` (for alphaTex export) for the export step.

**AlphaTab offline rendering.** The webview is a self-contained single-file bundle with no network access, so AlphaTab is configured to render fully offline:

- Use the low-level `alphaTab.rendering.ScoreRenderer` (not the full `AlphaTabApi`) — it runs synchronously on the main thread, with no web worker and no audio player, and emits SVG via the `partialRenderFinished` event. This is the same "grab the SVG, inject it, reuse it for PDF" approach the sheet music extension takes with OSMD.
- `settings.core.engine = "svg"`.
- `settings.core.fontDirectory = null`; supply the Bravura SMuFL font through `settings.core.smuflFontSources` as a base64 data URI. The font file is bundled into the single-file build.
- `staveProfile` set to tab-only so no standard notation staff is drawn.
- Import the alphaTex via `AlphaTabImporter` / `ScoreLoader`, then render.

### Webview UI controls

- **Instrument preset** dropdown (the table above). Selecting a preset fills the per-string note dropdowns and sets the fret count to the preset default.
- **Per-string note dropdowns**, shown low→high like a tab clef header, each a note picker (e.g. `C1`–`C6`). **+ / −** buttons add/remove a string (range 4–8). Editing any string note flips the preset selector to "Custom".
- **Fret count** number input (range 12–30, default from preset). Changing it alone does not flip the preset to "Custom" — it is orthogonal to the tuning's note identity.
- **Quantize grid** select: Off / 1/4 / 1/8 / 1/16 / 1/32 (default 1/16).
- **Export** menu: checkboxes for PDF / ASCII / alphaTex plus an Export button.
- **Staleness banner** (reused) if the clip fingerprint differs from the last export.
- **Warnings notice** (non-blocking): `tutts` silently skips chords it cannot fit on the fretboard, and `toAlphaTex` returns `warnings`. Surface them so dropped notes are not a silent surprise.

### Exports

- **PDF** — rasterize each rendered AlphaTab SVG (with the Bravura `@font-face` embedded inline so the SMuFL glyphs survive off-DOM rasterization) onto a canvas, place the images into a jsPDF page with a provenance footer (clip name, tempo, tuning), emit base64. *(Implementation note: this is a raster PDF, not the `svg2pdf.js` vector path the brainstorm first sketched — embedding a SMuFL font into jsPDF for faithful vector output is out of scope for v1, and rasterizing the already-rendered SVG guarantees every glyph appears. `svg2pdf.js` is therefore not a dependency. See the plan's "Deviations" section.)*
- **ASCII** — `tab.toAscii()` from `@tutts/core`, emitted as UTF-8 text.
- **alphaTex** — the `tex` string from `toAlphaTex`, emitted as UTF-8 text.

Exported file names derive from the clip name (e.g. `Verse.pdf`, `Verse.txt`, `Verse.alphatex.txt`).

## Data flow

1. User right-clicks a MIDI clip → "Show Tab".
2. Extension reads the clip + song context, coerces BigInt→number, builds `TabPayload`, injects it into the bundled HTML, writes to temp, opens the modal.
3. Webview parses the payload, restores the persisted settings, builds the tuning, runs the `tutts` pipeline, and renders the tab.
4. User adjusts preset / tuning / strings / frets / quantize → pipeline re-runs and re-renders.
5. User selects export formats and clicks Export → webview produces the files and `postResult({ files, settings, fingerprint })`.
6. Extension writes the files to `storageDir/tabs/`, persists settings + last-export fingerprint, and reveals the first file in Finder.

## Error handling

- **Empty clip** → log and no-op (reused).
- **Out-of-range pitches** → `tutts` folds them into the instrument's range automatically.
- **Unplayable chords** → `tutts` skips them; the adapter reports `warnings`, surfaced in the UI as a non-blocking notice.
- **AlphaTab render error** → caught and shown inline in the webview (not a blank dialog).
- **File-write / Finder-reveal errors** → caught and logged on the Node side (reused).

## Dependencies

Runtime:

- `@tutts/core`, `@tutts/alphatab` — referenced via **`file:../tutts/packages/core` and `file:../tutts/packages/alphatab` during development**. These switch to published npm version ranges (`^x.y`) before release; that is a one-line change per dependency.
- `@coderline/alphatab` (^1.6.0) — renderer.
- `jspdf` — PDF export (raster; see the Exports note — `svg2pdf.js` is not used).
- `@ableton-extensions/sdk` — vendored tarball, same as the sheet music extension.

Dev: `@ableton-extensions/cli` (vendored), `vite`, `vite-plugin-singlefile`, `esbuild`, `tsx`, `typescript`, `vitest`.

The Bravura font (from `@coderline/alphatab`'s distribution) is copied into the project and bundled as a data URI for offline rendering.

## Testing

- **Unit tests (pure, run anywhere):** `instruments.ts` (each preset's string names are valid and build a usable `Tuning`; string counts within 4–8), plus the copied `notes.ts` and `fingerprint.ts` tests.
- **Integration test (needs `tutts`):** sample notes → `generateTab` → `toAlphaTex` produces non-empty `tex`. Guards the wiring without a DOM. Runs locally where the `tutts` sibling is resolvable.
- **Not automated:** AlphaTab SVG rendering is DOM-dependent and verified by `ui/tsconfig` type-check plus a manual run in Live — the same posture the sheet music extension takes toward OSMD.
- **`tutts` itself** already unit-tests the fingering, rhythm, and ASCII logic; the extension depends on it rather than re-testing it.

**CI.** Mirrors the sheet music workflow: drop the vendored SDK dependency, run the pure unit tests, and type-check + build the UI. Because `tutts` is referenced by local path during development, the `tutts`-dependent integration test and the full UI build run in CI only once `tutts` is published to npm (or the sibling repo is checked out alongside); until then they are local-only. This limitation is removed by the same npm switch noted under Dependencies.

## Open questions

None outstanding. Decisions settled during brainstorming:

- Tab-only rendering (no standard notation staff).
- Presets: Standard Guitar, Bass (4-string), Ukulele, 7-String, Drop D, DADGAD, Open G, plus Custom.
- Exports: PDF, ASCII, alphaTex (no PNG).
- Tuning entry: per-string note dropdowns with +/− string controls.
- Fret count: a UI control (default per preset).
- Difficulty weights: hidden in v1.
- `tutts` dependency: `file:` path in dev, npm before release.
