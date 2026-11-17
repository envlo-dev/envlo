/**
 * Lightweight inline-style helpers. Avoids nested / catastrophic regexes — style
 * attributes are split on `;` and each declaration on the first `:`.
 */

export type StyleMap = Map<string, string>;

export function parseInlineStyle(styleAttr: string | null | undefined): StyleMap {
  const map: StyleMap = new Map();
  if (!styleAttr) return map;

  // Cap pathological style attribute length to reduce ReDoS / memory risk.
  const capped = styleAttr.length > 8_000 ? styleAttr.slice(0, 8_000) : styleAttr;

  for (const part of capped.split(";")) {
    const idx = part.indexOf(":");
    if (idx <= 0) continue;
    const prop = part.slice(0, idx).trim().toLowerCase();
    // Drop trailing !important so `display: none !important` still matches.
    const value = part
      .slice(idx + 1)
      .trim()
      .toLowerCase()
      .replace(/\s*!important\s*$/i, "")
      .trim();
    if (!prop || !value) continue;
    map.set(prop, value);
  }
  return map;
}

export function styleGet(styles: StyleMap, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = styles.get(key);
    if (value !== undefined) return value;
  }
  return undefined;
}

/** Normalize common CSS color literals to a comparable hex (#rrggbb) when possible. */
export function normalizeCssColor(raw: string | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim().toLowerCase().replace(/\s+/g, "");

  if (value === "transparent" || value === "inherit" || value === "initial" || value === "currentcolor") {
    return null;
  }

  const named: Record<string, string> = {
    white: "#ffffff",
    black: "#000000",
    red: "#ff0000",
    green: "#008000",
    blue: "#0000ff",
    yellow: "#ffff00",
    cyan: "#00ffff",
    magenta: "#ff00ff",
    gray: "#808080",
    grey: "#808080",
    silver: "#c0c0c0",
    maroon: "#800000",
    olive: "#808000",
    lime: "#00ff00",
    aqua: "#00ffff",
    teal: "#008080",
    navy: "#000080",
    fuchsia: "#ff00ff",
    purple: "#800080",
  };
  if (named[value]) return named[value]!;

  if (/^#[0-9a-f]{3}$/i.test(value)) {
    const r = value[1]!;
    const g = value[2]!;
    const b = value[3]!;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  if (/^#[0-9a-f]{8}$/i.test(value)) return value.slice(0, 7).toLowerCase();

  const rgb = /^rgba?\((\d{1,3}),(\d{1,3}),(\d{1,3})(?:,([0-9.]+))?\)$/i.exec(value);
  if (rgb) {
    const r = Math.min(255, Number(rgb[1]));
    const g = Math.min(255, Number(rgb[2]));
    const b = Math.min(255, Number(rgb[3]));
    const a = rgb[4] !== undefined ? Number(rgb[4]) : 1;
    if (a === 0) return "transparent";
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  return null;
}

function toHex(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n)))
    .toString(16)
    .padStart(2, "0");
}

export function parseCssLengthPx(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = raw.trim().toLowerCase();
  if (value === "0") return 0;
  const match = /^(-?\d+(?:\.\d+)?)(px|em|rem|pt|%)?$/.exec(value);
  if (!match) return null;
  const num = Number(match[1]);
  if (!Number.isFinite(num)) return null;
  const unit = match[2] ?? "px";
  // Treat 0 in any unit as zero; otherwise only trust px for thresholds.
  if (num === 0) return 0;
  if (unit === "px" || unit === "pt") return num;
  return null;
}

export function isZeroOpacity(raw: string | undefined): boolean {
  if (!raw) return false;
  const value = raw.trim().toLowerCase();
  const num = Number(value);
  return Number.isFinite(num) && num === 0;
}

/** Large negative offsets used to park text off-screen. */
export function isOffScreenOffset(raw: string | undefined): boolean {
  const px = parseCssLengthPx(raw);
  if (px === null) return false;
  return px <= -1000;
}
