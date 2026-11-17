export { unwrapForwarding, applyForwardingUnwrap } from "./unwrap-forwarding.js";
export { parseAddressString, extractEmailsFromHeader } from "./parse-address.js";
export {
  parseGmailInlineForward,
  parseM365InlineForward,
  parseAppleInlineForward,
  parseYahooInlineForward,
  bodyTextForForwardScan,
  hasGmailForwardMarker,
} from "./inline-blocks.js";
export { parseRfc822AttachmentSender } from "./rfc822.js";

export type { ForwardingDetection, ForwardingUnwrap } from "./types.js";
