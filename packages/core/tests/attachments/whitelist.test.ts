import { describe, expect, it } from "vitest";
import {
  evaluateAttachmentAllowlist,
  sanitizeFilename,
} from "../../src/attachments/index.js";

describe("evaluateAttachmentAllowlist", () => {
  it("allows safe document and image types", () => {
    for (const [name, mime] of [
      ["report.pdf", "application/pdf"],
      ["photo.png", "image/png"],
      ["shot.jpg", "image/jpeg"],
      ["data.csv", "text/csv"],
      ["sheet.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
      ["brief.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
      ["notes.txt", "text/plain"],
    ] as const) {
      const decision = evaluateAttachmentAllowlist(name, mime);
      expect(decision.allowed, name).toBe(true);
    }
  });

  it("denies dangerous executables and scripts", () => {
    for (const name of [
      "payload.exe",
      "run.scr",
      "hook.js",
      "invoice.pdf.exe",
      "dropper.bat",
      "tool.ps1",
      "lib.dll",
    ]) {
      const decision = evaluateAttachmentAllowlist(name, "application/octet-stream");
      expect(decision.allowed, name).toBe(false);
    }
  });

  it("sanitizes pathy filenames", () => {
    expect(sanitizeFilename("../../etc/passwd.pdf")).toBe("passwd.pdf");
    expect(sanitizeFilename("weird name!!!.csv")).toBe("weird name_.csv");
  });
});
