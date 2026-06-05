import { describe, it, expect } from "vitest";
import { fileUrl } from "./file-url";

describe("fileUrl", () => {
  it("produces a file: URL", () => {
    expect(fileUrl("/tmp/x.html")).toBe("file:///tmp/x.html");
  });
  it("percent-encodes spaces", () => {
    expect(fileUrl("/tmp/a b/x.html")).toBe("file:///tmp/a%20b/x.html");
  });
});
