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
  // If font loading fails, clear the memo so a later render can retry instead of
  // being stuck on a permanently-rejected promise.
  return fontReady.catch((e) => {
    fontReady = null;
    throw e;
  });
}

function buildSettings(): alphaTab.Settings {
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
  return settings;
}

/** Render `tex` into `host` as inline SVG. Synchronous render under the hood. */
export async function renderAlphaTex(tex: string, host: HTMLElement, width: number): Promise<RenderedScore> {
  // AlphaTab's render() bails out (no chunks, no renderFinished) when width is 0,
  // which would look like an empty score; fail loudly instead.
  if (width <= 0) throw new Error("renderAlphaTex: width must be > 0");
  await ensureFont();
  const settings = buildSettings();

  const importer = new alphaTab.importer.AlphaTexImporter();
  importer.initFromString(tex, settings);
  const score = importer.readScore();

  // Tab-only: hide the standard-notation staff on every staff. This is the
  // non-deprecated replacement for the global `settings.display.staveProfile =
  // StaveProfile.Tab` (deprecated in AlphaTab 1.6 in favour of per-Staff flags).
  for (const track of score.tracks) {
    for (const staff of track.staves) {
      staff.showStandardNotation = false;
      staff.showTablature = true;
    }
  }

  const renderer = new alphaTab.rendering.ScoreRenderer(settings);
  renderer.width = width;

  const chunks: string[] = [];
  let totalWidth = 0;
  let totalHeight = 0;
  let renderError: unknown = null;
  // ScoreRenderer catches internal render failures and emits them on `error`
  // instead of throwing, so capture and rethrow — otherwise a failed render
  // returns a silent empty result and the webview just shows a blank score.
  renderer.error.on((e) => {
    renderError = e;
  });
  // Callback params infer from AlphaTab's typed event emitters (RenderFinishedEventArgs),
  // so a property rename would surface as a type error at the access site.
  renderer.preRender.on(() => {
    chunks.length = 0;
  });
  // With enableLazyLoading=false AlphaTab renders each chunk immediately inside
  // registerPartial; this renderResult call is a no-op here but keeps the handler
  // correct for the lazy path.
  renderer.partialLayoutFinished.on((r) => renderer.renderResult(r.id));
  renderer.partialRenderFinished.on((r) => {
    chunks.push(String(r.renderResult));
  });
  renderer.renderFinished.on((r) => {
    totalWidth = r.totalWidth;
    totalHeight = r.totalHeight;
  });

  renderer.renderScore(score, [0]); // synchronous: chunks are fully populated after this returns
  if (renderError) throw renderError;

  host.innerHTML = "";
  const svgs: SVGSVGElement[] = [];
  for (const svgString of chunks) {
    const wrap = document.createElement("div");
    wrap.innerHTML = svgString.trim();
    const svg = wrap.querySelector("svg");
    if (svg) {
      host.appendChild(svg);
      svgs.push(svg as SVGSVGElement);
    }
  }
  renderer.destroy(); // release AlphaTab's internal buffers (one-shot render)
  return { svgs, totalWidth, totalHeight };
}
