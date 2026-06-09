import { describe, it, expect } from "vitest";
import {
  injectLicenses,
  injectPayload,
  escapeForScriptJson,
  LICENSES_TOKEN,
  PAYLOAD_TOKEN,
  type TabPayload,
} from "./payload";
import { INSTRUMENTS, chromaticNoteNames } from "./instruments";

const payload: TabPayload = {
  clipName: "Verse <Riff>",
  notes: [{ midi: 40, startBeats: 0, durationBeats: 1 }],
  tempo: 120,
  timeSig: { numerator: 4, denominator: 4 },
  presets: INSTRUMENTS,
  noteOptions: chromaticNoteNames(0, 6),
  settings: {
    preset: "Standard Guitar",
    tuning: ["E2", "A2", "D3", "G3", "B3", "E4"],
    fretCount: 20,
    quantizeGrid: "1/16",
    formats: ["pdf"],
  },
  fingerprint: "a3f9c1",
  lastExportFingerprint: null,
  provenance: { clipName: "Verse <Riff>", tempo: 120, fingerprint: "a3f9c1", generatedAt: "2026-06-05T00:00:00Z" },
};

describe("escapeForScriptJson", () => {
  it("escapes < so a </script> cannot appear", () => {
    expect(escapeForScriptJson('{"x":"</script>"}')).toBe('{"x":"\\u003c/script>"}');
  });
});

describe("injectPayload", () => {
  const html = `<html><body><script id="tab-payload" type="application/json">${PAYLOAD_TOKEN}</script></body></html>`;

  it("replaces the token with escaped JSON and round-trips via JSON.parse", () => {
    const result = injectPayload(html, payload);
    expect(result).not.toContain(PAYLOAD_TOKEN);
    const json = result.match(/type="application\/json">([\s\S]*?)<\/script>/)![1];
    expect(JSON.parse(json)).toEqual(payload);
  });

  it("does not expand $-patterns from the payload (clip name with $& $' $`)", () => {
    const tricky: TabPayload = { ...payload, clipName: "$& $` $' $$ Intro" };
    const result = injectPayload(html, tricky);
    expect(result).not.toContain(PAYLOAD_TOKEN);
    const json = result.match(/type="application\/json">([\s\S]*?)<\/script>/)![1];
    expect(JSON.parse(json).clipName).toBe("$& $` $' $$ Intro");
  });

  it("throws when the token is missing", () => {
    expect(() => injectPayload("<html></html>", payload)).toThrow(/token/i);
  });
});

describe("injectLicenses", () => {
  const html = `<script id="licenses-payload" type="application/json">${LICENSES_TOKEN}</script>`;

  it("encodes the notices as an escaped JSON string that round-trips", () => {
    const notices = 'MIT License\n\n</script><b>nope</b>\nCopyright (c) "someone"';
    const result = injectLicenses(html, notices);
    expect(result).not.toContain(LICENSES_TOKEN);
    expect(result).not.toContain("</script><b>"); // `<` escaped: can't close the host tag
    const json = result.match(/type="application\/json">([\s\S]*?)<\/script>/)![1];
    expect(JSON.parse(json)).toBe(notices);
  });

  it("does not expand $-patterns from license text", () => {
    const result = injectLicenses(html, "fee of $& or $` per copy");
    const json = result.match(/type="application\/json">([\s\S]*?)<\/script>/)![1];
    expect(JSON.parse(json)).toBe("fee of $& or $` per copy");
  });

  it("throws when the token is missing", () => {
    expect(() => injectLicenses("<html></html>", "MIT")).toThrow(/token/i);
  });
});
