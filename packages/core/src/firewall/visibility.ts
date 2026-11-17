import {
  isOffScreenOffset,
  isZeroOpacity,
  normalizeCssColor,
  parseCssLengthPx,
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

export type VisibilityCheckOptions = {
  /**
   * When true, do not strip nodes that are only hidden via display/visibility/`hidden`
   * (common for collapsed email quote UI). Harder injection tricks still strip.
   */
  preserveCollapsedQuotes?: boolean;
};

export function isDangerousTag(tagName: string): boolean {
  return DANGEROUS_TAGS.has(tagName.toLowerCase());
}

/** 1×1 (or 0×0) tracking pixels via attributes or inline/computed style. */
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

function isCollapsedUiOnly(styleMap: StyleMap, el: { getAttribute: (n: string) => string | null }): boolean {
  const display = styleGet(styleMap, "display");
  const visibility = styleGet(styleMap, "visibility");
  const hiddenAttr = el.getAttribute("hidden") !== null;
  return display === "none" || visibility === "hidden" || visibility === "collapse" || hiddenAttr;
}

function hasHardInjectionHide(styleMap: StyleMap): boolean {
  if (isZeroOpacity(styleGet(styleMap, "opacity"))) return true;

  const fontSize = styleGet(styleMap, "font-size");
  if (fontSize) {
    const trimmed = fontSize.trim().toLowerCase();
    if (trimmed === "0%" || parseCssLengthPx(fontSize) === 0) return true;
  }

  const color = normalizeCssColor(styleGet(styleMap, "color"));
  const background = normalizeCssColor(styleGet(styleMap, "background-color", "background"));
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

  // Outlook / email clip tricks.
  const msoHide = styleGet(styleMap, "mso-hide");
  if (msoHide === "all") return true;

  const clip = styleGet(styleMap, "clip");
  if (clip && /rect\s*\(\s*0\s*(px)?\s*,\s*0\s*(px)?\s*,\s*0\s*(px)?\s*,\s*0\s*(px)?\s*\)/i.test(clip)) {
    return true;
  }
  const clipPath = styleGet(styleMap, "clip-path");
  if (clipPath && (clipPath.includes("inset(100%") || clipPath === "circle(0)" || clipPath.includes("circle(0px"))) {
    return true;
  }

  // Collapsed box often used to hide preheader / injection in email HTML.
  const maxHeight = parseCssLengthPx(styleGet(styleMap, "max-height"));
  const height = parseCssLengthPx(styleGet(styleMap, "height"));
  const overflow = styleGet(styleMap, "overflow") ?? styleGet(styleMap, "overflow-y");
  if ((maxHeight === 0 || height === 0) && overflow === "hidden") return true;

  return false;
}

/**
 * Decide whether an element should be deleted before Markdown conversion.
 * `styleMap` should already include stylesheet + inline resolution when available.
 */
export function isInvisibleElement(
  el: {
    tagName: string;
    getAttribute: (name: string) => string | null;
  },
  styleMap: StyleMap,
  options: VisibilityCheckOptions = {},
): boolean {
  if (isDangerousTag(el.tagName)) return true;
  if (isTrackingPixel({ ...el, styleMap })) return true;

  if (hasHardInjectionHide(styleMap)) return true;

  if (isCollapsedUiOnly(styleMap, el)) {
    if (options.preserveCollapsedQuotes) return false;
    return true;
  }

  return false;
}
