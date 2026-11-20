import { mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PRO_MAX_ATTACHMENT_BYTES,
  SANDBOX_MAX_ATTACHMENT_BYTES,
  defaultAttachmentsRoot,
  isBlockedAttachmentHost,
  policyForTier,
  resolveMaxBytes,
  resolveUnderAllowedRoots,
} from "../../src/attachments/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe("attachment policy", () => {
  it("caps sandbox at 1MB (metadata-only) and pro at 5MB", () => {
    const sandbox = policyForTier("sandbox");
    expect(sandbox.maxBytes).toBe(SANDBOX_MAX_ATTACHMENT_BYTES);
    expect(sandbox.maxBytes).toBe(1 * 1024 * 1024);
    expect(sandbox.metadataOnlyWhenOversize).toBe(true);

    const pro = policyForTier("pro");
    expect(pro.maxBytes).toBe(PRO_MAX_ATTACHMENT_BYTES);
    expect(pro.maxBytes).toBe(5 * 1024 * 1024);
    expect(pro.metadataOnlyWhenOversize).toBe(false);
  });

  it("allows maxBytes overrides", () => {
    expect(resolveMaxBytes("pro", 100)).toBe(100);
    expect(resolveMaxBytes("sandbox")).toBe(SANDBOX_MAX_ATTACHMENT_BYTES);
  });
});

describe("path jail", () => {
  it("defaults to ~/.envlo/attachments", () => {
    expect(defaultAttachmentsRoot()).toMatch(/\.envlo[/\\]attachments$/);
  });

  it("allows paths under a configured root and blocks escapes", async () => {
    const root = await mkdtemp(join(tmpdir(), "envlo-root-"));
    tempDirs.push(root);
    const inside = join(root, "abc.pdf");
    await writeFile(inside, "%PDF");

    expect(await resolveUnderAllowedRoots(inside, [root])).toBe(await realpath(inside));

    const outsideDir = await mkdtemp(join(tmpdir(), "envlo-outside-"));
    tempDirs.push(outsideDir);
    const outside = join(outsideDir, "secret.txt");
    await writeFile(outside, "nope");

    await expect(resolveUnderAllowedRoots(outside, [root])).rejects.toThrow(
      /escapes allowed attachment roots/,
    );
  });

  it("blocks symlink escape outside the allowed root", async () => {
    const root = await mkdtemp(join(tmpdir(), "envlo-jail-"));
    const outsideDir = await mkdtemp(join(tmpdir(), "envlo-secret-"));
    tempDirs.push(root, outsideDir);

    const secret = join(outsideDir, "secret.txt");
    await writeFile(secret, "classified");
    const link = join(root, "notes.txt");
    await symlink(secret, link);

    await expect(resolveUnderAllowedRoots(link, [root])).rejects.toThrow(
      /escapes allowed attachment roots/,
    );
  });
});

describe("isBlockedAttachmentHost", () => {
  it("blocks loopback, private, and link-local hosts", () => {
    for (const host of [
      "localhost",
      "127.0.0.1",
      "10.0.0.5",
      "192.168.1.1",
      "172.16.0.2",
      "169.254.1.1",
      "0.0.0.0",
      "::1",
    ]) {
      expect(isBlockedAttachmentHost(host), host).toBe(true);
    }
  });

  it("allows public hostnames", () => {
    expect(isBlockedAttachmentHost("cdn.example.com")).toBe(false);
    expect(isBlockedAttachmentHost("attachments.envlo.dev")).toBe(false);
  });
});
