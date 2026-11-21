/** Portable base64 encode for binary payloads (no Node Buffer required). */
export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  if (typeof btoa === "function") return btoa(binary);
  throw new Error("No base64 encoder available in this runtime");
}
