# ASCII Tab Rendering — Design

**Date:** 2026-06-06
**Status:** Approved for planning
**Author:** Madison Rickert (with Claude)

## Overview

Replace the extension's graphical rendering engine ([AlphaTab](https://alphatab.net/)) with a lightweight **ASCII tablature** renderer. The webview shows the tab as monospace text instead of an SVG score, PDF export becomes vector monospace text, and the entire SMuFL-font toolchain is removed. The rendering improvements live in the project's own [`@tutts/core`](../../../../tutts/) library, where the ASCII renderer already exists; the extension is reduced to wiring that text into the view and the exporters.

This supersedes the AlphaTab font work done earlier on 2026-06-06 (Bravura embed + subset). That work correctly diagnosed *why* AlphaTab is the wrong fit here — it drags in a ~1.1 MB notation/audio engine and a music-glyph font for output we don't need — which motivated this pivot.

## Motivation

- **AlphaTab is overkill.** We use only `AlphaTexImporter` + the SVG `ScoreRenderer`, but bundle the whole engine (~1.1 MB minified) plus a SMuFL font (embedded as a data URI). The rendered output is tab-only.
- **The font was the bug.** AlphaTab's low-level SVG path emits music glyphs under a CSS class with no bound font, so SMuFL symbols rendered as tofu. Fixing it required embedding/subsetting Bravura — complexity that exists only to draw glyphs we can render as plain ASCII.
- **The data is already structured.** `@tutts/core` produces a complete `TabData` model and an ASCII renderer (`renderLines` → `toLines`/`toAscii`). The hard musical work (fingering via Viterbi, measure/timeline construction) is done; only the text layout needs polish.

## Goals

- The webview renders tab as **monospace ASCII text**, no graphical engine.
- Improve the `@tutts/core` ASCII renderer: **system wrapping** (line-length control), **time-signature display**, and a **uniform beat-cell width** fix so multi-digit frets don't skew columns.
- PDF export is **vector monospace text** (jsPDF built-in Courier) — crisp, paginated, no rasterization, no embedded font.
- Exports are **PDF** and **ASCII `.txt`**.
- Remove `@coderline/alphatab`, `@tutts/alphatab`, the Bravura font module, and the font-embedding scripts.

## Non-goals

- **Rhythm notation** (stems, beams, flags, rests-as-glyphs). Fret-numbers-on-strings only.
- **A `TAB` clef.** The string-name header (`E B G D A E`) stays.
- **alphaTex export.** Cut. (The `.txt` ASCII export already exists and stays.)
- **Flat/fixed-width spacing.** Spacing stays proportional to duration, as today (see Assumptions).
- Editing the tab in the webview. It remains a read/render/export surface.

## Architecture

```
@tutts/core (Madison's lib)          extension/ui (this repo)
─────────────────────────            ──────────────────────────
generateTab(input) ─► GeneratedTab   tab-pipeline.ts: notes ─► GeneratedTab
  .data: TabData                       (no more toAlphaTex / tex)
  .toSystems(opts) ─► string[][]  ┐
  .toLines(opts)   ─► string[]    ├─► render.ts: toLines({maxWidth}) ─► <pre>
  .toAscii(opts)   ─► string      ┘   pdf.ts:     toSystems(opts) ─► jsPDF text
                                       export.ts:  asciiFile (.txt)
renderAsciiTab(data,tuning,opts)
  (exported; the engine behind
   the three GeneratedTab methods)
```

The renderer is the single source of layout truth; the view and PDF consume the same wrapped systems so they always agree.

## `@tutts/core` renderer changes

The current renderer is `function renderLines(data, tuning): string[]` (one unwrapped block of one line per string), surfaced as `GeneratedTab.toLines()` / `toAscii()`. It already emits fret numbers, the string-name header (`E ||`), proportional 16th-note dash spacing, and per-measure barlines (`|`).

### Options contract

```ts
export interface AsciiRenderOptions {
  /** Wrap into stacked systems no wider than this many columns.
   *  Omitted or 0 ⇒ a single unwrapped system (current behavior). */
  maxWidth?: number;
  /** Render the time signature at the first system and at each change.
   *  Default false (preserves current output). */
  timeSignature?: boolean;
}

/** The render engine. Returns one block of text lines per system. */
export function renderAsciiTab(
  data: TabData,
  tuning: Tuning,
  opts?: AsciiRenderOptions,
): string[][];

export interface GeneratedTab {
  data: TabData;
  toSystems(opts?: AsciiRenderOptions): string[][]; // for paginated consumers (PDF)
  toLines(opts?: AsciiRenderOptions): string[];     // systems flattened, blank line between
  toAscii(opts?: AsciiRenderOptions): string;       // toLines().join("\n")
}
```

**Backward compatibility:** `toLines()` / `toAscii()` with no options must produce today's output (modulo the uniform-cell fix, which only changes measures that contain multi-digit frets). Existing `@tutts` tests that use single-digit frets stay green; any multi-digit snapshot tests get updated as part of this work.

### Feature 1 — uniform beat-cell width (the "fix it" item)

Today each fret is appended at its natural digit width and `fillMeasureStr` pads the *other* strings to match, so cross-string columns already align. What drifts is the **beat grid**: a 2-digit fret occupies two columns while a 1-digit fret occupies one, so successive beats sit at uneven x-positions within a measure.

Fix: compute `W = max fret-digit-width across the whole tab` (typically 1 or 2). Each note-event occupies a cell exactly `W` wide — the fret left-justified, padded with trailing dashes (`"8"` → `"8-"` when `W = 2`; `"10"` → `"10"`). Strings with no note this event get `W` dashes. Proportional inter-event spacing is unchanged. Result: every beat cell is the same width, so the grid is clean regardless of digit count. When `W = 1` (all single-digit), output is byte-identical to today.

### Feature 2 — system wrapping

Render each measure as a measure-block (one dash/fret string per string, no header), and record its width. Greedily pack measure-blocks into systems: open a system, append measure-blocks separated by `|` while the running width (including the header column and a leading `|`) stays ≤ `maxWidth`; when the next measure would overflow, close the system and open a new one with the header repeated. A measure wider than `maxWidth` on its own takes a system and overflows (measures are never split). Each system ends with a trailing `|`. With no `maxWidth`, everything packs into one system (current behavior).

### Feature 3 — time signature

When `timeSignature: true`, insert a time-signature column immediately after the header `||` on the first system and at any `timeSignatureChange`. It is `max(len(numerator), len(denominator))` columns wide: the numerator on the upper-center string row, the denominator on the lower-center string row, dashes on the other rows (the conventional two-row stack). The time signature is read from the events' `timeSignatureChange` / the tab's measure grid.

## Extension changes (`ui/`)

- **`tab-pipeline.ts`** — drop `toAlphaTex`; `PipelineOutput` loses `tex`, keeps `tab` + `warnings`.
- **`render.ts`** — collapses to: derive `maxWidth` from the `#score` container width (container px ÷ monospace char width, less a margin), call `tab.toLines({ maxWidth, timeSignature: true })`, and set it as the `textContent` of a monospace `<pre>` inside `#score`. Re-render on container resize. No AlphaTab, no `FontFace`, no SVG.
- **`pdf.ts`** — rewrite to vector text: jsPDF (`unit: pt`, A4 portrait), built-in Courier at a fixed size; for each system from `tab.toSystems({ maxWidth: <cols that fit the page>, timeSignature: true })`, draw its lines, advance `y`, paginate on overflow; keep the provenance footer. No canvas, no `Image`, no font embedding. `ExportedFile` shape is unchanged.
- **`export.ts`** — keep `asciiFile` (`.txt`); remove `alphatexFile`.
- **`main.ts`** — remove the alphaTex export checkbox/wiring; the export set is `{ pdf, ascii }`. Keep the existing export error boundary and `showError`/warning surfacing.

### Deletions

- Dependency `@coderline/alphatab` and `@tutts/alphatab` (from `package.json`).
- `ui/src/bravura-font.ts`, `ui/src/music-font.ts`, `ui/src/music-font.test.ts`.
- `scripts/embed-font.mjs`, `scripts/subset-font.py`, the `embed-font` npm script.
- `alphatexFile` and its test cases in `export.test.ts`.
- AlphaTab/font references in `README.md` and the manifest's command table where applicable.

`jspdf` stays (vector PDF). `@tutts/core` stays.

## Data flow

1. Node side opens the modal with the clip payload (unchanged).
2. `runPipeline` builds a `Tuning`, calls `generateTab` → `GeneratedTab` (no alphaTex step).
3. **View:** `render.ts` calls `tab.toLines({ maxWidth, timeSignature: true })` and writes it into a `<pre>`.
4. **Export:** `asciiFile` uses `tab.toAscii(...)`; `pdfFile` uses `tab.toSystems(...)` → jsPDF text.

## Error handling

- **Empty clip / no notes:** the renderer returns header + empty barred staff lines; the view shows that, PDF shows it with the footer. No throw.
- **`maxWidth` smaller than a single measure:** that measure overflows its own system (logged once); never split.
- **PDF:** keep the current export error boundary so a failed build surfaces a message instead of a broken download.
- The renderer is pure and total over valid `TabData`; it does not depend on the DOM, so it is fully node-testable.

## Testing

**`@tutts/core`:**
- Uniform cell width: a measure mixing 1- and 2-digit frets yields equal-width beat cells; an all-single-digit tab is byte-identical to the pre-change output (regression lock).
- Wrapping: with a `maxWidth`, no system exceeds it except a lone over-wide measure; no measure is split across systems; headers repeat per system.
- Time signature: present on system 1 and at a change; absent by default.

**Extension:**
- Keep `tab-pipeline.integration.test.ts` (drop its alphaTex assertions).
- PDF builder: given known systems, asserts the expected jsPDF `text` calls / page breaks (no DOM image path).
- ASCII view: `render.ts` writes the wrapped text into the `<pre>`.
- **Visual confirmation:** render a real sample into the webview and a sample PDF; screenshot both to confirm legibility and wrapping.

## Assumptions (flagged for review)

- **Proportional spacing is kept.** The fidelity choice was "fret numbers only," described as "roughly today's output"; today's output is proportional (16th-note dash resolution). This design keeps proportional spacing and only cleans up cell width. If flat fixed-width spacing is preferred instead, the uniform-cell feature becomes the *whole* spacing model and Feature 1's "proportional inter-event spacing unchanged" clause is dropped.
- **Time-signature placement** uses the two-center-row stack inside the staff. A separate label line above each system is the alternative if that reads better.
- **`maxWidth` derivation** in the view assumes a measurable monospace character width; a fixed fallback (e.g., 90 columns) is used if measurement isn't available before first paint.
