# MIDI Tablature Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an Ableton Live extension that renders a MIDI clip as stringed-instrument tablature (configurable tuning / string count / fret count, with instrument presets) and exports it to PDF, ASCII tab, and alphaTex.

**Architecture:** A near-clone of the sheet music extension's Node-extension + single-file webview shell. The Node side (`src/`) reads the clip, builds a payload, and opens a modal; it carries **no** music logic and **no** `tutts`/AlphaTab imports, so it stays CI-testable. The webview (`ui/`) owns all rendering: it builds a `tutts` `Tuning`, runs `@tutts/core` `generateTab` → `@tutts/alphatab` `toAlphaTex`, and renders the alphaTex to SVG with AlphaTab's low-level synchronous `ScoreRenderer` (offline, with Bravura bundled inline).

**Tech Stack:** TypeScript, esbuild (Node bundle), Vite + `vite-plugin-singlefile` (webview), Vitest, `@tutts/core` + `@tutts/alphatab` (via `file:` deps in dev), `@coderline/alphatab` ^1.6, `jspdf`, the Ableton Extensions SDK (vendored tarball).

---

## Deviations from the approved spec (review these first)

Three deliberate refinements were made while planning. They are flagged here so they can be vetoed before execution:

1. **PDF export is raster, not vector.** The spec called for `svg2pdf.js` vector PDF. AlphaTab's tab SVG uses SMuFL (Bravura) glyphs for the rhythm row, time signature, and "TAB" clef; embedding a SMuFL font into jsPDF for faithful vector output is a rabbit hole and a real failure mode. Instead, each rendered SVG chunk gets a Bravura `@font-face` embedded inline, is rasterized to a canvas, and is placed into jsPDF as an image with a provenance footer. This guarantees every glyph appears, fully offline. **`svg2pdf.js` is therefore dropped from dependencies.** Vector PDF is a possible v1.1.
2. **No time-signature UI control.** The spec's UI control list already omitted one. The scene time signature is still read on the Node side and fed to `tutts` (so measures are correct), but it is not user-editable in v1. Flagged because the sheet music extension *did* have a Time control.
3. **The webview is split into focused modules** rather than one `ui/src/main.ts`: `tab-pipeline.ts` (pure `tutts` glue — no AlphaTab import, so it is node-testable as the integration test), `render.ts` (AlphaTab), `export.ts` (pure file builders), `pdf.ts` (jsPDF/DOM), `bravura-font.ts` (generated), and `main.ts` (wiring). This is the spec's "one clear responsibility per file" principle applied.

## File structure

**Node side (`src/`) — no `tutts`/AlphaTab/SDK-runtime imports; fully CI-testable:**

| File | Responsibility |
|---|---|
| `src/extension.ts` | SDK entry: register command + context menu, read clip/song, build `TabPayload`, open modal, write returned files. |
| `src/file-url.ts` | `fileUrl()` — `pathToFileURL` wrapper. *(verbatim from sheet music)* |
| `src/notation/types.ts` | `NoteModel`, `TimeSignature`. *(trimmed copy)* |
| `src/notation/notes.ts` | `toNoteModels()` — SDK notes → `NoteModel[]`, BigInt-coerced. *(verbatim)* |
| `src/notation/fingerprint.ts` | `fingerprintNotes()` — FNV-1a change hash. *(verbatim)* |
| `src/instruments.ts` | `INSTRUMENTS` preset table, `chromaticNoteNames()`, string-count bounds. *(new, pure)* |
| `src/payload.ts` | `TabPayload`/`TabSettings`/`TabResult`/`ExportedFile` + `injectPayload()`. *(new contract)* |
| `src/html.d.ts` | `*.html` text-module declaration. *(verbatim)* |

**Webview side (`ui/`):**

| File | Responsibility |
|---|---|
| `ui/index.html` | Toolbar + dynamic string rows + score area + payload `<script>`. |
| `ui/src/tab-pipeline.ts` | `buildTuning()` + `runPipeline()` — `tutts` only, **no** AlphaTab. node-testable. |
| `ui/src/bravura-font.ts` | Generated: `BRAVURA_WOFF2_DATAURI`. |
| `ui/src/render.ts` | `renderAlphaTex()` — AlphaTab low-level SVG render into the DOM. |
| `ui/src/export.ts` | `sanitize()`, `asciiFile()`, `alphatexFile()` — pure. |
| `ui/src/pdf.ts` | `pdfFile()` — raster SVG → jsPDF. |
| `ui/src/main.ts` | Controls, preset/tuning state, pipeline+render calls, export, `postResult`. |

**Build / project:** `package.json`, `manifest.json`, `tsconfig.json`, `ui/tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `vitest.integration.config.ts`, `build.ts`, `.gitignore`, `.env.example`, `scripts/setup-sdk.mjs`, `scripts/package.mjs`, `scripts/embed-font.mjs`, `.github/workflows/ci.yml`.

**Test split:** `npm test` (Vitest, CI) runs only pure tests and excludes `*.integration.test.ts`. `npm run test:integration` runs the one `tutts`-dependent test locally. CI drops the SDK and `@tutts/*` deps (unresolvable without the private SDK / unpublished `tutts`), so it verifies only the pure core; the UI type-check/build return to CI once `tutts` is on npm.

---

## Task 1: Project scaffold (build config, scripts, CI)

Pure setup — no music logic yet. Establishes a repo that installs and runs an (empty) test suite.

**Files:**
- Create: `package.json`, `manifest.json`, `tsconfig.json`, `ui/tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `vitest.integration.config.ts`, `build.ts`, `src/html.d.ts`, `.gitignore`, `.env.example`, `scripts/setup-sdk.mjs`, `scripts/package.mjs`, `.github/workflows/ci.yml`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "ableton-midi-tabs-extension",
  "version": "0.1.0",
  "description": "View an Ableton Live MIDI clip as stringed-instrument tablature, configure the tuning, and export PDF / ASCII tab / alphaTex.",
  "license": "MIT",
  "main": "dist/extension.js",
  "engines": { "node": ">=24.14.1" },
  "type": "module",
  "scripts": {
    "setup": "node scripts/setup-sdk.mjs && npm install",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:integration": "vitest run -c vitest.integration.config.ts",
    "typecheck": "tsc --noEmit && tsc -p ui/tsconfig.json",
    "embed-font": "node scripts/embed-font.mjs",
    "build:ui": "vite build",
    "build:dev": "npm run build:ui && npm run typecheck && tsx build.ts",
    "build": "npm run build:ui && npm run typecheck && tsx build.ts --production",
    "start": "npm run build:dev && extensions-cli run --storage-directory \"$PWD/.dev/storage\" --temp-directory \"$PWD/.dev/temp\"",
    "package": "npm run build && node scripts/package.mjs",
    "dev:ui": "vite"
  },
  "dependencies": {
    "@ableton-extensions/sdk": "file:vendor/ableton-extensions-sdk.tgz",
    "@coderline/alphatab": "^1.6.0",
    "@tutts/alphatab": "file:../tutts/packages/alphatab",
    "@tutts/core": "file:../tutts/packages/core",
    "jspdf": "^2.5.2"
  },
  "devDependencies": {
    "@ableton-extensions/cli": "file:vendor/ableton-extensions-cli.tgz",
    "@types/node": "^24.1.0",
    "esbuild": "0.28.0",
    "tsx": "^4.19.0",
    "typescript": "^5.9.3",
    "vite": "^6.0.0",
    "vite-plugin-singlefile": "^2.1.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Write `manifest.json`**

```json
{
  "name": "Tablature",
  "author": "Madison Rickert",
  "entry": "dist/extension.js",
  "version": "0.1.0",
  "minimumApiVersion": "1.0.0"
}
```

- [ ] **Step 3: Write the TypeScript + build configs**

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "module": "esnext",
    "target": "esnext",
    "moduleResolution": "bundler",
    "outDir": "./dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src/**/*"]
}
```

`ui/tsconfig.json`:

```json
{
  "compilerOptions": {
    "module": "esnext",
    "target": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "lib": ["esnext", "dom", "dom.iterable"],
    "types": []
  },
  "include": ["src/**/*"]
}
```

> Note: `include` is only `ui/src` (relative to this file). The shared Node-side
> modules that webview files import (`../../src/payload`, `../../src/instruments`,
> `../../src/notation/types`) are pulled into the program transitively and
> type-checked too — but `src/notes.ts` and `src/extension.ts` (which need Node
> globals + the SDK) are NOT in `ui/src`'s import graph, so this tsconfig never
> tries to check them under its dom-only / no-node-types lib.

`vite.config.ts`:

```ts
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  root: "ui",
  plugins: [viteSingleFile()],
  server: { port: 5173, fs: { allow: [".."] } },
  build: { outDir: "dist", emptyOutDir: true, target: "esnext" },
});
```

`build.ts`:

```ts
import * as esbuild from "esbuild";
import * as fs from "node:fs";

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const production = process.argv.includes("--production");

await esbuild.build({
  entryPoints: ["src/extension.ts"],
  outfile: manifest.entry,
  bundle: true,
  format: "cjs",
  platform: "node",
  sourcesContent: false,
  logLevel: "info",
  minify: production,
  sourcemap: !production,
  loader: { ".html": "text" },
});
```

`src/html.d.ts`:

```ts
declare module "*.html" {
  const content: string;
  export default content;
}
```

- [ ] **Step 4: Write the Vitest configs**

`vitest.config.ts` (pure tests, CI):

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "ui/src/**/*.test.ts"],
    exclude: ["**/*.integration.test.ts", "**/node_modules/**"],
    environment: "node",
    passWithNoTests: true,
  },
});
```

`vitest.integration.config.ts` (tutts-dependent, local only):

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.integration.test.ts"],
    exclude: ["**/node_modules/**"],
    environment: "node",
    passWithNoTests: true,
  },
});
```

- [ ] **Step 5: Write `.gitignore` and `.env.example`**

`.gitignore`:

```
.DS_Store
node_modules/
dist/
ui/dist/
release/

*.log
*.ablx
*.tsbuildinfo

.env
.dev/
vendor/
```

`.env.example`:

```
# Path to your unpacked Ableton Extensions SDK (the dir holding the *.tgz package archives).
ABLETON_SDK_PATH=/path/to/extensions-sdk-1.0.0-beta.0
```

- [ ] **Step 6: Write `scripts/setup-sdk.mjs`**

```js
// Vendors the Ableton Extensions SDK tarballs into ./vendor so `npm install` can
// resolve them. The SDK is a private beta distributed by Ableton and is not
// committed to this repo. Point ABLETON_SDK_PATH (in .env or your shell) at your
// unpacked SDK; this copies the SDK + CLI tarballs into ./vendor with stable names.
import { existsSync, mkdirSync, copyFileSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function fail(msg) {
  console.error(`\n  setup-sdk: ${msg}\n`);
  process.exit(1);
}

function readEnv(name) {
  if (process.env[name]) return process.env[name];
  try {
    const line = readFileSync(".env", "utf8")
      .split("\n")
      .find((l) => l.trim().startsWith(`${name}=`));
    if (line) return line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
  } catch {
    // no .env file
  }
  return undefined;
}

const sdkPath = readEnv("ABLETON_SDK_PATH");
if (!sdkPath) {
  fail(
    "ABLETON_SDK_PATH is not set.\n" +
      "  Copy .env.example to .env and set it to your unpacked Ableton Extensions SDK, e.g.\n" +
      "    ABLETON_SDK_PATH=/path/to/extensions-sdk-1.0.0-beta.0\n" +
      "  then re-run `npm run setup`.",
  );
}

const archiveDir = [join(sdkPath, "package-archives"), sdkPath].find((d) => existsSync(d));
if (!archiveDir) fail(`ABLETON_SDK_PATH does not exist: ${sdkPath}`);

const files = readdirSync(archiveDir);
const sdkTgz = files.find((f) => /^ableton-extensions-sdk.*\.tgz$/.test(f));
const cliTgz = files.find((f) => /^ableton-extensions-cli.*\.tgz$/.test(f));
if (!sdkTgz || !cliTgz) {
  fail(
    `Could not find the SDK tarballs in ${archiveDir}.\n` +
      "  Expected ableton-extensions-sdk-*.tgz and ableton-extensions-cli-*.tgz.",
  );
}

mkdirSync("vendor", { recursive: true });
copyFileSync(join(archiveDir, sdkTgz), "vendor/ableton-extensions-sdk.tgz");
copyFileSync(join(archiveDir, cliTgz), "vendor/ableton-extensions-cli.tgz");
console.log(`  setup-sdk: vendored ${sdkTgz} + ${cliTgz} into ./vendor — installing dependencies...`);
```

- [ ] **Step 7: Write `scripts/package.mjs`**

```js
// Builds the installable .ablx into ./release/ — kept out of the repo root and
// git-ignored. The .ablx is the shippable artifact (a ZIP of manifest.json + the
// built dist/extension.js) that users drag into Live's Extensions prefs. Run via
// `npm run package`. Pass `--reveal` to open the file in Finder.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const OUT_DIR = "release";

function fail(msg) {
  console.error(`\n  package: ${msg}\n`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
if (!existsSync(manifest.entry)) {
  fail(`${manifest.entry} not found — run \`npm run build\` first (or just \`npm run package\`).`);
}

const ablxName = `${(manifest.name || "extension").replace(/\s+/gu, "-")}-${manifest.version || "0.0.0"}.ablx`;
const outPath = join(OUT_DIR, ablxName);

mkdirSync(OUT_DIR, { recursive: true });
for (const f of readdirSync(OUT_DIR)) {
  if (f.endsWith(".ablx")) rmSync(join(OUT_DIR, f));
}

const cliBin = join("node_modules", ".bin", process.platform === "win32" ? "extensions-cli.cmd" : "extensions-cli");
execFileSync(cliBin, ["package", "-o", outPath], { stdio: ["ignore", "ignore", "inherit"] });

const sizeMB = (statSync(outPath).size / 1024 / 1024).toFixed(2);
console.log(`\n  package: ${manifest.name} ${manifest.version} → ${outPath} (${sizeMB} MB)`);
console.log(`  install: drag it onto Live → Preferences → Extensions (Developer Mode off).\n`);

if (process.argv.includes("--reveal")) {
  if (process.platform === "darwin") execFileSync("open", ["-R", outPath]);
  else console.log("  package: --reveal is macOS-only; skipped.");
}
```

- [ ] **Step 8: Write `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "24"

      # The Ableton SDK (private beta tarball) and the @tutts/* packages (local
      # file: deps until published to npm) cannot be resolved in CI. Drop them and
      # verify the SDK/tutts-independent core: the pure modules and their unit
      # tests. Re-enable the UI type-check + build here once @tutts/* is on npm.
      - name: Drop unresolvable deps for CI
        run: |
          node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));for(const k of ['dependencies','devDependencies']){if(p[k]){for(const d of ['@ableton-extensions/sdk','@ableton-extensions/cli','@tutts/core','@tutts/alphatab']) delete p[k][d];}}fs.writeFileSync('package.json',JSON.stringify(p,null,2));"

      - name: Install dependencies
        run: npm install --no-package-lock

      - name: Unit tests
        run: npm test
```

- [ ] **Step 9: Vendor the SDK and install**

Run: `cp .env.example .env` then edit `.env` so `ABLETON_SDK_PATH` points at `../extensions-sdk-1.0.0-beta.0` (absolute path), then `npm run setup`.
Expected: `setup-sdk` prints "vendored … into ./vendor" and `npm install` completes (it resolves the vendored SDK tarballs and the `file:../tutts/...` packages). If `tutts` is not built, run `npm run build` inside `../tutts` first.

- [ ] **Step 10: Verify the empty suite runs**

Run: `npm test`
Expected: PASS — "No test files found" is allowed (`passWithNoTests: true`), exit code 0.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "Scaffold Tablature extension: build config, scripts, CI"
```

---

## Task 2: Copy the verbatim notation utilities

These three modules are byte-for-byte reuse from the sheet music extension; their tests come with them and must pass unchanged.

**Files:**
- Create: `src/file-url.ts`, `src/file-url.test.ts`, `src/notation/types.ts`, `src/notation/notes.ts`, `src/notation/notes.test.ts`, `src/notation/fingerprint.ts`, `src/notation/fingerprint.test.ts`

- [ ] **Step 1: Write `src/notation/types.ts`** (trimmed — only what the tab extension needs)

```ts
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
```

- [ ] **Step 2: Write `src/notation/notes.ts` and its test**

`src/notation/notes.ts`:

```ts
import type { NoteDescription } from "@ableton-extensions/sdk";
import type { NoteModel } from "./types";

/**
 * Map Live's note descriptions to internal NoteModels (unmuted, sorted).
 * The SDK returns BigInt at runtime for these numeric fields (its .d.ts says
 * `number`), so coerce with Number() at the boundary — otherwise downstream
 * JSON.stringify and arithmetic throw on BigInt.
 */
export function toNoteModels(notes: NoteDescription[]): NoteModel[] {
  return notes
    .filter((n) => !n.muted)
    .map((n) => ({ midi: Number(n.pitch), startBeats: Number(n.startTime), durationBeats: Number(n.duration) }))
    .sort((a, b) => a.startBeats - b.startBeats || a.midi - b.midi);
}
```

`src/notation/notes.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { toNoteModels } from "./notes";

describe("toNoteModels", () => {
  it("maps NoteDescription fields and sorts by start then pitch", () => {
    const result = toNoteModels([
      { pitch: 64, startTime: 1, duration: 0.5 },
      { pitch: 60, startTime: 0, duration: 1 },
    ]);
    expect(result).toEqual([
      { midi: 60, startBeats: 0, durationBeats: 1 },
      { midi: 64, startBeats: 1, durationBeats: 0.5 },
    ]);
  });
  it("drops muted notes", () => {
    const result = toNoteModels([
      { pitch: 60, startTime: 0, duration: 1, muted: true },
      { pitch: 62, startTime: 0, duration: 1 },
    ]);
    expect(result).toEqual([{ midi: 62, startBeats: 0, durationBeats: 1 }]);
  });
  it("coerces BigInt fields to number (the SDK returns BigInt at runtime)", () => {
    const result = toNoteModels([
      { pitch: 60n as unknown as number, startTime: 0n as unknown as number, duration: 2n as unknown as number },
    ]);
    expect(result).toEqual([{ midi: 60, startBeats: 0, durationBeats: 2 }]);
    expect(typeof result[0].midi).toBe("number");
    expect(typeof result[0].startBeats).toBe("number");
  });
});
```

- [ ] **Step 3: Write `src/notation/fingerprint.ts` and its test**

`src/notation/fingerprint.ts`:

```ts
import type { NoteModel } from "./types";

/** Pure FNV-1a 32-bit hash over normalized notes; first 6 hex chars. No node:crypto so it stays portable. */
export function fingerprintNotes(notes: NoteModel[]): string {
  const canon = notes
    .map((n) => `${n.midi}:${n.startBeats.toFixed(4)}:${n.durationBeats.toFixed(4)}`)
    .sort()
    .join("|");
  let h = 0x811c9dc5;
  for (let i = 0; i < canon.length; i++) {
    h ^= canon.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0").slice(0, 6);
}
```

`src/notation/fingerprint.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { fingerprintNotes } from "./fingerprint";
import type { NoteModel } from "./types";

const a: NoteModel[] = [
  { midi: 60, startBeats: 0, durationBeats: 1 },
  { midi: 64, startBeats: 1, durationBeats: 1 },
];

describe("fingerprintNotes", () => {
  it("is a 6-char hex string", () => {
    expect(fingerprintNotes(a)).toMatch(/^[0-9a-f]{6}$/);
  });
  it("is deterministic and order-independent", () => {
    const reordered = [a[1], a[0]];
    expect(fingerprintNotes(reordered)).toBe(fingerprintNotes(a));
  });
  it("changes when a note changes", () => {
    const b: NoteModel[] = [{ ...a[0], midi: 61 }, a[1]];
    expect(fingerprintNotes(b)).not.toBe(fingerprintNotes(a));
  });
  it("empty clip has a stable fingerprint", () => {
    expect(fingerprintNotes([])).toMatch(/^[0-9a-f]{6}$/);
  });
});
```

- [ ] **Step 4: Write `src/file-url.ts` and its test**

`src/file-url.ts`:

```ts
import { pathToFileURL } from "node:url";

/**
 * Build a `file:` URL for a local path.
 *
 * Must go through `pathToFileURL` rather than `` `file://${path}` `` so spaces
 * and other reserved characters are percent-encoded. Live's modal-dialog host
 * rejects a URL with a raw space as malformed ("Invalid URL"), and a managed
 * extension's temp directory lives under "…/Application Support/Ableton/
 * Extensions Data/…" — so the unencoded form fails in every installed build
 * even though the dev temp path (no spaces) happens to work.
 */
export function fileUrl(filePath: string): string {
  return pathToFileURL(filePath).href;
}
```

`src/file-url.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { fileUrl } from "./file-url";

describe("fileUrl", () => {
  it("produces a file: URL", () => {
    expect(fileUrl("/tmp/x.html")).toBe("file:///tmp/x.html");
  });
  it("percent-encodes spaces", () => {
    expect(fileUrl("/tmp/a b/x.html")).toBe("file:///tmp/a%20b/x.html");
  });
});
```

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS — all four files green (toNoteModels ×3, fingerprintNotes ×4, fileUrl ×2).

- [ ] **Step 6: Commit**

```bash
git add src/file-url.ts src/file-url.test.ts src/notation
git commit -m "Add reused notation utilities (notes, fingerprint, file-url, types)"
```

---

## Task 3: Instrument preset table

A pure data module: the preset list, the dropdown note-name generator, and the string-count bounds. No `tutts` import (keeps it CI-pure). The reversal-to-`tutts`-order correctness is locked in by asserting the reversed arrays equal the known `tutts` literals.

**Files:**
- Create: `src/instruments.ts`
- Test: `src/instruments.test.ts`

- [ ] **Step 1: Write the failing test**

`src/instruments.test.ts`:

```ts
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

  it("bounds are 4 and 8", () => {
    expect(MIN_STRINGS).toBe(4);
    expect(MAX_STRINGS).toBe(8);
  });

  it("every string name is a tutts-parseable note name (letter, optional #/b, octave)", () => {
    const re = /^[A-Ga-g][#b!]?[+-]?\d+$/;
    for (const p of INSTRUMENTS) for (const n of p.stringNames) expect(n).toMatch(re);
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test src/instruments.test.ts`
Expected: FAIL — "Cannot find module './instruments'".

- [ ] **Step 3: Write `src/instruments.ts`**

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test src/instruments.test.ts`
Expected: PASS — all assertions green.

- [ ] **Step 5: Commit**

```bash
git add src/instruments.ts src/instruments.test.ts
git commit -m "Add instrument preset table and dropdown note-name generator"
```

---

## Task 4: Payload contract

The Node↔webview data contract and the HTML injection helpers. Mirrors the sheet music `payload.ts` but with tab-specific shapes and a new token.

**Files:**
- Create: `src/payload.ts`
- Test: `src/payload.test.ts`

- [ ] **Step 1: Write the failing test**

`src/payload.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { injectPayload, escapeForScriptJson, PAYLOAD_TOKEN, type TabPayload } from "./payload";
import { INSTRUMENTS, chromaticNoteNames } from "./instruments";

const payload: TabPayload = {
  clipName: "Verse <Riff>",
  notes: [{ midi: 40, startBeats: 0, durationBeats: 1 }],
  tempo: 120,
  timeSig: { numerator: 4, denominator: 4 },
  presets: INSTRUMENTS,
  noteOptions: chromaticNoteNames(0, 6),
  settings: {
    preset: "Standard Guitar",
    tuning: ["E2", "A2", "D3", "G3", "B3", "E4"],
    fretCount: 20,
    quantizeGrid: "1/16",
    formats: ["pdf"],
  },
  fingerprint: "a3f9c1",
  lastExportFingerprint: null,
  provenance: { clipName: "Verse <Riff>", tempo: 120, fingerprint: "a3f9c1", generatedAt: "2026-06-05T00:00:00Z" },
};

describe("escapeForScriptJson", () => {
  it("escapes < so a </script> cannot appear", () => {
    expect(escapeForScriptJson('{"x":"</script>"}')).toBe('{"x":"\\u003c/script>"}');
  });
});

describe("injectPayload", () => {
  const html = `<html><body><script id="tab-payload" type="application/json">${PAYLOAD_TOKEN}</script></body></html>`;

  it("replaces the token with escaped JSON and round-trips via JSON.parse", () => {
    const result = injectPayload(html, payload);
    expect(result).not.toContain(PAYLOAD_TOKEN);
    const json = result.match(/type="application\/json">([\s\S]*?)<\/script>/)![1];
    expect(JSON.parse(json)).toEqual(payload);
  });

  it("does not expand $-patterns from the payload (clip name with $& $' $`)", () => {
    const tricky: TabPayload = { ...payload, clipName: "$& $` $' $$ Intro" };
    const result = injectPayload(html, tricky);
    expect(result).not.toContain(PAYLOAD_TOKEN);
    const json = result.match(/type="application\/json">([\s\S]*?)<\/script>/)![1];
    expect(JSON.parse(json).clipName).toBe("$& $` $' $$ Intro");
  });

  it("throws when the token is missing", () => {
    expect(() => injectPayload("<html></html>", payload)).toThrow(/token/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test src/payload.test.ts`
Expected: FAIL — "Cannot find module './payload'".

- [ ] **Step 3: Write `src/payload.ts`**

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test src/payload.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/payload.ts src/payload.test.ts
git commit -m "Add TabPayload contract and HTML injection helpers"
```

---

## Task 5: Node extension entry point

The SDK glue: register the command + context menu, read the clip, build the payload, open the modal, write returned files. No music logic. Not unit-tested (SDK-bound) — verified by type-check.

**Files:**
- Create: `src/extension.ts`

- [ ] **Step 1: Write `src/extension.ts`**

```ts
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile } from "node:child_process";
import {
  initialize,
  MidiClip,
  type ActivationContext,
  type Handle,
} from "@ableton-extensions/sdk";

import bundledHtml from "../ui/dist/index.html";
import { toNoteModels } from "./notation/notes";
import { fingerprintNotes } from "./notation/fingerprint";
import type { NoteModel } from "./notation/types";
import { INSTRUMENTS, chromaticNoteNames } from "./instruments";
import { fileUrl } from "./file-url";
import { injectPayload, type TabPayload, type TabResult, type TabSettings } from "./payload";

const standard = INSTRUMENTS[0]; // Standard Guitar
const DEFAULT_SETTINGS: TabSettings = {
  preset: standard.name,
  tuning: [...standard.stringNames],
  fretCount: standard.fretCount,
  quantizeGrid: "1/16",
  formats: ["pdf"],
};

const NOTE_OPTIONS = chromaticNoteNames(0, 6);

/** Reveal a saved file in Finder (best-effort; macOS `open -R`). */
function revealInFinder(filePath: string): void {
  // execFile reports errors via its callback (it does not throw synchronously),
  // so log there. A failed reveal is non-fatal.
  execFile("open", ["-R", filePath], (err) => {
    if (err) console.error("Tablature: couldn't reveal the file in Finder.", err);
  });
}

export function activate(activation: ActivationContext) {
  const ctx = initialize(activation, "1.0.0");

  const storageDir = () => {
    const d = ctx.environment.storageDirectory;
    if (!d) throw new Error("No storage directory available.");
    return d;
  };
  const tempDir = () => {
    const d = ctx.environment.tempDirectory;
    if (!d) throw new Error("No temp directory available.");
    return d;
  };

  async function readJson<T>(file: string, fallback: T): Promise<T> {
    try {
      return JSON.parse(await fs.readFile(file, "utf-8")) as T;
    } catch {
      return fallback;
    }
  }

  /** Read the clip + song context needed to build a tab payload. */
  function readClip(handle: Handle): {
    clipName: string;
    notes: NoteModel[];
    tempo: number;
    timeSig: { numerator: number; denominator: number };
    fingerprint: string;
  } {
    const clip = ctx.getObjectFromHandle(handle, MidiClip);
    const notes = toNoteModels(clip.notes);
    const song = ctx.application.song;
    const scene = song.scenes[0];
    // The SDK returns BigInt at runtime for numeric fields (despite the .d.ts
    // declaring `number`), so coerce every numeric read with Number(). A scene's
    // signature is -1 when it follows the (SDK-inaccessible) global signature, so
    // treat any non-positive value as "unset" and default to 4/4.
    const sigNum = Number(scene?.signatureNumerator);
    const sigDen = Number(scene?.signatureDenominator);
    return {
      clipName: clip.name,
      notes,
      tempo: Number(song.tempo),
      timeSig: {
        numerator: sigNum > 0 ? sigNum : 4,
        denominator: sigDen > 0 ? sigDen : 4,
      },
      fingerprint: fingerprintNotes(notes),
    };
  }

  async function writeFiles(files: TabResult["files"]): Promise<string[]> {
    const dir = path.join(storageDir(), "tabs");
    await fs.mkdir(dir, { recursive: true });
    const written: string[] = [];
    for (const f of files) {
      // Defense in depth: basename strips any path components so a webview-supplied
      // name can't escape tabs/ (the webview also sanitizes the name before sending).
      const dest = path.join(dir, path.basename(f.name));
      if (f.encoding === "base64") await fs.writeFile(dest, Buffer.from(f.data, "base64"));
      else await fs.writeFile(dest, f.data, "utf-8");
      written.push(dest);
    }
    return written;
  }

  async function persistSettings(settings: TabSettings): Promise<void> {
    await fs.writeFile(path.join(storageDir(), "settings.json"), JSON.stringify(settings, null, 2), "utf-8");
  }

  async function persistLastExport(clipName: string, fingerprint: string, formats: string[]): Promise<void> {
    const file = path.join(storageDir(), "last-export.json");
    const map = await readJson<Record<string, { fingerprint: string; ts: string; formats: string[] }>>(file, {});
    map[clipName] = { fingerprint, ts: new Date().toISOString(), formats };
    await fs.writeFile(file, JSON.stringify(map, null, 2), "utf-8");
  }

  // ---- "Show Tab" (interactive) -------------------------------------------------
  ctx.commands.registerCommand("tablature.showTab", (arg: unknown) => {
    void (async () => {
      try {
        const clip = readClip(arg as Handle);
        if (clip.notes.length === 0) {
          console.log("Tablature: clip has no notes — nothing to render.");
          return;
        }
        const settings = await readJson(path.join(storageDir(), "settings.json"), DEFAULT_SETTINGS);
        const lastExport = await readJson<Record<string, { fingerprint: string }>>(
          path.join(storageDir(), "last-export.json"),
          {},
        );
        const payload: TabPayload = {
          clipName: clip.clipName,
          notes: clip.notes,
          tempo: clip.tempo,
          timeSig: clip.timeSig,
          presets: INSTRUMENTS,
          noteOptions: NOTE_OPTIONS,
          settings,
          fingerprint: clip.fingerprint,
          lastExportFingerprint: lastExport[clip.clipName]?.fingerprint ?? null,
          provenance: {
            clipName: clip.clipName,
            tempo: clip.tempo,
            fingerprint: clip.fingerprint,
            generatedAt: new Date().toISOString(),
          },
        };
        const html = injectPayload(bundledHtml, payload);
        const uiPath = path.join(tempDir(), "tab-ui.html");
        await fs.writeFile(uiPath, html, "utf-8");

        const raw = await ctx.ui.showModalDialog(fileUrl(uiPath), 900, 640);
        if (!raw) return; // dialog dismissed without a result
        const result = JSON.parse(raw) as TabResult;
        await persistSettings(result.settings); // remember preset / tuning / frets / grid / format
        if (result.files.length) {
          const written = await writeFiles(result.files);
          await persistLastExport(clip.clipName, result.fingerprint, result.settings.formats);
          console.log(`Tablature: wrote ${written.length} file(s):\n${written.join("\n")}`);
          revealInFinder(written[0]);
        }
      } catch (err) {
        console.error("Tablature: couldn't render that clip — right-click it again.", err);
      }
    })();
  });

  ctx.ui.registerContextMenuAction("MidiClip", "Show Tab", "tablature.showTab");
}
```

- [ ] **Step 2: Type-check the Node side**

Run: `npx tsc --noEmit`
Expected: PASS (no errors). Note: `../ui/dist/index.html` resolves via `src/html.d.ts` as a string module even though the file doesn't exist yet — `tsc` does not read the file. If `tsc` reports "Cannot find module '../ui/dist/index.html'", confirm `src/html.d.ts` exists from Task 1; that ambient declaration is what satisfies it.

- [ ] **Step 3: Commit**

```bash
git add src/extension.ts
git commit -m "Add Node extension entry: Show Tab command, payload build, file writeback"
```

---

## Task 6: Tab pipeline module (tutts glue) + integration test

The pure `tutts` pipeline, isolated from AlphaTab so it runs under Node. This is the one `tutts`-dependent test; it runs via `npm run test:integration` (local only).

**Files:**
- Create: `ui/src/tab-pipeline.ts`
- Test: `ui/src/tab-pipeline.integration.test.ts`

- [ ] **Step 1: Write the failing integration test**

`ui/src/tab-pipeline.integration.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the integration test to verify it fails**

Run: `npm run test:integration`
Expected: FAIL — "Cannot find module './tab-pipeline'".

- [ ] **Step 3: Write `ui/src/tab-pipeline.ts`**

```ts
import { generateTab, Tuning, type GeneratedTab } from "@tutts/core";
import { toAlphaTex } from "@tutts/alphatab";
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
  tex: string;
  warnings: string[];
}

/** notes + tuning + grid -> fingered tab -> alphaTex. Pure; no DOM, no AlphaTab. */
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
  const { tex, warnings } = toAlphaTex(tab.data, {
    title: input.title,
    tempo: input.tempo,
    tuningLabel: input.tuningLabel,
  });
  return { tab, tex, warnings };
}
```

- [ ] **Step 4: Run the integration test to verify it passes**

Run: `npm run test:integration`
Expected: PASS — both describe blocks green. If `@tutts/core` fails to resolve, run `npm run build` inside `../tutts` and re-run.

- [ ] **Step 5: Confirm the pure suite still ignores it**

Run: `npm test`
Expected: PASS — the integration test is excluded; no `tutts` runtime needed.

- [ ] **Step 6: Commit**

```bash
git add ui/src/tab-pipeline.ts ui/src/tab-pipeline.integration.test.ts
git commit -m "Add tutts pipeline (buildTuning, runPipeline) with integration test"
```

---

## Task 7: Bundle the Bravura font

AlphaTab renders SMuFL glyphs (rhythm row, time signature, "TAB" clef) from the Bravura font. The single-file webview has no network/file access, so Bravura is base64-embedded into a generated, committed module.

**Files:**
- Create: `scripts/embed-font.mjs`
- Create (generated, committed): `ui/src/bravura-font.ts`

- [ ] **Step 1: Write `scripts/embed-font.mjs`**

```js
// Generates ui/src/bravura-font.ts from the Bravura woff2 that ships inside
// @coderline/alphatab, so the webview can render SMuFL glyphs fully offline.
// Re-run after bumping @coderline/alphatab. Output is committed.
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function findFile(dir, predicate) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      const hit = findFile(full, predicate);
      if (hit) return hit;
    } else if (predicate(entry)) {
      return full;
    }
  }
  return null;
}

const root = "node_modules/@coderline/alphatab";
const woff2 = findFile(root, (f) => /^Bravura.*\.woff2$/i.test(f));
if (!woff2) {
  console.error("\n  embed-font: could not find Bravura*.woff2 under " + root + ".\n");
  process.exit(1);
}

const b64 = readFileSync(woff2).toString("base64");
const out = `// AUTO-GENERATED by scripts/embed-font.mjs from ${woff2}.
// Bravura (SMuFL) as a data URI so AlphaTab renders glyphs offline. Do not edit by hand.
export const BRAVURA_WOFF2_DATAURI = "data:font/woff2;base64,${b64}";
`;
writeFileSync("ui/src/bravura-font.ts", out);
console.log(`  embed-font: wrote ui/src/bravura-font.ts from ${woff2} (${(b64.length / 1024).toFixed(0)} KB base64)`);
```

- [ ] **Step 2: Generate the font module**

Run: `npm run embed-font`
Expected: prints "wrote ui/src/bravura-font.ts from …Bravura….woff2". If it cannot find the file, list the package's font dir with `ls node_modules/@coderline/alphatab/dist/font` and adjust the predicate to match the actual filename.

- [ ] **Step 3: Verify the generated module**

Run: `node -e "import('./ui/src/bravura-font.ts').catch(()=>{}); const s=require('fs').readFileSync('ui/src/bravura-font.ts','utf8'); console.log(s.startsWith('// AUTO-GENERATED'), s.includes('data:font/woff2;base64,'), s.length>10000)"`
Expected: prints `true true true` (header present, data URI present, non-trivial size).

- [ ] **Step 4: Commit**

```bash
git add scripts/embed-font.mjs ui/src/bravura-font.ts
git commit -m "Embed Bravura font for offline AlphaTab rendering"
```

---

## Task 8: AlphaTab render module

Renders an alphaTex string to SVG using AlphaTab's low-level synchronous `ScoreRenderer` (no worker, no player), injecting the chunk SVGs into a host element. DOM-bound — verified by type-check now and by the manual Live run in Task 11.

**Files:**
- Create: `ui/src/render.ts`

- [ ] **Step 1: Write `ui/src/render.ts`**

```ts
import * as alphaTab from "@coderline/alphatab";
import { BRAVURA_WOFF2_DATAURI } from "./bravura-font";

export interface RenderedScore {
  /** The chunk SVG elements appended to the host, in order. */
  svgs: SVGSVGElement[];
  totalWidth: number;
  totalHeight: number;
}

let fontReady: Promise<void> | null = null;

/**
 * Register Bravura as a page webfont once and wait for it, so the on-screen SVG
 * paints real glyphs instead of tofu. AlphaTab's default music font-family is
 * "alphaTab"; we register under that name (and "Bravura" for good measure).
 */
async function ensureFont(): Promise<void> {
  if (fontReady) return fontReady;
  fontReady = (async () => {
    for (const family of ["alphaTab", "Bravura"]) {
      const face = new FontFace(family, `url(${BRAVURA_WOFF2_DATAURI})`);
      await face.load();
      (document as Document & { fonts: FontFaceSet }).fonts.add(face);
    }
    await (document as Document & { fonts: FontFaceSet }).fonts.ready;
  })();
  return fontReady;
}

function buildSettings(width: number): alphaTab.Settings {
  const settings = new alphaTab.Settings();
  settings.core.engine = "svg";
  settings.core.useWorkers = false;
  settings.core.enableLazyLoading = false;
  settings.core.fontDirectory = null;
  // Bundle Bravura inline so rendering needs no network/file access. Verify the
  // enum member name against node_modules/@coderline/alphatab/dist/alphaTab.d.ts
  // (it is `FontFileFormat.Woff2` in 1.6); adjust if a future version renames it.
  settings.core.smuflFontSources = new Map<alphaTab.FontFileFormat, string>([
    [alphaTab.FontFileFormat.Woff2, BRAVURA_WOFF2_DATAURI],
  ]);
  // Tab-only: no standard-notation staff above the tab.
  settings.display.staveProfile = alphaTab.StaveProfile.Tab;
  return settings;
}

/** Render `tex` into `host` as inline SVG. Synchronous render under the hood. */
export async function renderAlphaTex(tex: string, host: HTMLElement, width: number): Promise<RenderedScore> {
  await ensureFont();
  const settings = buildSettings(width);

  const importer = new alphaTab.importer.AlphaTabImporter();
  importer.initFromString(tex, settings);
  const score = importer.readScore();

  const renderer = new alphaTab.rendering.ScoreRenderer(settings);
  renderer.width = width;

  const chunks: { svg: string }[] = [];
  let totalWidth = 0;
  let totalHeight = 0;
  // Let the callback params infer from AlphaTab's typed event emitters rather than
  // hand-annotating them — inference matches the installed 1.6 arg types exactly,
  // so a property rename surfaces as a type error at the access site (see step 2).
  renderer.preRender.on(() => {
    chunks.length = 0;
  });
  // Since 1.3.0 layout and render are split; request render of each laid-out chunk.
  renderer.partialLayoutFinished.on((r) => renderer.renderResult(r.id));
  renderer.partialRenderFinished.on((r) => {
    chunks.push({ svg: String(r.renderResult) });
  });
  renderer.renderFinished.on((r) => {
    totalWidth = r.totalWidth;
    totalHeight = r.totalHeight;
  });

  renderer.renderScore(score, [0]); // synchronous: chunks are fully populated after this returns

  host.innerHTML = "";
  const svgs: SVGSVGElement[] = [];
  for (const c of chunks) {
    const wrap = document.createElement("div");
    wrap.innerHTML = c.svg.trim();
    const svg = wrap.querySelector("svg");
    if (svg) {
      host.appendChild(svg);
      svgs.push(svg as SVGSVGElement);
    }
  }
  return { svgs, totalWidth, totalHeight };
}
```

- [ ] **Step 2: Type-check the webview**

Run: `npx tsc -p ui/tsconfig.json`
Expected: PASS. If `alphaTab.FontFileFormat`, `alphaTab.StaveProfile`, or an event signature errors, open `node_modules/@coderline/alphatab/dist/alphaTab.d.ts` and correct the member/enum name to match the installed 1.6 typings (these are the only API points that can drift).

- [ ] **Step 3: Commit**

```bash
git add ui/src/render.ts
git commit -m "Add AlphaTab low-level offline SVG render module"
```

---

## Task 9: Export builders (ASCII, alphaTex) + PDF

The pure file builders are TDD'd; the raster PDF (DOM-bound) ships alongside and is verified manually in Task 11.

**Files:**
- Create: `ui/src/export.ts`
- Create: `ui/src/pdf.ts`
- Test: `ui/src/export.test.ts`

- [ ] **Step 1: Write the failing test for the pure builders**

`ui/src/export.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sanitize, asciiFile, alphatexFile } from "./export";
import type { GeneratedTab } from "@tutts/core";

// A minimal fake — export.ts only calls toAscii(), so the rest can be stubbed.
const fakeTab = {
  data: { tuning: [], measures: [] },
  toLines: () => ["e|---", "B|---"],
  toAscii: () => "e|---0---|\nB|--------|\n",
} as unknown as GeneratedTab;

describe("sanitize", () => {
  it("strips path-hostile characters", () => {
    expect(sanitize('A/B:C*?"<>|')).toBe("A_B_C_____");
  });
  it("falls back to 'tab' when empty", () => {
    expect(sanitize("   ")).toBe("tab");
  });
});

describe("asciiFile", () => {
  it("wraps toAscii() output as a .txt text file", () => {
    const f = asciiFile("Verse", fakeTab);
    expect(f).toEqual({ name: "Verse.txt", format: "ascii", encoding: "text", data: "e|---0---|\nB|--------|\n" });
  });
});

describe("alphatexFile", () => {
  it("wraps the tex string as a .alphatex.txt text file", () => {
    const f = alphatexFile("Verse", "\\title \"Verse\"\n.");
    expect(f).toEqual({ name: "Verse.alphatex.txt", format: "alphatex", encoding: "text", data: '\\title "Verse"\n.' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test ui/src/export.test.ts`
Expected: FAIL — "Cannot find module './export'".

- [ ] **Step 3: Write `ui/src/export.ts` (pure builders only — no jsPDF, no DOM)**

```ts
import type { GeneratedTab } from "@tutts/core";
import type { ExportedFile } from "../../src/payload";

/** Make a clip name safe as a file name; never empty. */
export function sanitize(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim() || "tab";
}

export function asciiFile(base: string, tab: GeneratedTab): ExportedFile {
  return { name: `${base}.txt`, format: "ascii", encoding: "text", data: tab.toAscii() };
}

export function alphatexFile(base: string, tex: string): ExportedFile {
  return { name: `${base}.alphatex.txt`, format: "alphatex", encoding: "text", data: tex };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test ui/src/export.test.ts`
Expected: PASS — sanitize ×2, asciiFile, alphatexFile green.

- [ ] **Step 5: Write `ui/src/pdf.ts` (raster SVG → jsPDF; DOM-bound, not unit-tested)**

```ts
import { jsPDF } from "jspdf";
import { BRAVURA_WOFF2_DATAURI } from "./bravura-font";
import type { ExportedFile } from "../../src/payload";

/**
 * Embed Bravura inside a single SVG (so off-DOM rasterization paints glyphs) and
 * draw it to a canvas. AlphaTab references its music glyphs under font-family
 * "alphaTab"; we register the data URI under that and "Bravura" to be safe.
 */
function rasterize(svg: SVGSVGElement): Promise<{ img: HTMLImageElement; w: number; h: number }> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const rect = svg.getBoundingClientRect();
  const w = rect.width || svg.width.baseVal.value;
  const h = rect.height || svg.height.baseVal.value;
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent =
    `@font-face{font-family:'alphaTab';src:url(${BRAVURA_WOFF2_DATAURI}) format('woff2');}` +
    `@font-face{font-family:'Bravura';src:url(${BRAVURA_WOFF2_DATAURI}) format('woff2');}`;
  clone.insertBefore(style, clone.firstChild);
  if (!clone.getAttribute("width")) clone.setAttribute("width", String(w));
  if (!clone.getAttribute("height")) clone.setAttribute("height", String(h));
  const xml = new XMLSerializer().serializeToString(clone);
  const src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ img, w, h });
    img.onerror = () => reject(new Error("could not rasterize the tab"));
    img.src = src;
  });
}

/**
 * Build a PDF from the rendered SVG chunks: stack them top-to-bottom on A4
 * portrait pages (new page on overflow), then a provenance footer on the last page.
 */
export async function pdfFile(base: string, svgs: SVGSVGElement[], footer: string): Promise<ExportedFile> {
  const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 24;
  const usableW = pageW - margin * 2;
  let y = margin;

  for (const svg of svgs) {
    const { img, w, h } = await rasterize(svg);
    const scale = Math.min(usableW / w, 1);
    const drawW = w * scale;
    const drawH = h * scale;
    if (y + drawH > pageH - margin - 16 && y > margin) {
      pdf.addPage();
      y = margin;
    }
    // Rasterize at the SVG's intrinsic size (crisp), then place scaled-to-fit.
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || w;
    canvas.height = img.naturalHeight || h;
    const cctx = canvas.getContext("2d")!;
    cctx.fillStyle = "#fff";
    cctx.fillRect(0, 0, canvas.width, canvas.height);
    cctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    pdf.addImage(canvas.toDataURL("image/png"), "PNG", margin, y, drawW, drawH);
    y += drawH + 8;
  }

  pdf.setFontSize(8);
  pdf.setTextColor(110);
  pdf.text(footer, margin, pageH - 12);
  return { name: `${base}.pdf`, format: "pdf", encoding: "base64", data: pdf.output("datauristring").split(",")[1] };
}
```

- [ ] **Step 6: Type-check the webview**

Run: `npx tsc -p ui/tsconfig.json`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add ui/src/export.ts ui/src/export.test.ts ui/src/pdf.ts
git commit -m "Add export builders (ASCII, alphaTex) and raster PDF"
```

---

## Task 10: Webview HTML + main wiring

The toolbar, the dynamic per-string rows, and the controller that ties payload → pipeline → render → export → `postResult`. Type-checked and built; behavior verified in Task 11.

**Files:**
- Create: `ui/index.html`
- Create: `ui/src/main.ts`

- [ ] **Step 1: Write `ui/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Tablature</title>
    <style>
      :root {
        --bg: #383838; --panel: #4e4e4e; --accent: #ffa500; --text: #d0d0d0;
        --border: #2c2c2c; --input: #2c2c2c; --warn: #c8862b;
        --muted: #9a9a9a; --bar-h: 42px;
      }
      * { box-sizing: border-box; }
      html, body { height: 100%; }
      body { margin: 0; background: #fff; color: var(--text); font-family: sans-serif; font-size: 13px; }
      .app { height: 100vh; display: grid; grid-template-rows: var(--bar-h) auto 1fr; }
      .topbar { display: flex; align-items: center; gap: 10px; padding: 0 10px;
                background: var(--panel); border-bottom: 1px solid var(--border); }
      .spacer { flex: 1; }
      #preset { min-width: 180px; font-weight: 600; }
      select, input { background: var(--input); color: var(--text); border: 1px solid var(--border); padding: 3px 6px; font: inherit; }
      .ghost { background: transparent; color: var(--text); border: 1px solid var(--border);
               border-radius: 10px; padding: 4px 10px; cursor: pointer; font: inherit; }
      .icon { width: 28px; padding: 4px 0; text-align: center; }
      #closeBtn { background: #d64541; color: #fff; border-color: #b73a36; font-weight: 700; }
      #closeBtn:hover { background: #e0564f; }
      .pill { background: var(--accent); color: #000; border: none; padding: 6px 14px; border-radius: 12px; cursor: pointer; font: inherit; }
      .pill.primary { width: 100%; margin-top: 6px; }
      .score-scroll { overflow: auto; background: #fff; padding: 18px 20px; }
      #score { background: #fff; }
      #score svg { display: block; margin: 0 auto 8px; }
      .caption { display: block; margin-top: 16px; color: #9a9a9a; font-size: 11px; }
      .banner { padding: 6px 12px; font-weight: 600; }
      .banner.stale { background: var(--warn); color: #000; }
      .banner.warn { background: #6b4a1f; color: #ffd9a0; font-weight: 500; }
      .banner[hidden] { display: none; }
      .menu-wrap, .export-wrap { position: relative; }
      .popover { position: absolute; top: calc(100% + 6px); z-index: 10; right: 0;
                 background: var(--panel); color: var(--text); border: 1px solid var(--border);
                 border-radius: 8px; padding: 10px; display: flex; flex-direction: column; gap: 6px;
                 box-shadow: 0 6px 18px rgba(0,0,0,.5); min-width: 200px; }
      .popover[hidden] { display: none; }
      .popover--left { left: 0; right: auto; }
      .popover label { display: flex; align-items: center; gap: 6px; justify-content: space-between; }
      .strings { display: flex; flex-direction: column; gap: 4px; }
      .string-row { display: flex; align-items: center; gap: 6px; }
      .string-row .lbl { width: 18px; color: var(--muted); text-align: right; }
      .string-controls { display: flex; gap: 4px; margin-top: 4px; }
      .auto-note { color: var(--muted); font-style: italic; font-size: 11px; }
      .exportFmt { display: flex; align-items: center; gap: 6px; justify-content: flex-start; }
    </style>
  </head>
  <body>
    <script id="tab-payload" type="application/json">__TAB_PAYLOAD_JSON__</script>

    <div class="app">
      <header class="topbar">
        <div class="menu-wrap">
          <button type="button" id="tuningToggle" class="ghost" aria-haspopup="true" aria-expanded="false">Tuning ▾</button>
          <div id="tuningPanel" class="popover popover--left" hidden>
            <label>Instrument
              <select id="preset" aria-label="Instrument preset"></select>
            </label>
            <div id="strings" class="strings" aria-label="Per-string tuning"></div>
            <div class="string-controls">
              <button type="button" id="removeString" class="ghost icon" aria-label="Remove a string">–</button>
              <button type="button" id="addString" class="ghost icon" aria-label="Add a string">+</button>
              <span class="auto-note">4–8 strings</span>
            </div>
            <label>Frets
              <input id="frets" type="number" min="12" max="30" step="1" aria-label="Fret count" />
            </label>
          </div>
        </div>

        <span class="spacer"></span>

        <div class="menu-wrap">
          <button type="button" id="quantizeToggle" class="ghost" aria-haspopup="true" aria-expanded="false">Quantize ▾</button>
          <div id="quantizePanel" class="popover" hidden>
            <label>Grid
              <select id="grid">
                <option value="off">Off</option>
                <option value="1/4">1/4</option>
                <option value="1/8">1/8</option>
                <option value="1/16">1/16</option>
                <option value="1/32">1/32</option>
              </select>
            </label>
          </div>
        </div>

        <div class="export-wrap">
          <button type="button" id="exportToggle" class="ghost" aria-haspopup="true" aria-expanded="false">Export ▾</button>
          <div id="exportPanel" class="popover" hidden>
            <label class="exportFmt"><input type="checkbox" class="exportFmt-cb" value="pdf" /> PDF</label>
            <label class="exportFmt"><input type="checkbox" class="exportFmt-cb" value="ascii" /> ASCII tab (.txt)</label>
            <label class="exportFmt"><input type="checkbox" class="exportFmt-cb" value="alphatex" /> alphaTex (.txt)</label>
            <button type="button" id="exportBtn" class="pill primary">Export</button>
            <span class="auto-note">Saves to the storage folder and reveals it in Finder.</span>
          </div>
        </div>

        <button type="button" id="closeBtn" class="ghost icon" title="Close" aria-label="Close">✕</button>
      </header>

      <div>
        <div id="staleBanner" class="banner stale" hidden></div>
        <div id="warnBanner" class="banner warn" hidden></div>
      </div>

      <main class="score-scroll">
        <div id="score"></div>
        <span id="status" class="caption"></span>
      </main>
    </div>

    <script type="module" src="./src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 2: Write `ui/src/main.ts`**

```ts
import { runPipeline, type PipelineOutput } from "./tab-pipeline";
import { renderAlphaTex, type RenderedScore } from "./render";
import { sanitize, asciiFile, alphatexFile } from "./export";
import { pdfFile } from "./pdf";
import type { TabPayload, TabResult, TabSettings, TabFormat, TabQuantize, ExportedFile } from "../../src/payload";
import { CUSTOM_PRESET_NAME, MIN_STRINGS, MAX_STRINGS } from "../../src/instruments";

const payload: TabPayload = JSON.parse(
  (document.getElementById("tab-payload") as HTMLScriptElement).textContent!,
);

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const presetSel = $<HTMLSelectElement>("preset");
const stringsEl = $<HTMLDivElement>("strings");
const fretsInput = $<HTMLInputElement>("frets");
const gridSel = $<HTMLSelectElement>("grid");
const scoreEl = $<HTMLDivElement>("score");
const statusEl = $<HTMLSpanElement>("status");
const staleBanner = $<HTMLDivElement>("staleBanner");
const warnBanner = $<HTMLDivElement>("warnBanner");

// ---- Mutable UI state (the source of truth for re-renders). ----
let tuning: string[] = [...payload.settings.tuning];
let presetName: string = payload.settings.preset;
let lastRender: PipelineOutput | null = null;

// ---- Populate the preset dropdown (presets + Custom). ----
for (const p of payload.presets) {
  const opt = document.createElement("option");
  opt.value = p.name;
  opt.textContent = p.name;
  presetSel.appendChild(opt);
}
const customOpt = document.createElement("option");
customOpt.value = CUSTOM_PRESET_NAME;
customOpt.textContent = CUSTOM_PRESET_NAME;
presetSel.appendChild(customOpt);
presetSel.value = presetName;
fretsInput.value = String(payload.settings.fretCount);
gridSel.value = payload.settings.quantizeGrid;

// ---- Per-string rows. Row 0 is the lowest-numbered string (top of the clef). ----
function buildStringRows(): void {
  stringsEl.innerHTML = "";
  tuning.forEach((note, i) => {
    const row = document.createElement("div");
    row.className = "string-row";
    const lbl = document.createElement("span");
    lbl.className = "lbl";
    lbl.textContent = String(tuning.length - i); // string number, high-numbered at the top
    const sel = document.createElement("select");
    sel.setAttribute("aria-label", `String ${tuning.length - i} note`);
    for (const name of payload.noteOptions) {
      const o = document.createElement("option");
      o.value = name;
      o.textContent = name;
      sel.appendChild(o);
    }
    sel.value = note;
    sel.addEventListener("change", () => {
      tuning[i] = sel.value;
      markCustom();
      void render();
    });
    row.append(lbl, sel);
    stringsEl.appendChild(row);
  });
}

/** Editing a string note (or string count) means the tuning no longer matches a preset. */
function markCustom(): void {
  presetName = CUSTOM_PRESET_NAME;
  presetSel.value = CUSTOM_PRESET_NAME;
}

function currentGrid(): TabQuantize {
  return gridSel.value as TabQuantize;
}

function currentSettings(formats: TabFormat[]): TabSettings {
  return {
    preset: presetName,
    tuning: [...tuning],
    fretCount: Number(fretsInput.value) || payload.settings.fretCount,
    quantizeGrid: currentGrid(),
    formats,
  };
}

// ---- Banners ----
function showStaleBanner(): void {
  const stale = payload.lastExportFingerprint !== null && payload.lastExportFingerprint !== payload.fingerprint;
  staleBanner.hidden = !stale;
  if (stale) staleBanner.textContent = "This clip changed since the last export.";
}
function showWarnings(warnings: string[]): void {
  warnBanner.hidden = warnings.length === 0;
  if (warnings.length) warnBanner.textContent = warnings.join("  •  ");
}
function showError(err: unknown): void {
  scoreEl.innerHTML = `<pre style="color:#b00;white-space:pre-wrap">Render failed: ${String(err)}</pre>`;
  console.error(err);
}

function updateStatus(): void {
  const p = payload.provenance;
  statusEl.textContent = `${p.clipName} · ${presetName} · ${tuning.join(" ")} · ${p.tempo} bpm · #${p.fingerprint}`;
}

// ---- The render pipeline (re-run on any control change). ----
async function render(): Promise<RenderedScore | null> {
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
    const width = Math.max(scoreEl.clientWidth - 4, 320);
    const rendered = await renderAlphaTex(out.tex, scoreEl, width);
    showWarnings(out.warnings);
    updateStatus();
    return rendered;
  } catch (err) {
    showError(err);
    return null;
  }
}

// ---- Export ----
function footerText(): string {
  const p = payload.provenance;
  return `${p.clipName} · ${presetName} · ${tuning.join(" ")} · ${p.tempo} bpm · #${p.fingerprint} · ${p.generatedAt}`;
}

function selectedFormats(): TabFormat[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>(".exportFmt-cb"))
    .filter((cb) => cb.checked)
    .map((cb) => cb.value as TabFormat);
}

function postResult(result: TabResult): void {
  const message = { method: "close_and_send", params: [JSON.stringify(result)] };
  const w = window as unknown as {
    webkit?: { messageHandlers?: { live?: { postMessage(m: unknown): void } } };
    chrome?: { webview?: { postMessage(m: unknown): void } };
  };
  if (w.webkit?.messageHandlers?.live) w.webkit.messageHandlers.live.postMessage(message);
  else if (w.chrome?.webview) w.chrome.webview.postMessage(message);
  else console.log("close_and_send", message); // browser dev fallback
}

async function doExport(): Promise<void> {
  const formats = selectedFormats();
  if (formats.length === 0) return;
  const rendered = await render(); // ensure SVG + lastRender reflect current controls
  if (!lastRender) return;
  const base = sanitize(payload.clipName);
  const files: ExportedFile[] = [];
  for (const fmt of formats) {
    if (fmt === "ascii") {
      files.push(asciiFile(base, lastRender.tab));
    } else if (fmt === "alphatex") {
      files.push(alphatexFile(base, lastRender.tex));
    } else if (fmt === "pdf" && rendered) {
      files.push(await pdfFile(base, rendered.svgs, footerText()));
    }
  }
  postResult({ files, settings: currentSettings(formats), fingerprint: payload.fingerprint });
}

// ---- Control wiring ----
presetSel.addEventListener("change", () => {
  if (presetSel.value === CUSTOM_PRESET_NAME) {
    presetName = CUSTOM_PRESET_NAME;
    return;
  }
  const p = payload.presets.find((x) => x.name === presetSel.value);
  if (p) {
    presetName = p.name;
    tuning = [...p.stringNames];
    fretsInput.value = String(p.fretCount);
    buildStringRows();
    void render();
  }
});

fretsInput.addEventListener("change", () => void render()); // fret count is orthogonal to preset identity

gridSel.addEventListener("change", () => void render());

$<HTMLButtonElement>("addString").addEventListener("click", () => {
  if (tuning.length >= MAX_STRINGS) return;
  // Add a new lowest string a fourth below the current lowest (best-effort default).
  tuning = [tuning[0], ...tuning];
  markCustom();
  buildStringRows();
  void render();
});
$<HTMLButtonElement>("removeString").addEventListener("click", () => {
  if (tuning.length <= MIN_STRINGS) return;
  tuning = tuning.slice(1);
  markCustom();
  buildStringRows();
  void render();
});

$<HTMLButtonElement>("exportBtn").addEventListener("click", () => void doExport());

// Initialise default export checkboxes from remembered formats.
for (const cb of Array.from(document.querySelectorAll<HTMLInputElement>(".exportFmt-cb"))) {
  cb.checked = payload.settings.formats.includes(cb.value as TabFormat);
}

// ---- Popovers ----
const POPOVERS: ReadonlyArray<[toggle: string, panel: string]> = [
  ["tuningToggle", "tuningPanel"],
  ["quantizeToggle", "quantizePanel"],
  ["exportToggle", "exportPanel"],
];
function closeAllPopovers(): void {
  for (const [toggle, panel] of POPOVERS) {
    $<HTMLDivElement>(panel).hidden = true;
    $(toggle).setAttribute("aria-expanded", "false");
  }
}
for (const [toggleId, panelId] of POPOVERS) {
  const toggle = $<HTMLButtonElement>(toggleId);
  const panel = $<HTMLDivElement>(panelId);
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = panel.hidden;
    closeAllPopovers();
    panel.hidden = !willOpen;
    toggle.setAttribute("aria-expanded", String(willOpen));
  });
  panel.addEventListener("click", (e) => e.stopPropagation());
}
document.addEventListener("click", closeAllPopovers);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeAllPopovers();
});

// Close without exporting (the SDK modal has no working native close button).
$<HTMLButtonElement>("closeBtn").addEventListener("click", () =>
  postResult({ files: [], settings: currentSettings(payload.settings.formats), fingerprint: payload.fingerprint }),
);

// ---- Initial render. Defer two frames so the score container has a real width. ----
buildStringRows();
showStaleBanner();
requestAnimationFrame(() =>
  requestAnimationFrame(() => {
    void render();
  }),
);
```

- [ ] **Step 3: Type-check the webview**

Run: `npx tsc -p ui/tsconfig.json`
Expected: PASS. (`lastRender` is typed as `PipelineOutput`, so `lastRender.tab` flows into `asciiFile` as a real `GeneratedTab` with no cast.)

- [ ] **Step 4: Build the single-file webview**

Run: `npm run build:ui`
Expected: Vite writes `ui/dist/index.html` as one self-contained file. The build should report a single output HTML asset. If it fails resolving `@tutts/*`, build `../tutts` first.

- [ ] **Step 5: Commit**

```bash
git add ui/index.html ui/src/main.ts
git commit -m "Add webview HTML shell and main controller wiring"
```

---

## Task 11: Full build, README, and manual verification in Live

End-to-end: build the extension, document it, and verify rendering + every export inside Live (the rendering layer is DOM/visual and not unit-tested, matching the sheet music extension's posture toward OSMD).

**Files:**
- Create: `README.md`

- [ ] **Step 1: Full type-check, tests, and production build**

Run: `npm test && npm run test:integration && npm run build`
Expected: pure tests PASS, integration test PASS, `tsc` clean, esbuild writes `dist/extension.js`. (`npm run build` runs `build:ui` first, so `ui/dist/index.html` is fresh and embedded in the Node bundle.)

- [ ] **Step 2: Write `README.md`**

````markdown
# Tablature — Ableton Live Extension

Right-click a MIDI clip in Live and choose **Show Tab** to render it as stringed-instrument tablature. Pick an instrument preset or set a custom tuning and string count, then export to PDF, ASCII tab, or alphaTex.

## How it works

- **Node side** (`src/`) reads the clip + song context and opens a modal webview. It carries no music logic.
- **Webview** (`ui/`) builds a [`tutts`](../tutts/) `Tuning`, runs `@tutts/core` `generateTab` → `@tutts/alphatab` `toAlphaTex`, and renders the alphaTex to SVG with [AlphaTab](https://alphatab.net/) (low-level, offline, Bravura bundled inline).

## Develop

Requires the Ableton Extensions SDK (private beta) and the local `tutts` repo built at `../tutts`.

```bash
cp .env.example .env          # set ABLETON_SDK_PATH to your unpacked SDK
npm run setup                 # vendor the SDK tarballs + install
npm run embed-font            # regenerate the bundled Bravura font (after alphatab bumps)
npm start                     # build + run in the Extensions CLI
```

| Command | Purpose |
|---|---|
| `npm test` | Pure unit tests (CI-safe; no SDK/`tutts` needed). |
| `npm run test:integration` | `tutts` pipeline test (needs `../tutts` built). |
| `npm run build` | Production build → `dist/extension.js`. |
| `npm run package` | Build the installable `.ablx` into `release/`. |

## Releasing

`tutts` is referenced by `file:../tutts/...` during development. Before publishing this extension, publish `@tutts/core` and `@tutts/alphatab` to npm and switch the two `file:` deps in `package.json` to published version ranges. That also restores the UI type-check + build to CI.

## Exports

PDF (raster, with provenance footer), ASCII tab (`.txt`), alphaTex source (`.alphatex.txt`). Files land in the extension's storage folder under `tabs/` and are revealed in Finder.
````

- [ ] **Step 3: Package and install in Live**

Run: `npm run package -- --reveal`
Then drag `release/Tablature-0.1.0.ablx` onto Live → Preferences → Extensions. (Or use `npm start` for a dev session against `.dev/storage`.)

- [ ] **Step 4: Manual verification checklist**

In Live, create a MIDI clip with a short monophonic riff and a couple of chords, then right-click → **Show Tab**. Verify:
  - [ ] The tab renders with readable fret numbers, the rhythm row, the time signature, and the "TAB" clef (glyphs are real, not boxes — if they are boxes, the Bravura `@font-face`/`smuflFontSources` wiring in `render.ts` needs the correct `FontFileFormat`/family; re-check Task 8 step 2).
  - [ ] Switching the **Instrument** preset re-renders with the new tuning and updates the per-string rows + fret count.
  - [ ] Editing a per-string note flips the preset selector to **Custom** and re-renders.
  - [ ] **+ / −** add/remove a string within 4–8 and re-render.
  - [ ] Changing **Frets** re-renders without flipping the preset to Custom.
  - [ ] **Quantize** Off vs 1/16 changes the rhythm.
  - [ ] A chord `tutts` can't fit surfaces a non-blocking **warnings** banner rather than failing.
  - [ ] **Export** with all three formats checked writes `<Clip>.pdf`, `<Clip>.txt`, `<Clip>.alphatex.txt` to the storage `tabs/` folder and reveals the first in Finder. Open the PDF: the tab is present with the provenance footer. Open the `.txt`: it is the ASCII tab. Open the `.alphatex.txt`: it is valid alphaTex.
  - [ ] Reopen the dialog: the remembered preset/tuning/frets/grid/format are restored, and if the clip was edited since the last export, the **staleness** banner shows.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "Add README and complete v0.1.0 manual verification"
```

---

## Self-review notes (for the implementer)

- **String numbering / reversal** is the subtlest correctness point. UI stores tuning low-string-first (row 0 = lowest-numbered string). `buildTuning` reverses to `tutts`' thin→thick before constructing `Tuning`. The Task 3 test pins `[...stringNames].reverse()` against the literal `tutts` arrays; the Task 6 integration test pins the resulting string *pitches*. If a tab renders upside-down in Live, that reversal is where to look.
- **CI is intentionally thin** (pure unit tests only) until `tutts` is on npm. The UI type-check + build are local-only and must be run by hand (Tasks 6/8/9/10) — the plan calls `npx tsc -p ui/tsconfig.json` and `npm run build:ui` at each UI step precisely because CI won't.
- **The one external-API risk** is the AlphaTab offline-font wiring (Task 8): `FontFileFormat.Woff2`, `StaveProfile.Tab`, and the low-level event signatures. Each is flagged with the exact `.d.ts` to check, and the manual render in Task 11 is the catch-all.
