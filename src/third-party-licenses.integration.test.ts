import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Guards the shipped license compliance: a real `vite build` must regenerate the
// third-party notices, and every bundled package whose license requires it must
// appear with its full text. If a future dependency silently drops out of the
// bundle's notices, this fails loudly — that's the whole point of the test.
const reportPath = fileURLToPath(new URL("../ui/dist/third-party-licenses.txt", import.meta.url));

describe("third-party license notices", () => {
  let report = "";

  beforeAll(() => {
    // npm picks the right local vite; build:ui is what runs rollup-plugin-license.
    execFileSync("npm", ["run", "build:ui"], { stdio: "inherit" });
    report = readFileSync(reportPath, "utf-8");
  });

  it("reproduces the MIT-licensed bundled dependencies", () => {
    for (const pkg of ["tutts", "jspdf"]) {
      expect(report).toContain(pkg);
    }
    expect(report).toContain("MIT");
    expect(report).toMatch(/Permission is hereby granted, free of charge/); // MIT body
  });

  it("reproduces tutts' attribution chain (the tuttut port notice)", () => {
    // tutts' LICENSE carries Nathan Candre's tuttut copyright line; shipping it
    // is how the extension satisfies the upstream MIT attribution.
    expect(report).toContain("Nathan Candre");
  });
});
