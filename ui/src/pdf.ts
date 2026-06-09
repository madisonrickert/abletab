import { jsPDF } from "jspdf";
import type { GeneratedTab } from "tutts";
import type { ExportedFile } from "../../src/payload";

const FONT_PT = 9;
const CHAR_RATIO = 0.6; // Courier advance / font size
const LINE_PT = FONT_PT * 1.25;
const SYSTEM_GAP_PT = LINE_PT; // blank line between systems
const MARGIN = 36;

/**
 * Build a PDF of the tab as vector Courier text: wrap to the page width, draw
 * each system block, paginate on overflow, then a provenance footer. No raster,
 * no embedded font — Courier is a PDF base-14 font, always available.
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
    // Page break before a system that would overflow (but never on a fresh page).
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

  // Provenance footer on every page (drawn after pagination so the page count is final).
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.setTextColor(110);
  const pageCount = pdf.getNumberOfPages();
  for (let page = 1; page <= pageCount; page++) {
    pdf.setPage(page);
    const label = pageCount > 1 ? `${footer} · p. ${page}/${pageCount}` : footer;
    pdf.text(label, MARGIN, pageH - 12);
  }

  return {
    name: `${base}.pdf`,
    format: "pdf",
    encoding: "base64",
    data: pdf.output("datauristring").split(",")[1],
  };
}
