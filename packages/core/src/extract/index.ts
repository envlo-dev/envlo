export { extractAuthSignals } from "./extract-auth.js";
export { extractOtpCandidates, pickBestOtp, normalizeAuthCode } from "./otp.js";
export {
  extractVerificationLinkCandidates,
  pickBestVerificationUrl,
} from "./links.js";
export { htmlToPlainText } from "./html-text.js";
export {
  OTP_CONTEXT_KEYWORDS,
  LINK_POSITIVE_KEYWORDS,
  LINK_NEGATIVE_KEYWORDS,
} from "./keywords.js";

export type {
  ExtractAuthInput,
  ExtractAuthOptions,
  ExtractAuthResult,
  OtpCandidate,
  VerificationLinkCandidate,
} from "./types.js";
