import type { GeneratedTab } from "@tutts/core";
import type { ExportedFile } from "../../src/payload";

/** Make a clip name safe as a file name: strip path-hostile chars, never empty,
 *  and cap the length so the OS can't reject it (filenames have a 255-byte limit;
 *  200 leaves room for the extension suffix). */
export function sanitize(name: string): string {
  return (name.replace(/[\\/:*?"<>|]/g, "_").trim() || "tab").slice(0, 200);
}

export function asciiFile(base: string, tab: GeneratedTab): ExportedFile {
  return { name: `${base}.txt`, format: "ascii", encoding: "text", data: tab.toAscii() };
}

export function alphatexFile(base: string, tex: string): ExportedFile {
  return { name: `${base}.alphatex.txt`, format: "alphatex", encoding: "text", data: tex };
}
