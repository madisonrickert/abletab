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
    const cctx = canvas.getContext("2d");
    if (!cctx) throw new Error("pdfFile: canvas 2d context unavailable");
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
