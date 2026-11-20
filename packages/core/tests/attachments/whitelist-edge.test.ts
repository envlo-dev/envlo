import { describe, expect, it } from "vitest";
import {
  ALLOWED_EXTENSIONS,
  DENIED_EXTENSIONS,
  evaluateAttachmentAllowlist,
  extensionOf,
  mimeForExtension,
} from "../../src/attachments/index.js";

describe("whitelist edge cases", () => {
  it("includes ticket-required allowlist extensions", () => {
    for (const ext of [".pdf", ".png", ".jpg", ".csv", ".xlsx", ".docx", ".txt"]) {
      expect(ALLOWED_EXTENSIONS.has(ext), ext).toBe(true);
    }
  });

  it("includes ticket-required denylist extensions", () => {
    for (const ext of [".exe", ".js", ".scr"]) {
      expect(DENIED_EXTENSIONS.has(ext), ext).toBe(true);
    }
  });

  it("allows MIME-only when filename has no extension", () => {
    const decision = evaluateAttachmentAllowlist("invoice", "application/pdf");
    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.extension).toBe(".pdf");
      expect(decision.mimeType).toBe("application/pdf");
    }
  });

  it("allows extension-only when MIME is missing or octet-stream", () => {
    const decision = evaluateAttachmentAllowlist("sheet.xlsx", null);
    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.mimeType).toBe(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
    }
  });

  it("denies unknown extensions even with allowlisted MIME spoof", () => {
    expect(extensionOf("blob.bin")).toBe(".bin");
    expect(ALLOWED_EXTENSIONS.has(".bin")).toBe(false);
    const decision = evaluateAttachmentAllowlist("blob.bin", "application/pdf");
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe("extension-not-allowed:.bin");
    }
  });

  it("maps common extensions to MIME", () => {
    expect(mimeForExtension(".png")).toBe("image/png");
    expect(mimeForExtension(".JPG")).toBe("image/jpeg");
    expect(mimeForExtension(".docx")).toContain("wordprocessingml");
  });

  it("strips content-type parameters before MIME checks", () => {
    const decision = evaluateAttachmentAllowlist(
      "a.pdf",
      "application/pdf; charset=binary",
    );
    expect(decision.allowed).toBe(true);
  });
});
