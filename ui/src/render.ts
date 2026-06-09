import type { GeneratedTab } from "tutts";

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
