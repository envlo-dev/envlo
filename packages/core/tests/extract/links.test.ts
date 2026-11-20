import { describe, expect, it } from "vitest";
import {
  extractVerificationLinkCandidates,
  pickBestVerificationUrl,
} from "../../src/extract/index.js";

describe("extractVerificationLinkCandidates", () => {
  it("picks verify/confirm links over unsubscribe and social", () => {
    const html = `
      <a href="https://app.example/verify?token=1">Verify email</a>
      <a href="https://app.example/unsubscribe">Unsubscribe</a>
      <a href="https://facebook.com/app">Facebook</a>
      <a href="https://app.example/privacy">Privacy</a>
      <a href="https://app.example/preferences">Preferences</a>
    `;
    const candidates = extractVerificationLinkCandidates({ html });
    expect(pickBestVerificationUrl(candidates)).toBe("https://app.example/verify?token=1");
  });

  it("scores magic login links from href keywords", () => {
    const html = `<a href="https://notes.example/magic?token=abc">Continue</a>`;
    expect(pickBestVerificationUrl(extractVerificationLinkCandidates({ html }))).toBe(
      "https://notes.example/magic?token=abc",
    );
  });

  it("extracts bare auth URLs from plain text", () => {
    const text = "Open https://cli.example/auth/callback?code=pkce_1 to finish sign-in.";
    expect(pickBestVerificationUrl(extractVerificationLinkCandidates({ text }))).toBe(
      "https://cli.example/auth/callback?code=pkce_1",
    );
  });

  it("returns null for order / marketing noise without auth signals", () => {
    const html = `
      <a href="https://shop.example/orders/10422">View order</a>
      <a href="https://shop.example/unsubscribe">Unsubscribe</a>
      <a href="https://instagram.com/shop">Instagram</a>
    `;
    expect(pickBestVerificationUrl(extractVerificationLinkCandidates({ html }))).toBeNull();
  });

  it("prefers path/query auth shapes", () => {
    const html = `
      <a href="https://app.example/settings">Settings</a>
      <a href="https://app.example/auth/reset?token=rst">Reset password</a>
    `;
    expect(pickBestVerificationUrl(extractVerificationLinkCandidates({ html }))).toBe(
      "https://app.example/auth/reset?token=rst",
    );
  });
});
