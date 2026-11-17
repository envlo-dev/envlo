import {
  isOffScreenOffset,
  isZeroOpacity,
  normalizeCssColor,
  parseCssLengthPx,
  parseInlineStyle,
  styleGet,
  type StyleMap,
} from "./styles.js";

const DANGEROUS_TAGS = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "noscript",
  "base",
  "link",
  "meta",
]);

export function isDangerousTag(tagName: string): boolean {
  return DANGEROUS_TAGS.has(tagName.toLowerCase());
}

/** 1×1 (or 0×0) tracking pixels via attributes or inline style. */
export function isTrackingPixel(el: {
  tagName: string;
  getAttribute: (name: string) => string | null;
  styleMap: StyleMap;
}): boolean {
  if (el.tagName.toLowerCase() !== "img") return false;

  const widthAttr = el.getAttribute("width");
  const heightAttr = el.getAttribute("height");
  const width = widthAttr !== null ? Number(widthAttr) : parseCssLengthPx(styleGet(el.styleMap, "width"));
  const height =
    heightAttr !== null ? Number(heightAttr) : parseCssLengthPx(styleGet(el.styleMap, "height"));

  if (width === null || height === null || Number.isNaN(width) || Number.isNaN(height)) {
    return false;
  }
  return width <= 1 && height <= 1;
}

export function isInvisibleElement(el: {
  tagName: string;
  getAttribute: (name: string) => string | null;
}): boolean {
  const styleMap = parseInlineStyle(el.getAttribute("style"));

  if (isDangerousTag(el.tagName)) return true;
  if (isTrackingPixel({ ...el, styleMap })) return true;

  const display = styleGet(styleMap, "display");
  if (display === "none") return true;

  const visibility = styleGet(styleMap, "visibility");
  if (visibility === "hidden" || visibility === "collapse") return true;

  if (isZeroOpacity(styleGet(styleMap, "opacity"))) return true;

  const fontSize = styleGet(styleMap, "font-size");
  const fontPx = parseCssLengthPx(fontSize);
  if (fontPx === 0) return true;
  // Also catch unitless / bare "0" already handled; "0em"/"0rem" via parseCssLengthPx.

  const color = normalizeCssColor(styleGet(styleMap, "color"));
  const background = normalizeCssColor(
    styleGet(styleMap, "background-color", "background"),
  );
  if (color && background && color === background) return true;

  if (
    isOffScreenOffset(styleGet(styleMap, "left")) ||
    isOffScreenOffset(styleGet(styleMap, "right")) ||
    isOffScreenOffset(styleGet(styleMap, "top")) ||
    isOffScreenOffset(styleGet(styleMap, "bottom")) ||
    isOffScreenOffset(styleGet(styleMap, "text-indent"))
  ) {
    return true;
  }

  // HTML hidden attribute is effectively invisible.
  if (el.getAttribute("hidden") !== null) return true;

  return false;
}
