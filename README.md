# Tablature — Ableton Live Extension

Right-click a MIDI clip in Live and choose **Show Tab** to render it as stringed-instrument tablature. Pick an instrument preset or set a custom tuning and string count, then export to PDF or ASCII tab.

## How it works

- **Node side** (`src/`) reads the clip + song context and opens a modal webview. It carries no music logic.
- **Webview** (`ui/`) builds a `tutts` `Tuning`, runs `@tutts/core` `generateTab`, and renders the result as monospace ASCII tablature (`@tutts/core`'s `toLines`/`toSystems`). No graphical engine or music font — every glyph is plain text.

## Develop

Requires the Ableton Extensions SDK (private beta) and the local `tutts` repo built at `../tutts`.

```bash
cp .env.example .env          # set ABLETON_SDK_PATH to your unpacked SDK
npm run setup                 # vendor the SDK tarballs + install
npm start                     # build + run in the Extensions CLI
```

| Command | Purpose |
|---|---|
| `npm test` | Pure unit tests (CI-safe; no SDK/`tutts` needed). |
| `npm run test:integration` | `tutts` pipeline test (needs `../tutts` built). |
| `npm run typecheck` | Type-check the Node side + the webview. |
| `npm run build` | Production build → `dist/extension.js`. |
| `npm run package` | Build the installable `.ablx` into `release/`. |

## Releasing

`tutts` is referenced by `file:../tutts/...` during development. Before publishing this extension, publish `@tutts/core` to npm and switch the `file:` dep in `package.json` to a published version range. That also restores the UI type-check + build to CI.

## Exports

PDF (vector monospace text, with provenance footer) and ASCII tab (`.txt`). Files land in the extension's storage folder under `tabs/` and are revealed in Finder.
