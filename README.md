# Tablature — Ableton Live Extension

Right-click a MIDI clip in Live and choose **Show Tab** to render it as stringed-instrument tablature. Pick an instrument preset or set a custom tuning and string count, then export to PDF, ASCII tab, or alphaTex.

## How it works

- **Node side** (`src/`) reads the clip + song context and opens a modal webview. It carries no music logic.
- **Webview** (`ui/`) builds a `tutts` `Tuning`, runs `@tutts/core` `generateTab` → `@tutts/alphatab` `toAlphaTex`, and renders the alphaTex to SVG with [AlphaTab](https://alphatab.net/) (low-level, offline, Bravura bundled inline).

## Develop

Requires the Ableton Extensions SDK (private beta) and the local `tutts` repo built at `../tutts`.

```bash
cp .env.example .env          # set ABLETON_SDK_PATH to your unpacked SDK
npm run setup                 # vendor the SDK tarballs + install
npm start                     # build + run in the Extensions CLI
```

> The bundled Bravura font (`ui/src/bravura-font.ts`) is committed, so a fresh clone needs nothing extra. Run `npm run embed-font` only if that file is missing or after bumping `@coderline/alphatab`.

| Command | Purpose |
|---|---|
| `npm test` | Pure unit tests (CI-safe; no SDK/`tutts` needed). |
| `npm run test:integration` | `tutts` pipeline test (needs `../tutts` built). |
| `npm run typecheck` | Type-check the Node side + the webview. |
| `npm run build` | Production build → `dist/extension.js`. |
| `npm run package` | Build the installable `.ablx` into `release/`. |

## Releasing

`tutts` is referenced by `file:../tutts/...` during development. Before publishing this extension, publish `@tutts/core` and `@tutts/alphatab` to npm and switch the two `file:` deps in `package.json` to published version ranges. That also restores the UI type-check + build to CI.

## Exports

PDF (raster, with provenance footer), ASCII tab (`.txt`), alphaTex source (`.alphatex.txt`). Files land in the extension's storage folder under `tabs/` and are revealed in Finder.
