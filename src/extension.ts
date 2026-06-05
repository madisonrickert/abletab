import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile } from "node:child_process";
import {
  initialize,
  MidiClip,
  type ActivationContext,
  type Handle,
} from "@ableton-extensions/sdk";

import bundledHtml from "../ui/dist/index.html";
import { toNoteModels } from "./notation/notes";
import { fingerprintNotes } from "./notation/fingerprint";
import type { NoteModel } from "./notation/types";
import { INSTRUMENTS, chromaticNoteNames } from "./instruments";
import { fileUrl } from "./file-url";
import { injectPayload, type TabPayload, type TabResult, type TabSettings } from "./payload";

const standard = INSTRUMENTS[0]; // Standard Guitar
const DEFAULT_SETTINGS: TabSettings = {
  preset: standard.name,
  tuning: [...standard.stringNames],
  fretCount: standard.fretCount,
  quantizeGrid: "1/16",
  formats: ["pdf"],
};

const NOTE_OPTIONS = chromaticNoteNames(0, 6);

/** Reveal a saved file in Finder (best-effort; macOS `open -R`). */
function revealInFinder(filePath: string): void {
  // execFile reports errors via its callback (it does not throw synchronously),
  // so log there. A failed reveal is non-fatal.
  execFile("open", ["-R", filePath], (err) => {
    if (err) console.error("Tablature: couldn't reveal the file in Finder.", err);
  });
}

export function activate(activation: ActivationContext) {
  const ctx = initialize(activation, "1.0.0");

  const storageDir = () => {
    const d = ctx.environment.storageDirectory;
    if (!d) throw new Error("No storage directory available.");
    return d;
  };
  const tempDir = () => {
    const d = ctx.environment.tempDirectory;
    if (!d) throw new Error("No temp directory available.");
    return d;
  };

  async function readJson<T>(file: string, fallback: T): Promise<T> {
    try {
      return JSON.parse(await fs.readFile(file, "utf-8")) as T;
    } catch {
      return fallback;
    }
  }

  /** Read the clip + song context needed to build a tab payload. */
  function readClip(handle: Handle): {
    clipName: string;
    notes: NoteModel[];
    tempo: number;
    timeSig: { numerator: number; denominator: number };
    fingerprint: string;
  } {
    const clip = ctx.getObjectFromHandle(handle, MidiClip);
    const notes = toNoteModels(clip.notes);
    const song = ctx.application.song;
    const scene = song.scenes[0];
    // The SDK returns BigInt at runtime for numeric fields (despite the .d.ts
    // declaring `number`), so coerce every numeric read with Number(). A scene's
    // signature is -1 when it follows the (SDK-inaccessible) global signature, so
    // treat any non-positive value as "unset" and default to 4/4.
    const sigNum = Number(scene?.signatureNumerator);
    const sigDen = Number(scene?.signatureDenominator);
    return {
      clipName: clip.name,
      notes,
      tempo: Number(song.tempo),
      timeSig: {
        numerator: sigNum > 0 ? sigNum : 4,
        denominator: sigDen > 0 ? sigDen : 4,
      },
      fingerprint: fingerprintNotes(notes),
    };
  }

  async function writeFiles(files: TabResult["files"]): Promise<string[]> {
    const dir = path.join(storageDir(), "tabs");
    await fs.mkdir(dir, { recursive: true });
    const written: string[] = [];
    for (const f of files) {
      // Defense in depth: basename strips any path components so a webview-supplied
      // name can't escape tabs/ (the webview also sanitizes the name before sending).
      const dest = path.join(dir, path.basename(f.name));
      if (f.encoding === "base64") await fs.writeFile(dest, Buffer.from(f.data, "base64"));
      else await fs.writeFile(dest, f.data, "utf-8");
      written.push(dest);
    }
    return written;
  }

  async function persistSettings(settings: TabSettings): Promise<void> {
    await fs.writeFile(path.join(storageDir(), "settings.json"), JSON.stringify(settings, null, 2), "utf-8");
  }

  async function persistLastExport(clipName: string, fingerprint: string, formats: string[]): Promise<void> {
    const file = path.join(storageDir(), "last-export.json");
    const map = await readJson<Record<string, { fingerprint: string; ts: string; formats: string[] }>>(file, {});
    map[clipName] = { fingerprint, ts: new Date().toISOString(), formats };
    await fs.writeFile(file, JSON.stringify(map, null, 2), "utf-8");
  }

  // ---- "Show Tab" (interactive) -------------------------------------------------
  ctx.commands.registerCommand("tablature.showTab", (arg: unknown) => {
    void (async () => {
      try {
        const clip = readClip(arg as Handle);
        if (clip.notes.length === 0) {
          console.log("Tablature: clip has no notes — nothing to render.");
          return;
        }
        const settings = await readJson(path.join(storageDir(), "settings.json"), DEFAULT_SETTINGS);
        const lastExport = await readJson<Record<string, { fingerprint: string }>>(
          path.join(storageDir(), "last-export.json"),
          {},
        );
        const payload: TabPayload = {
          clipName: clip.clipName,
          notes: clip.notes,
          tempo: clip.tempo,
          timeSig: clip.timeSig,
          presets: INSTRUMENTS,
          noteOptions: NOTE_OPTIONS,
          settings,
          fingerprint: clip.fingerprint,
          lastExportFingerprint: lastExport[clip.clipName]?.fingerprint ?? null,
          provenance: {
            clipName: clip.clipName,
            tempo: clip.tempo,
            fingerprint: clip.fingerprint,
            generatedAt: new Date().toISOString(),
          },
        };
        const html = injectPayload(bundledHtml, payload);
        const uiPath = path.join(tempDir(), "tab-ui.html");
        await fs.writeFile(uiPath, html, "utf-8");

        const raw = await ctx.ui.showModalDialog(fileUrl(uiPath), 900, 640);
        if (!raw) return; // dialog dismissed without a result
        const result = JSON.parse(raw) as TabResult;
        await persistSettings(result.settings); // remember preset / tuning / frets / grid / format
        if (result.files.length) {
          const written = await writeFiles(result.files);
          await persistLastExport(clip.clipName, result.fingerprint, result.settings.formats);
          console.log(`Tablature: wrote ${written.length} file(s):\n${written.join("\n")}`);
          revealInFinder(written[0]);
        }
      } catch (err) {
        console.error("Tablature: couldn't render that clip — right-click it again.", err);
      }
    })();
  });

  ctx.ui.registerContextMenuAction("MidiClip", "Show Tab", "tablature.showTab");
}
