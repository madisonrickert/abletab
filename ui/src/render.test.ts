// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { generateTab, Tuning } from "@tutts/core";
import { renderAscii, columnsForWidth } from "./render";

describe("columnsForWidth", () => {
  it("falls back to a fixed width when the host has no measured width yet", () => {
    expect(columnsForWidth(0, 13)).toBe(90);
  });
  it("derives more columns from a wider host", () => {
    const narrow = columnsForWidth(400, 13);
    const wide = columnsForWidth(1200, 13);
    expect(wide).toBeGreaterThan(narrow);
    expect(narrow).toBeGreaterThanOrEqual(24);
  });
});

describe("renderAscii", () => {
  it("writes a monospace <pre class=tab> of the tab into the host", () => {
    const tab = generateTab({
      notes: [{ midi: 64, startBeats: 0, durationBeats: 1 }],
      tuning: Tuning.standardGuitar(),
    });
    const host = document.createElement("div");
    renderAscii(tab, host);
    const pre = host.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre!.classList.contains("tab")).toBe(true);
    expect(pre!.textContent).toContain("||"); // string-name header
  });

  it("replaces previous content on re-render (no stale nodes)", () => {
    const tab = generateTab({
      notes: [{ midi: 64, startBeats: 0, durationBeats: 1 }],
      tuning: Tuning.standardGuitar(),
    });
    const host = document.createElement("div");
    renderAscii(tab, host);
    renderAscii(tab, host);
    expect(host.querySelectorAll("pre")).toHaveLength(1);
  });
});
