# Tablature: an Ableton Live Extension

Right-click a MIDI clip in Live and choose **Show Tab** to render it as stringed-instrument tablature. Pick an instrument preset or set a custom tuning and string count, then export to PDF or ASCII tab.

## How it works

- **Node side** (`src/`) reads the clip + song context and opens a modal webview. It carries no music logic.
- **Webview** (`ui/`) builds a [`tutts`](https://github.com/madisonrickert/tutts) `Tuning`, runs `generateTab`, and renders the result as monospace ASCII tablature (`tutts`' `toLines`/`toSystems`). No graphical engine or music font: every glyph is plain text.

## Develop

Requires the Ableton Extensions SDK (private beta). The tab engine, [`tutts`](https://www.npmjs.com/package/tutts), installs from npm.

```bash
cp .env.example .env          # set ABLETON_SDK_PATH to your unpacked SDK
npm run setup                 # vendor the SDK tarballs + install
npm start                     # build + run in the Extensions CLI
```

| Command | Purpose |
|---|---|
| `npm test` | Pure unit tests (CI-safe; no SDK needed). |
| `npm run test:integration` | `tutts` pipeline test. |
| `npm run typecheck` | Type-check the Node side + the webview. |
| `npm run build` | Production build → `dist/extension.js`. |
| `npm run package` | Build the installable `.ablx` into `release/`. |

## Exports

PDF (vector monospace text, with provenance footer) and ASCII tab (`.txt`). Files land in the extension's storage folder under `tabs/` and are revealed in Finder.
