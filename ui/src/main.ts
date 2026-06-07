import { runPipeline, type PipelineOutput } from "./tab-pipeline";
import { renderAscii } from "./render";
import { sanitize, asciiFile } from "./export";
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
const creditsOverlay = $<HTMLDivElement>("credits");

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

// ---- Per-string rows. Row 0 is the lowest-pitched (highest-numbered) string, at the top. ----
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
  // textContent (not innerHTML) so an error string can never inject markup.
  const pre = document.createElement("pre");
  pre.style.color = "#b00";
  pre.style.whiteSpace = "pre-wrap";
  pre.textContent = `Render failed: ${String(err)}`;
  scoreEl.replaceChildren(pre);
  console.error(err);
}

function updateStatus(): void {
  const p = payload.provenance;
  statusEl.textContent = `${p.clipName} · ${presetName} · ${tuning.join(" ")} · ${p.tempo} bpm · #${p.fingerprint}`;
}

// ---- The render pipeline (re-run on any control change). ----
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
    showWarnings([]); // don't leave a stale warning banner over the error
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

function doExport(): void {
  const formats = selectedFormats();
  if (formats.length === 0) return;
  try {
    render(); // ensure the view + lastRender reflect the current controls
    if (!lastRender) return; // render failed; the error is already shown — keep the dialog open
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
    // Surface any export failure and keep the dialog open rather than letting it
    // become a silent error.
    showWarnings([`Export failed: ${String(err)}`]);
    console.error(err);
  }
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
  // Duplicate the current lowest string as a placeholder; the user picks the real note.
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
  if (e.key === "Escape") {
    closeAllPopovers();
    creditsOverlay.hidden = true;
  }
});

// ---- Credits overlay (info button → full-screen credits) ----
$<HTMLButtonElement>("infoBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  closeAllPopovers();
  creditsOverlay.hidden = false;
});
$<HTMLButtonElement>("creditsClose").addEventListener("click", () => {
  creditsOverlay.hidden = true;
});

// Close without exporting (the SDK modal has no working native close button).
$<HTMLButtonElement>("closeBtn").addEventListener("click", () =>
  // Persist the live UI state (incl. the current format checkboxes) on close, like the other controls.
  postResult({ files: [], settings: currentSettings(selectedFormats()), fingerprint: payload.fingerprint }),
);

// ---- Initial render. Defer two frames so the score container has a real width. ----
buildStringRows();
showStaleBanner();
requestAnimationFrame(() =>
  requestAnimationFrame(() => {
    void render();
  }),
);
