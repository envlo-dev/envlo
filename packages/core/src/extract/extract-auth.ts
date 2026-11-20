import { htmlToPlainText } from "./html-text.js";
import {
  extractVerificationLinkCandidates,
  pickBestVerificationUrl,
} from "./links.js";
import { extractOtpCandidates, pickBestOtp } from "./otp.js";
import type {
  ExtractAuthInput,
  ExtractAuthOptions,
  ExtractAuthResult,
} from "./types.js";

function joinScanText(input: ExtractAuthInput): string {
  const parts: string[] = [];
  if (input.subject?.trim()) parts.push(input.subject.trim());
  if (input.text?.trim()) parts.push(input.text.trim());
  if (input.html?.trim()) parts.push(htmlToPlainText(input.html));
  return parts.join("\n\n");
}

/**
 * Deterministically extract a verification / OTP / device code and the best
 * verification / magic link from subject, plain text, and HTML.
 *
 * Codes: numeric (4–12 digits, including spaced/hyphenated groups),
 * alphanumeric, and device codes near auth keywords. Links: scored `<a href>`
 * tags and bare URLs (verify/confirm/magic/…) with unsubscribe/social noise
 * filtered out.
 */
export function extractAuthSignals(
  input: ExtractAuthInput,
  options: ExtractAuthOptions = {},
): ExtractAuthResult {
  const scanText = joinScanText(input);
  const otpCandidates = extractOtpCandidates(scanText, options);
  const linkText = [input.subject, input.text].filter(Boolean).join("\n");
  const linkCandidates = extractVerificationLinkCandidates(
    {
      html: input.html ?? null,
      text: linkText || null,
    },
    options,
  );

  return {
    extractedOtp: pickBestOtp(otpCandidates),
    verificationUrl: pickBestVerificationUrl(linkCandidates, options),
    otpCandidates,
    linkCandidates,
  };
}
