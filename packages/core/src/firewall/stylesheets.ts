import { parseInlineStyle, type StyleMap } from "./styles.js";
import type { TimeoutGuard } from "./timeout.js";

export type StylesheetRules = {
  /** tagName (lowercase) → declarations */
  byTag: Map<string, StyleMap>;
  /** .class → declarations */
  byClass: Map<string, StyleMap>;
  /** #id → declarations */
  byId: Map<string, StyleMap>;
  /** tag.class → declarations (e.g. span.tiny) */
  byTagClass: Map<string, StyleMap>;
};

const MAX_STYLESHEET_CHARS = 100_000;

/**
 * Extract simple email-oriented CSS rules from `<style>` text.
 * Supports `tag`, `.class`, `#id`, and comma-separated lists of those —
 * not full CSS cascade (no descendants, attrs, or @media).
 */
export function parseStylesheetRules(cssText: string, guard?: TimeoutGuard): StylesheetRules {
  const byTag = new Map<string, StyleMap>();
  const byClass = new Map<string, StyleMap>();
  const byId = new Map<string, StyleMap>();
  const byTagClass = new Map<string, StyleMap>();

  const capped =
    cssText.length > MAX_STYLESHEET_CHARS ? cssText.slice(0, MAX_STYLESHEET_CHARS) : cssText;

  // Strip comments without nested regexes.
  let css = "";
  let i = 0;
  while (i < capped.length) {
    guard?.check();
    if (capped[i] === "/" && capped[i + 1] === "*") {
      const end = capped.indexOf("*/", i + 2);
      i = end === -1 ? capped.length : end + 2;
      continue;
    }
    css += capped[i];
    i += 1;
  }

  let pos = 0;
  while (pos < css.length) {
    guard?.check();
    const open = css.indexOf("{", pos);
    if (open === -1) break;
    const close = css.indexOf("}", open + 1);
    if (close === -1) break;

    const selectorGroup = css.slice(pos, open).trim();
    const body = css.slice(open + 1, close);
    pos = close + 1;

    if (!selectorGroup || selectorGroup.startsWith("@")) continue;
    const decls = parseInlineStyle(body.replace(/\n/g, ";"));
    if (decls.size === 0) continue;

    for (const rawSelector of selectorGroup.split(",")) {
      const selector = rawSelector.trim().toLowerCase();
      if (!selector || selector.includes(" ") || selector.includes(">") || selector.includes("+")) {
        continue;
      }
      if (selector.startsWith(".")) {
        const name = selector.slice(1);
        if (name) mergeStyleMaps(byClass, name, decls);
      } else if (selector.startsWith("#")) {
        const name = selector.slice(1);
        if (name) mergeStyleMaps(byId, name, decls);
      } else if (/^[a-z][a-z0-9]*$/i.test(selector)) {
        mergeStyleMaps(byTag, selector, decls);
      } else {
        const tagClass = /^([a-z][a-z0-9]*)\.([a-z_][\w-]*)$/i.exec(selector);
        if (tagClass?.[1] && tagClass[2]) {
          mergeStyleMaps(byTagClass, `${tagClass[1]}.${tagClass[2]}`, decls);
        }
      }
    }
  }

  return { byTag, byClass, byId, byTagClass };
}

function mergeStyleMaps(target: Map<string, StyleMap>, key: string, incoming: StyleMap): void {
  const existing = target.get(key) ?? new Map<string, string>();
  for (const [prop, value] of incoming) {
    existing.set(prop, value);
  }
  target.set(key, existing);
}

/** Merge stylesheet + inline styles (inline wins on conflicts). */
export function resolveElementStyles(
  rules: StylesheetRules,
  el: {
    tagName: string;
    getAttribute: (name: string) => string | null;
  },
): StyleMap {
  const merged: StyleMap = new Map();

  const tag = el.tagName.toLowerCase();
  const tagRules = rules.byTag.get(tag);
  if (tagRules) {
    for (const [k, v] of tagRules) merged.set(k, v);
  }
  const classAttr = el.getAttribute("class");
  if (classAttr) {
    for (const token of classAttr.split(/\s+/)) {
      if (!token) continue;
      const className = token.toLowerCase();
      const classRules = rules.byClass.get(className);
      if (classRules) {
        for (const [k, v] of classRules) merged.set(k, v);
      }
      const tagClassRules = rules.byTagClass.get(`${tag}.${className}`);
      if (tagClassRules) {
        for (const [k, v] of tagClassRules) merged.set(k, v);
      }
    }
  }

  const id = el.getAttribute("id");
  if (id) {
    const idRules = rules.byId.get(id.toLowerCase());
    if (idRules) {
      for (const [k, v] of idRules) merged.set(k, v);
    }
  }

  const inline = parseInlineStyle(el.getAttribute("style"));
  for (const [k, v] of inline) merged.set(k, v);

  return merged;
}

export function emptyStylesheetRules(): StylesheetRules {
  return {
    byTag: new Map(),
    byClass: new Map(),
    byId: new Map(),
    byTagClass: new Map(),
  };
}
