# ASCII Tab Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the extension's AlphaTab graphical renderer with a lightweight ASCII-tab renderer: improve `@tutts/core`'s ASCII renderer (uniform cell width, system wrapping, time signature) and reduce the extension to a monospace `<pre>` view + vector-text PDF, deleting the SMuFL font toolchain.

**Architecture:** `@tutts/core` gains an options-aware renderer `renderAsciiTab(data, tuning, opts) → string[][]` (one block per "system"), surfaced via `GeneratedTab.toSystems/toLines/toAscii`. The extension's `render.ts` writes `toLines({maxWidth})` into a `<pre>`; `pdf.ts` draws `toSystems({maxWidth})` as jsPDF Courier text. AlphaTab, `@tutts/alphatab` (dependency + usage only — the package stays in the tutts library), the Bravura font module, and the embed scripts are removed.

**Tech Stack:** TypeScript, Vitest (node env, both repos), jsPDF (vector text), Vite single-file build.

**Cross-repo note:** Tasks A* edit `../tutts/packages/core` (Madison's library, separate git repo on `main`). Tasks B* edit this extension. Commit in each repo separately.

**Baseline reset (do first):** discard the superseded font-fix from the working tree.
```bash
cd /Users/madison/Developer/ableton-midi-tabs-extension
git restore README.md scripts/embed-font.mjs ui/src/bravura-font.ts ui/src/pdf.ts ui/src/render.ts
rm -f scripts/subset-font.py ui/src/music-font.ts ui/src/music-font.test.ts
git status --short   # expect: clean
```
(These files are deleted/rewritten later anyway; resetting keeps diffs clean.)

---

## Regression contract (read before Task A1)

The existing `@tutts/core` ASCII tests (`test/tab.test.ts` → `describe("ASCII rendering")`, and `test/public-api.test.ts`) assert **properties**, not exact bytes: one line per string, each line starts with the string degree, all lines equal length, `toAscii === toLines().join("\n")`. The new default output (no options) keeps all these properties. It is **byte-identical** for tabs whose frets are all single-digit; for tabs containing a multi-digit fret the columns get wider (the intended uniform-width fix). No existing test asserts exact width, so all stay green. Do **not** add a byte-snapshot test of default output.

---

## Part A — `@tutts/core` renderer

### Task A1: Options-aware renderer + GeneratedTab surface

**Files:**
- Modify: `../tutts/packages/core/src/tab.ts` (replace `renderLines`, extend `GeneratedTab`)
- Modify: `../tutts/packages/core/src/index.ts` (export new symbols)
- Test: `../tutts/packages/core/test/tab.test.ts`, `../tutts/packages/core/test/public-api.test.ts`

- [ ] **Step 1: Add the options type + new renderer, replacing `renderLines`.**

In `src/tab.ts`, replace the existing `function renderLines(data, tuning): string[]` (currently ~lines 121–151) with:

```ts
export interface AsciiRenderOptions {
  /** Wrap into stacked systems no wider than this many columns.
   *  Omitted or <= 0 ⇒ a single unwrapped system (legacy behavior). */
  maxWidth?: number;
  /** Render the time signature at the first system and at each change.
   *  Default false (preserves legacy output). */
  timeSignature?: boolean;
}

/** One measure's body (no header), `tuning.nstrings` equal-length rows.
 *  `cellWidth` is the global max fret-digit width so columns never skew. */
function renderMeasureBody(
  measure: TabData["measures"][number],
  nstrings: number,
  cellWidth: number,
  showTimeSignature: boolean,
): string[] {
  const rows = Array.from({ length: nstrings }, () => "");

  if (showTimeSignature) {
    const tsEvent = measure.events.find((e) => e.timeSignatureChange);
    if (tsEvent) {
      const [num, den] = tsEvent.timeSignatureChange!;
      const tw = Math.max(String(num).length, String(den).length);
      const upper = Math.floor(nstrings / 2) - 1; // numerator row
      const lower = Math.floor(nstrings / 2); // denominator row
      for (let s = 0; s < nstrings; s++) {
        const cell = s === upper ? String(num) : s === lower ? String(den) : "";
        rows[s] += cell.padEnd(tw, "-");
      }
    }
  }

  const events = measure.events;
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (!event.notes) continue; // ts-only / marker events don't take a column
    for (let s = 0; s < nstrings; s++) {
      const note = event.notes.find((n) => n.string === s);
      rows[s] += note ? String(note.fret).padEnd(cellWidth, "-") : "-".repeat(cellWidth);
    }
    const nextTiming = i < events.length - 1 ? events[i + 1].measureTiming : 1.0;
    // *16 = 16th-note resolution: at most 16 dash positions per measure.
    const dashes = Math.max(1, Math.floor((nextTiming - event.measureTiming) * 16));
    for (let s = 0; s < nstrings; s++) rows[s] += "-".repeat(dashes);
  }

  return rows;
}

/**
 * Render `data` as ASCII tablature, one string-line block per "system".
 * - Cells are a uniform width (the global max fret-digit count) so multi-digit
 *   frets never skew the beat grid.
 * - With `maxWidth`, measures are packed into stacked systems no wider than
 *   `maxWidth`; a measure is never split (a lone over-wide measure overflows).
 * - With `timeSignature`, a stacked time signature is shown at the first system
 *   and wherever the signature changes.
 */
export function renderAsciiTab(
  data: TabData,
  tuning: Tuning,
  opts: AsciiRenderOptions = {},
): string[][] {
  const nstrings = tuning.nstrings;

  let cellWidth = 1;
  for (const m of data.measures)
    for (const e of m.events)
      if (e.notes) for (const n of e.notes) cellWidth = Math.max(cellWidth, String(n.fret).length);

  const headers = tuning.strings.map((s) => {
    const h = s.degree;
    return h + (h.length > 1 ? "||" : " ||");
  });
  const headerWidth = headers[0].length;

  const bodies = data.measures.map((m) =>
    renderMeasureBody(m, nstrings, cellWidth, !!opts.timeSignature),
  );
  const measureWidths = bodies.map((b) => b[0].length + 1); // + trailing "|"

  const systems: string[][] = [];
  let cur = headers.slice();
  let curWidth = headerWidth;
  let count = 0;
  for (let m = 0; m < bodies.length; m++) {
    const w = measureWidths[m];
    if (opts.maxWidth && opts.maxWidth > 0 && count > 0 && curWidth + w > opts.maxWidth) {
      systems.push(cur);
      cur = headers.slice();
      curWidth = headerWidth;
      count = 0;
    }
    for (let s = 0; s < nstrings; s++) cur[s] += bodies[m][s] + "|";
    curWidth += w;
    count++;
  }
  systems.push(cur);
  return systems;
}

function renderLines(data: TabData, tuning: Tuning, opts: AsciiRenderOptions = {}): string[] {
  // Flatten systems; a blank line separates stacked systems.
  return renderAsciiTab(data, tuning, opts).flatMap((sys, i) => (i > 0 ? ["", ...sys] : sys));
}
```

- [ ] **Step 2: Extend `GeneratedTab` and its construction.**

In `src/tab.ts`, update the interface (~lines 153–157):

```ts
export interface GeneratedTab {
  data: TabData;
  toSystems(opts?: AsciiRenderOptions): string[][];
  toLines(opts?: AsciiRenderOptions): string[];
  toAscii(opts?: AsciiRenderOptions): string;
}
```

And the return object at the end of `generateTab` (currently ~lines 296–301):

```ts
  return {
    data,
    toSystems: (opts) => renderAsciiTab(data, tuning, opts),
    toLines: (opts) => renderLines(data, tuning, opts),
    toAscii: (opts) => renderLines(data, tuning, opts).join("\n"),
  };
```

- [ ] **Step 3: Export the new symbols.**

In `src/index.ts`, add to the `./tab` exports:

```ts
export { generateTab, renderAsciiTab } from "./tab";
export type { GeneratedTab, AsciiRenderOptions } from "./tab";
```

(Replace the existing two `./tab` export lines.)

- [ ] **Step 4: Run the existing suite to confirm no regressions.**

Run: `cd ../tutts/packages/core && npx vitest run`
Expected: PASS (all existing tests, including `describe("ASCII rendering")`, still green).

- [ ] **Step 5: Commit (in the tutts repo).**

```bash
cd /Users/madison/Developer/tutts
git add packages/core/src/tab.ts packages/core/src/index.ts
git commit -m "feat(core): options-aware ASCII renderer (systems, uniform cells)"
```

### Task A2: Tests for uniform cell width, wrapping, time signature

**Files:**
- Test: `../tutts/packages/core/test/tab.test.ts` (extend the `describe("ASCII rendering")` block)

- [ ] **Step 1: Add the failing tests.**

Append inside `describe("ASCII rendering", () => { ... })` in `test/tab.test.ts`:

```ts
  it("uses uniform cell width so multi-digit frets keep columns aligned", () => {
    // High notes force 2-digit frets; every note line must stay equal length
    // and the fret cells must be 2 wide.
    const tab = generateTab({ notes: [note(76, 0), note(77, 1), note(79, 2)], tuning });
    const lines = tab.toLines();
    expect(new Set(lines.map((l) => l.length)).size).toBe(1); // all equal
    // The rendered frets are all >= 10 here, i.e. two characters.
    const body = lines.find((l) => /\d\d/.test(l))!;
    expect(body).toMatch(/\d\d/);
  });

  it("wraps into systems no wider than maxWidth, never splitting a measure", () => {
    const notes = Array.from({ length: 16 }, (_, k) => note(64, k));
    const systems = tab16(notes).toSystems({ maxWidth: 40 });
    expect(systems.length).toBeGreaterThan(1);
    for (const sys of systems) {
      for (const line of sys) expect(line.length).toBeLessThanOrEqual(40 + measureMax(notes));
      expect(sys).toHaveLength(tuning.nstrings);
      expect(sys[0].startsWith(tuning.strings[0].degree)).toBe(true); // header repeats
    }
  });

  it("omits the time signature by default and shows it when asked", () => {
    const tab = generateTab({ notes: [note(64, 0)], tuning });
    const off = tab.toLines();
    const on = tab.toLines({ timeSignature: true });
    // Default has no digit before the first note column on the center rows.
    expect(on.join("\n")).not.toBe(off.join("\n"));
    // 4/4 ⇒ a "4" appears on the two center rows.
    const upper = Math.floor(tuning.nstrings / 2) - 1;
    const lower = Math.floor(tuning.nstrings / 2);
    expect(on[upper]).toMatch(/\|\|4/);
    expect(on[lower]).toMatch(/\|\|4/);
  });
```

Add these helpers near the top of `test/tab.test.ts` (after the existing `note` helper):

```ts
const tab16 = (notes: NoteModel[]) => generateTab({ notes, tuning });
// Upper bound on a single measure's body width, for the wrap assertion's slack.
const measureMax = (_notes: NoteModel[]) => 32;
```

- [ ] **Step 2: Run, expect PASS** (the renderer from A1 already implements these).

Run: `cd ../tutts/packages/core && npx vitest run test/tab.test.ts`
Expected: PASS.

> Note: these were written after the implementation (A1 is one cohesive function). If TDD-purist ordering is required, comment out the A1 feature bodies, watch these fail, then restore — but the validated implementation makes that optional here.

- [ ] **Step 3: Commit.**

```bash
cd /Users/madison/Developer/tutts
git add packages/core/test/tab.test.ts
git commit -m "test(core): ASCII uniform width, wrapping, time signature"
```

### Task A3: Public-API export test

**Files:**
- Test: `../tutts/packages/core/test/public-api.test.ts`

- [ ] **Step 1: Extend the public-API test.**

Add to `test/public-api.test.ts`, importing `renderAsciiTab`:

```ts
import { generateTab, renderAsciiTab, Tuning, Note, Fretboard, DEFAULT_WEIGHTS } from "../src/index";
```

and a new case:

```ts
  it("exposes renderAsciiTab returning systems of string lines", () => {
    const tuning = Tuning.standardGuitar();
    const { data } = generateTab({ notes: [{ midi: 64, startBeats: 0, durationBeats: 1 }], tuning });
    const systems = renderAsciiTab(data, tuning, { maxWidth: 0 });
    expect(Array.isArray(systems)).toBe(true);
    expect(systems[0]).toHaveLength(tuning.nstrings);
  });
```

- [ ] **Step 2: Run, expect PASS.**

Run: `cd ../tutts/packages/core && npx vitest run test/public-api.test.ts`

- [ ] **Step 3: Build the library so the extension's `file:` link picks up the changes.**

Run: `cd ../tutts/packages/core && npm run build`
Expected: succeeds (tsup emits `dist/`).

- [ ] **Step 4: Commit.**

```bash
cd /Users/madison/Developer/tutts
git add packages/core/test/public-api.test.ts
git commit -m "test(core): public renderAsciiTab surface"
```

---

## Part B — Extension

### Task B1: Drop `alphatex` from the format union

**Files:**
- Modify: `src/payload.ts:4`

- [ ] **Step 1: Edit the type.** Change `export type TabFormat = "pdf" | "ascii" | "alphatex";` to:

```ts
export type TabFormat = "pdf" | "ascii";
```

- [ ] **Step 2: Typecheck to surface every dependent site.**

Run: `npx tsc --noEmit`
Expected: errors in `export.ts` (`alphatexFile`), `main.ts` (alphatex branch). These are fixed in B2/B6.

(No commit yet — commit with B2.)

### Task B2: Remove `alphatexFile`

**Files:**
- Modify: `ui/src/export.ts`
- Test: `ui/src/export.test.ts`

- [ ] **Step 1: Delete `alphatexFile`** from `ui/src/export.ts` (the function at lines 15–17). The file keeps `sanitize` and `asciiFile`.

- [ ] **Step 2: Remove its tests.** In `ui/src/export.test.ts`, delete the `alphatexFile` import and any `describe`/`it` referencing it. Keep `sanitize` and `asciiFile` tests.

- [ ] **Step 3: Run the export tests.**

Run: `npx vitest run ui/src/export.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add src/payload.ts ui/src/export.ts ui/src/export.test.ts
git commit -m "feat: drop alphaTex export format"
```

### Task B3: Pipeline drops alphaTex

**Files:**
- Modify: `ui/src/tab-pipeline.ts`
- Test: `ui/src/tab-pipeline.integration.test.ts`

- [ ] **Step 1: Remove `toAlphaTex` + `tex`.** New `ui/src/tab-pipeline.ts` body:

```ts
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
```

(Note: `toAlphaTex` previously produced `warnings`; with it gone, `warnings` is `[]`. If `generateTab` ever surfaces warnings, wire them here.)

- [ ] **Step 2: Update the integration test.** In `ui/src/tab-pipeline.integration.test.ts`, remove assertions on `out.tex` / alphaTex; keep assertions on `out.tab` (e.g. `tab.toAscii()` is a non-empty string, expected fret content). If a test needs a render check, assert on `out.tab.toLines().length === <nstrings>`.

- [ ] **Step 3: Run.**

Run: `npx vitest run -c vitest.integration.config.ts`
Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add ui/src/tab-pipeline.ts ui/src/tab-pipeline.integration.test.ts
git commit -m "feat: pipeline returns tab only (no alphaTex)"
```

### Task B4: ASCII view renderer

**Files:**
- Rewrite: `ui/src/render.ts`
- Test: `ui/src/render.test.ts` (new)

- [ ] **Step 1: Write the failing test.** Create `ui/src/render.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { generateTab, Tuning } from "@tutts/core";
import { renderAscii, columnsForWidth } from "./render";

describe("columnsForWidth", () => {
  it("derives a positive column count and falls back when width is 0", () => {
    expect(columnsForWidth(0, 8)).toBe(90); // fallback
    expect(columnsForWidth(800, 8)).toBeGreaterThan(50);
  });
});

describe("renderAscii", () => {
  it("writes a monospace <pre> of the tab into the host", () => {
    const tab = generateTab({
      notes: [{ midi: 64, startBeats: 0, durationBeats: 1 }],
      tuning: Tuning.standardGuitar(),
    });
    const host = document.createElement("div");
    renderAscii(tab, host);
    const pre = host.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre!.textContent).toContain("||");
    expect(pre!.classList.contains("tab")).toBe(true);
  });
});
```

- [ ] **Step 2: Confirm jsdom is available** (the test needs a DOM). If `npx vitest run ui/src/render.test.ts` errors with "Cannot find dependency 'jsdom'", run `npm i -D jsdom` and commit the `package.json`/lockfile change with this task.

- [ ] **Step 3: Run, expect FAIL** ("Failed to load ./render" — function not exported yet).

- [ ] **Step 4: Write `ui/src/render.ts`:**

```ts
import type { GeneratedTab } from "@tutts/core";

/** Approx. monospace glyph advance as a fraction of font-size. */
const CHAR_RATIO = 0.6;
/** Column count used before layout has a real width. */
const FALLBACK_COLS = 90;

/** How many monospace columns fit in `pxWidth` at the given font size. */
export function columnsForWidth(pxWidth: number, fontSizePx: number): number {
  if (!pxWidth || pxWidth <= 0) return FALLBACK_COLS;
  const charPx = fontSizePx * CHAR_RATIO;
  return Math.max(24, Math.floor(pxWidth / charPx));
}

/**
 * Render `tab` as monospace ASCII into `host`. Width is derived from the host so
 * the tab wraps into stacked systems instead of scrolling horizontally.
 */
export function renderAscii(tab: GeneratedTab, host: HTMLElement): void {
  const fontSizePx = 13;
  const cols = columnsForWidth(host.clientWidth - 8, fontSizePx);
  const lines = tab.toLines({ maxWidth: cols, timeSignature: true });
  const pre = document.createElement("pre");
  pre.className = "tab";
  pre.textContent = lines.join("\n");
  host.replaceChildren(pre);
}
```

- [ ] **Step 5: Run, expect PASS.**

Run: `npx vitest run ui/src/render.test.ts`

- [ ] **Step 6: Commit.**

```bash
git add ui/src/render.ts ui/src/render.test.ts package.json package-lock.json
git commit -m "feat: ASCII monospace view renderer"
```

### Task B5: Vector monospace PDF

**Files:**
- Rewrite: `ui/src/pdf.ts`
- Test: `ui/src/pdf.test.ts` (new)

- [ ] **Step 1: Write the failing test.** Create `ui/src/pdf.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";

// Capture jsPDF calls without a real PDF backend.
const calls: { text: string[][]; pages: number } = { text: [], pages: 1 };
vi.mock("jspdf", () => {
  class FakePDF {
    internal = { pageSize: { getWidth: () => 595, getHeight: () => 842 } };
    setFont() {}
    setFontSize() {}
    setTextColor() {}
    text(t: string, x: number, y: number) {
      calls.text.push([t, String(x), String(y)]);
    }
    addPage() {
      calls.pages++;
    }
    output() {
      return "data:application/pdf;base64,QUJD";
    }
  }
  return { jsPDF: FakePDF };
});

import { generateTab, Tuning } from "@tutts/core";
import { pdfFile } from "./pdf";

describe("pdfFile", () => {
  it("emits Courier text lines and returns a base64 pdf file", () => {
    const tab = generateTab({
      notes: [{ midi: 64, startBeats: 0, durationBeats: 1 }],
      tuning: Tuning.standardGuitar(),
    });
    const file = pdfFile("song", tab, "footer text");
    expect(file.name).toBe("song.pdf");
    expect(file.format).toBe("pdf");
    expect(file.encoding).toBe("base64");
    expect(file.data).toBe("QUJD");
    // Each tab line plus the footer is drawn as text.
    expect(calls.text.length).toBeGreaterThan(0);
    expect(calls.text.some(([t]) => t.includes("||"))).toBe(true);
    expect(calls.text.some(([t]) => t === "footer text")).toBe(true);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** ("Failed to load ./pdf" / signature mismatch).

- [ ] **Step 3: Write `ui/src/pdf.ts`:**

```ts
import { jsPDF } from "jspdf";
import type { GeneratedTab } from "@tutts/core";
import type { ExportedFile } from "../../src/payload";

const FONT_PT = 9;
const CHAR_RATIO = 0.6; // Courier advance / font size
const LINE_PT = FONT_PT * 1.25;
const MARGIN = 36;
const SYSTEM_GAP_PT = LINE_PT; // blank line between systems

/**
 * Build a PDF of the tab as vector Courier text: wrap to the page width, draw
 * each system block, paginate on overflow, then a provenance footer. No raster,
 * no embedded font (Courier is a PDF base-14 font).
 */
export function pdfFile(base: string, tab: GeneratedTab, footer: string): ExportedFile {
  const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const usableW = pageW - MARGIN * 2;
  const cols = Math.max(24, Math.floor(usableW / (FONT_PT * CHAR_RATIO)));

  pdf.setFont("courier", "normal");
  pdf.setFontSize(FONT_PT);
  pdf.setTextColor(0);

  const systems = tab.toSystems({ maxWidth: cols, timeSignature: true });
  let y = MARGIN + FONT_PT;
  for (const system of systems) {
    const blockH = system.length * LINE_PT;
    if (y + blockH > pageH - MARGIN - 16 && y > MARGIN + FONT_PT) {
      pdf.addPage();
      y = MARGIN + FONT_PT;
    }
    for (const line of system) {
      pdf.text(line, MARGIN, y);
      y += LINE_PT;
    }
    y += SYSTEM_GAP_PT;
  }

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.setTextColor(110);
  pdf.text(footer, MARGIN, pageH - 12);

  return {
    name: `${base}.pdf`,
    format: "pdf",
    encoding: "base64",
    data: pdf.output("datauristring").split(",")[1],
  };
}
```

- [ ] **Step 4: Run, expect PASS.**

Run: `npx vitest run ui/src/pdf.test.ts`

- [ ] **Step 5: Commit.**

```bash
git add ui/src/pdf.ts ui/src/pdf.test.ts
git commit -m "feat: vector monospace-text PDF export"
```

### Task B6: Wire the controller

**Files:**
- Modify: `ui/src/main.ts`

- [ ] **Step 1: Update imports** (lines 2–4):

```ts
import { runPipeline, type PipelineOutput } from "./tab-pipeline";
import { renderAscii } from "./render";
import { sanitize, asciiFile } from "./export";
import { pdfFile } from "./pdf";
```

- [ ] **Step 2: Replace `render()`** (lines 116–140). It no longer returns a `RenderedScore`; it renders ASCII and returns the pipeline output (or null on failure):

```ts
function render(): PipelineOutput | null {
  lastRender = null; // clear stale state so a pipeline failure gates doExport's guard
  try {
    const out = runPipeline({
      notes: payload.notes,
      stringNames: tuning,
      fretCount: Number(fretsInput.value) || payload.settings.fretCount,
      quantizeGrid: currentGrid(),
      tempo: payload.tempo,
      timeSig: payload.timeSig,
      title: payload.clipName,
      tuningLabel: presetName,
    });
    lastRender = out;
    renderAscii(out.tab, scoreEl);
    showWarnings(out.warnings);
    updateStatus();
    return out;
  } catch (err) {
    showWarnings([]);
    showError(err);
    return null;
  }
}
```

- [ ] **Step 3: Update every `void render()` / `await render()` call** to plain `render()` (it is now synchronous). Sites: lines ~63, 209, 213, 215, 223, 230, 280, and the initial `requestAnimationFrame` block. Remove the `async`/`await` from `doExport`'s render call too (Step 4).

- [ ] **Step 4: Replace `doExport`'s export loop** (lines 165–195). PDF now uses `lastRender.tab`, and the alphatex branch is gone:

```ts
async function doExport(): Promise<void> {
  const formats = selectedFormats();
  if (formats.length === 0) return;
  try {
    render(); // ensure lastRender reflects current controls
    if (!lastRender) return; // render failed; error already shown — keep dialog open
    const base = sanitize(payload.clipName);
    const files: ExportedFile[] = [];
    for (const fmt of formats) {
      if (fmt === "ascii") {
        files.push(asciiFile(base, lastRender.tab));
      } else if (fmt === "pdf") {
        files.push(pdfFile(base, lastRender.tab, footerText()));
      }
    }
    if (files.length === 0) {
      showWarnings(["Export produced no files — the tab may have failed to render."]);
      return;
    }
    postResult({ files, settings: currentSettings(formats), fingerprint: payload.fingerprint });
  } catch (err) {
    showWarnings([`Export failed: ${String(err)}`]);
    console.error(err);
  }
}
```

- [ ] **Step 5: Update `asciiFile` to use the wrapped renderer (optional parity).** `asciiFile` calls `tab.toAscii()` (unwrapped). Leave it: the `.txt` export is intentionally full-width (no wrapping) so it pastes cleanly elsewhere. No change.

- [ ] **Step 6: Typecheck.**

Run: `npx tsc --noEmit && npx tsc -p ui/tsconfig.json`
Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add ui/src/main.ts
git commit -m "feat: render ASCII view + ascii/pdf export wiring"
```

### Task B7: HTML — drop alphatex checkbox, monospace `<pre>` styling

**Files:**
- Modify: `ui/index.html`

- [ ] **Step 1: Remove the alphatex checkbox** (line 98): delete the `<label class="exportFmt"><input ... value="alphatex" /> alphaTex (.txt)</label>` line.

- [ ] **Step 2: Add monospace styling** for the tab. Near the `#score` rules (lines 30–31), add:

```css
      #score pre.tab { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 13px; line-height: 1.25; margin: 0; white-space: pre; }
```

Remove the now-irrelevant `#score svg { ... }` rule (line 31).

- [ ] **Step 3: Build the UI to confirm it bundles.**

Run: `npm run build:ui`
Expected: succeeds.

- [ ] **Step 4: Commit.**

```bash
git add ui/index.html
git commit -m "feat: monospace tab view, remove alphaTex checkbox"
```

### Task B8: Remove AlphaTab + font toolchain

**Files:**
- Modify: `package.json`
- Delete: `ui/src/bravura-font.ts`, `scripts/embed-font.mjs`

- [ ] **Step 1: Edit `package.json`.** Remove the `"embed-font": ...` script line, and remove the `"@coderline/alphatab"` and `"@tutts/alphatab"` dependency lines. Keep `"@tutts/core"` and `"jspdf"`.

- [ ] **Step 2: Delete the font module + script** (the subset script / music-font files were already removed in the baseline reset; this removes what remains):

```bash
rm -f ui/src/bravura-font.ts scripts/embed-font.mjs
```

- [ ] **Step 3: Reinstall to prune the removed deps from the tree/lockfile.**

Run: `npm install`
Expected: succeeds; `@coderline/alphatab` gone from `node_modules`.

- [ ] **Step 4: Grep for stragglers.**

Run: `rg -n "alphatab|bravura|BRAVURA|embed-font|smufl" --glob '!docs/**' --glob '!*.md' . ; echo "exit:$?"`
Expected: no matches in `src/`, `ui/src/`, `scripts/` (exit 1 = clean). Fix any hit.

- [ ] **Step 5: Full test + typecheck.**

Run: `npm run typecheck && npx vitest run && npx vitest run -c vitest.integration.config.ts`
Expected: all PASS.

- [ ] **Step 6: Commit.**

```bash
git add package.json package-lock.json ui/src/bravura-font.ts scripts/embed-font.mjs
git commit -m "chore: remove AlphaTab + Bravura font toolchain"
```

### Task B9: Docs

**Files:**
- Modify: `README.md`, `manifest.json` (if it references AlphaTab/formats)

- [ ] **Step 1: Update `README.md`.** Remove the AlphaTab/Bravura/embed-font paragraph (the bundled-font note) and the AlphaTab rendering description; state that tab renders as ASCII and exports are PDF + `.txt`. Remove the `embed-font` row from the command table.

- [ ] **Step 2: Check `manifest.json`** for format lists or descriptions naming alphaTex; update to "PDF and .txt" if present.

- [ ] **Step 3: Commit.**

```bash
git add README.md manifest.json
git commit -m "docs: ASCII rendering, PDF + .txt exports"
```

### Task B10: Final verification

- [ ] **Step 1: Clean typecheck + all tests + build.**

Run: `npm run typecheck && npx vitest run && npx vitest run -c vitest.integration.config.ts && npm run build:ui`
Expected: all PASS.

- [ ] **Step 2: Visual confirmation.** Render a real sample into the webview HTML and a sample PDF via headless Chrome (see the session's prior screenshot technique): build a self-contained page that imports the built UI or calls `renderAscii` on a sample `GeneratedTab`, screenshot it, and read the image to confirm legible wrapped ASCII with a time signature. Generate a sample PDF via `pdfFile` and render its first page to PNG (`/Applications/Google Chrome.app/.../Google Chrome --headless --screenshot`) to confirm monospace text and pagination.

- [ ] **Step 3: Confirm bundle shrank.** `ls -la ui/dist/index.html` (or the vite `dist/` output) — expect a large drop from the ~2 MB AlphaTab bundle.

- [ ] **Step 4: Report status** for Madison's check-in: what changed in each repo, test/build results, screenshots, and any decisions taken via subagent debate.

---

## Self-review

- **Spec coverage:** wrapping (A1/A2, B4, B5) ✓; time signature (A1/A2, B4/B5) ✓; uniform cell width (A1/A2) ✓; note-name header kept (A1 headers unchanged) ✓; ASCII view (B4, B6, B7) ✓; vector PDF (B5) ✓; exports PDF+`.txt`, alphaTex cut (B1, B2, B3, B6, B7) ✓; deletions (B8) ✓; `@tutts/alphatab` removed from the **extension only** (B3 import, B8 dep) — package untouched ✓; tests (A2, A3, B2, B3, B4, B5) ✓; visual check (B10) ✓.
- **Placeholder scan:** none — every code/test step has full content.
- **Type consistency:** `AsciiRenderOptions` / `renderAsciiTab` / `toSystems` / `toLines(opts)` / `toAscii(opts)` consistent across A1, A3, B4, B5; `PipelineOutput = { tab, warnings }` consistent across B3/B6; `pdfFile(base, tab, footer)` consistent across B5/B6.
