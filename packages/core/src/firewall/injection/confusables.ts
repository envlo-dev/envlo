/**
 * Expanded Latin lookalike folds (Cyrillic + Greek + a few specialty forms).
 * Not a full Unicode confusables database — focused on email injection spoofing.
 */
const CONFUSABLE_TO_LATIN: ReadonlyMap<string, string> = new Map([
  // Cyrillic
  ["\u0430", "a"],
  ["\u0410", "A"],
  ["\u0435", "e"],
  ["\u0415", "E"],
  ["\u043E", "o"],
  ["\u041E", "O"],
  ["\u0440", "p"],
  ["\u0420", "P"],
  ["\u0441", "c"],
  ["\u0421", "C"],
  ["\u0443", "y"],
  ["\u0423", "Y"],
  ["\u0445", "x"],
  ["\u0425", "X"],
  ["\u0456", "i"],
  ["\u0406", "I"],
  ["\u0457", "i"],
  ["\u0407", "I"],
  ["\u0454", "e"],
  ["\u0404", "E"],
  ["\u04BB", "h"],
  ["\u04BA", "H"],
  ["\u0501", "d"],
  ["\u051B", "q"],
  ["\u051D", "w"],
  ["\u043A", "k"],
  ["\u041A", "K"],
  ["\u043C", "m"],
  ["\u041C", "M"],
  ["\u043D", "n"],
  ["\u041D", "H"],
  ["\u0442", "t"],
  ["\u0422", "T"],
  ["\u044A", "b"],
  ["\u044C", "b"],
  // Greek
  ["\u03B1", "a"],
  ["\u0391", "A"],
  ["\u03B5", "e"],
  ["\u0395", "E"],
  ["\u03BF", "o"],
  ["\u039F", "O"],
  ["\u03C1", "p"],
  ["\u03A1", "P"],
  ["\u03C5", "y"],
  ["\u03A5", "Y"],
  ["\u03C7", "x"],
  ["\u03A7", "X"],
  ["\u03B9", "i"],
  ["\u0399", "I"],
  ["\u03BA", "k"],
  ["\u039A", "K"],
  ["\u03BD", "v"],
  ["\u03A4", "T"],
  ["\u03C4", "t"],
  ["\u03B7", "n"],
  ["\u0397", "H"],
]);

/** Invisible / bidi controls often used to hide or reorder injection text. */
const INVISIBLE_OR_BIDI =
  /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

export function stripInvisibleAndBidi(text: string): string {
  INVISIBLE_OR_BIDI.lastIndex = 0;
  return text.replace(INVISIBLE_OR_BIDI, "");
}

export function foldConfusables(text: string): string {
  let out = "";
  for (const ch of text) {
    out += CONFUSABLE_TO_LATIN.get(ch) ?? ch;
  }
  return out;
}

export function hasMixedScriptConfusables(text: string): boolean {
  let hasLatin = false;
  let hasLookalike = false;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a) ||
      (code >= 0x00c0 && code <= 0x024f)
    ) {
      hasLatin = true;
    }
    if (CONFUSABLE_TO_LATIN.has(ch)) hasLookalike = true;
    if (hasLatin && hasLookalike) return true;
  }
  return false;
}
