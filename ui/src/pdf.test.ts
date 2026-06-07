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
