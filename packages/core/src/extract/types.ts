/** Input surfaces for auth-signal extraction (OTP + verification links). */
export type ExtractAuthInput = {
  html?: string | null;
  text?: string | null;
  /** Subject often carries OTPs (`Your code is 482913`) or verify hints. */
  subject?: string | null;
};

export type OtpCandidate = {
  /**
   * Normalized code for agents:
   * - numeric (possibly spaced/hyphenated) → digits only
   * - alphanumeric / device codes → uppercase, hyphens kept between groups
   */
  code: string;
  /** Raw matched span as it appeared in the message. */
  raw: string;
  score: number;
  /** Why this candidate was kept/ranked. */
  reasons: string[];
  /** Character index of the raw match in the scanned plain text. */
  index: number;
  kind: "numeric" | "alphanumeric" | "device";
};

export type VerificationLinkCandidate = {
  url: string;
  /** Anchor text or surrounding plain-text context. */
  text: string;
  score: number;
  reasons: string[];
};

/**
 * Deterministic auth extraction result for agent tools
 * (`extractedOtp` / `verificationUrl` are the top picks).
 */
export type ExtractAuthResult = {
  extractedOtp: string | null;
  verificationUrl: string | null;
  otpCandidates: OtpCandidate[];
  linkCandidates: VerificationLinkCandidate[];
};

export type ExtractAuthOptions = {
  /**
   * Minimum normalized code length (default 4).
   * Applies to digit-only and alphanumeric codes after separator stripping.
   */
  minCodeLength?: number;
  /**
   * Maximum normalized code length (default 12).
   * Long tracking IDs above this are ignored; 9–12 digit codes need OTP context.
   */
  maxCodeLength?: number;
  /** @deprecated Use `minCodeLength`. */
  minOtpDigits?: number;
  /** @deprecated Use `maxCodeLength`. */
  maxOtpDigits?: number;
  /** Allow letters+digits / device codes like `WDJB-MJHT` (default true). */
  allowAlphanumeric?: boolean;
  /** Minimum link score to accept as `verificationUrl` (default 4). */
  minLinkScore?: number;
};
