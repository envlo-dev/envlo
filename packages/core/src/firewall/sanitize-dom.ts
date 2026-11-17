import { parseHTML } from "linkedom";
import { delay, SanitizeTimeoutError, TimeoutGuard } from "./timeout.js";
import {
  emptyStylesheetRules,
  parseStylesheetRules,
  resolveElementStyles,
  type StylesheetRules,
} from "./stylesheets.js";
import {
  DEFAULT_MAX_INPUT_CHARS,
  DEFAULT_SANITIZE_TIMEOUT_MS,
  type AbortFlag,
  type SanitizeDomResult,
  type SanitizeOptions,
} from "./types.js";
import { isInvisibleElement } from "./visibility.js";
import { stripZeroWidthChars } from "./zero-width.js";

type DomNode = {
  nodeType: number;
  nodeName: string;
  textContent: string | null;
  childNodes: ArrayLike<DomNode>;
  parentNode: DomNode | null;
  getAttribute?: (name: string) => string | null;
  remove?: () => void;
};

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const YIELD_EVERY_N_NODES = 250;

/**
 * Parse HTML with linkedom, delete invisible / dangerous nodes, strip zero-width
 * characters from remaining text. Hidden prompt-injection payloads are removed
 * *before* any Markdown conversion.
 *
 * Output is for agent consumption — not a pixel-faithful email HTML viewer.
 */
export function sanitizeInvisibleHtml(
  html: string,
  options: SanitizeOptions = {},
): SanitizeDomResult {
  return runSanitize(html, options, null);
}

/**
 * Same as `sanitizeInvisibleHtml`, but races a real timer and yields periodically
 * so the deadline can abort mid-walk (harder than cooperative-only sync checks).
 */
export async function sanitizeInvisibleHtmlAsync(
  html: string,
  options: SanitizeOptions = {},
): Promise<SanitizeDomResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_SANITIZE_TIMEOUT_MS;
  const abort: AbortFlag = { aborted: false };

  const work = runSanitizeAsync(html, options, abort);

  const timedOut = delay(timeoutMs).then((): SanitizeDomResult => {
    abort.aborted = true;
    return { html: "", strippedHiddenElementsCount: 0, timedOut: true };
  });

  const result = await Promise.race([work, timedOut]);
  // Ensure the loser path stops checking work if we already timed out.
  if (result.timedOut) abort.aborted = true;
  return result;
}

function runSanitize(
  html: string,
  options: SanitizeOptions,
  abort: AbortFlag | null,
): SanitizeDomResult {
  const timeoutMs = options.timeoutMs ?? DEFAULT_SANITIZE_TIMEOUT_MS;
  const maxInputChars = options.maxInputChars ?? DEFAULT_MAX_INPUT_CHARS;

  if (!html || !html.trim()) {
    return { html: "", strippedHiddenElementsCount: 0, timedOut: false };
  }

  if (html.length > maxInputChars) {
    return { html: "", strippedHiddenElementsCount: 0, timedOut: true };
  }

  const guard = TimeoutGuard.fromMs(timeoutMs, abort);
  let strippedHiddenElementsCount = 0;

  try {
    guard.check();
    // linkedom fragment parsing makes the first element the documentElement and
    // leaves body empty — wrap so we always have a stable <body> to serialize.
    const { document } = parseHTML(`<!DOCTYPE html><html><body></body></html>`);
    document.body.innerHTML = html;

    const body = document.body as unknown as DomNode;
    const rules = collectStylesheetRules(body, guard);
    strippedHiddenElementsCount = stripInvisibleTree(body, guard, rules, options);

    return {
      html: document.body.innerHTML,
      strippedHiddenElementsCount,
      timedOut: false,
    };
  } catch (error) {
    if (error instanceof SanitizeTimeoutError) {
      return { html: "", strippedHiddenElementsCount, timedOut: true };
    }
    throw error;
  }
}

async function runSanitizeAsync(
  html: string,
  options: SanitizeOptions,
  abort: AbortFlag,
): Promise<SanitizeDomResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_SANITIZE_TIMEOUT_MS;
  const maxInputChars = options.maxInputChars ?? DEFAULT_MAX_INPUT_CHARS;

  if (!html || !html.trim()) {
    return { html: "", strippedHiddenElementsCount: 0, timedOut: false };
  }

  if (html.length > maxInputChars) {
    return { html: "", strippedHiddenElementsCount: 0, timedOut: true };
  }

  const guard = TimeoutGuard.fromMs(timeoutMs, abort);
  let strippedHiddenElementsCount = 0;

  try {
    guard.check();
    const { document } = parseHTML(`<!DOCTYPE html><html><body></body></html>`);
    document.body.innerHTML = html;

    const body = document.body as unknown as DomNode;
    const rules = collectStylesheetRules(body, guard);
    strippedHiddenElementsCount = await stripInvisibleTreeAsync(
      body,
      guard,
      rules,
      options,
      abort,
    );

    if (abort.aborted) {
      return { html: "", strippedHiddenElementsCount, timedOut: true };
    }

    return {
      html: document.body.innerHTML,
      strippedHiddenElementsCount,
      timedOut: false,
    };
  } catch (error) {
    if (error instanceof SanitizeTimeoutError) {
      return { html: "", strippedHiddenElementsCount, timedOut: true };
    }
    throw error;
  }
}

function collectStylesheetRules(root: DomNode, guard: TimeoutGuard): StylesheetRules {
  const rules = emptyStylesheetRules();
  const stack: DomNode[] = [root];

  while (stack.length > 0) {
    guard.check();
    const node = stack.pop();
    if (!node || node.nodeType !== ELEMENT_NODE) continue;
    const tag = node.nodeName?.toLowerCase?.() ?? "";
    if (tag === "style") {
      const css = node.textContent ?? "";
      const parsed = parseStylesheetRules(css, guard);
      for (const [k, v] of parsed.byTag) mergeRuleMap(rules.byTag, k, v);
      for (const [k, v] of parsed.byClass) mergeRuleMap(rules.byClass, k, v);
      for (const [k, v] of parsed.byId) mergeRuleMap(rules.byId, k, v);
      for (const [k, v] of parsed.byTagClass) mergeRuleMap(rules.byTagClass, k, v);
      continue;
    }
    pushChildren(node, stack);
  }

  return rules;
}

function mergeRuleMap(
  target: Map<string, Map<string, string>>,
  key: string,
  incoming: Map<string, string>,
): void {
  const existing = target.get(key) ?? new Map<string, string>();
  for (const [prop, value] of incoming) existing.set(prop, value);
  target.set(key, existing);
}

function stripInvisibleTree(
  root: DomNode,
  guard: TimeoutGuard,
  rules: StylesheetRules,
  options: SanitizeOptions,
): number {
  const doomed: DomNode[] = [];
  walkCollect(root, guard, rules, options, doomed, null);
  return removeDoomed(doomed, guard);
}

async function stripInvisibleTreeAsync(
  root: DomNode,
  guard: TimeoutGuard,
  rules: StylesheetRules,
  options: SanitizeOptions,
  abort: AbortFlag,
): Promise<number> {
  const doomed: DomNode[] = [];
  await walkCollectAsync(root, guard, rules, options, doomed, abort);
  if (abort.aborted) return doomed.length;
  return removeDoomed(doomed, guard);
}

function walkCollect(
  root: DomNode,
  guard: TimeoutGuard,
  rules: StylesheetRules,
  options: SanitizeOptions,
  doomed: DomNode[],
  abort: AbortFlag | null,
): void {
  const stack: DomNode[] = [root];
  let visited = 0;

  while (stack.length > 0) {
    guard.check();
    if (abort?.aborted) throw new SanitizeTimeoutError();
    const node = stack.pop();
    if (!node) continue;
    visited += 1;

    if (node.nodeType === TEXT_NODE) {
      const text = node.textContent ?? "";
      const cleaned = stripZeroWidthChars(text);
      if (cleaned !== text) {
        (node as { textContent: string }).textContent = cleaned;
      }
      continue;
    }

    if (node.nodeType !== ELEMENT_NODE) continue;

    const tag = node.nodeName?.toLowerCase?.() ?? "";
    if (tag === "html" || tag === "body" || tag === "#document") {
      pushChildren(node, stack);
      continue;
    }

    const elementLike = {
      tagName: tag,
      getAttribute: (name: string) => node.getAttribute?.(name) ?? null,
    };
    const styleMap = resolveElementStyles(rules, elementLike);

    if (isInvisibleElement(elementLike, styleMap, options)) {
      doomed.push(node);
      continue;
    }

    pushChildren(node, stack);
    void visited;
  }
}

async function walkCollectAsync(
  root: DomNode,
  guard: TimeoutGuard,
  rules: StylesheetRules,
  options: SanitizeOptions,
  doomed: DomNode[],
  abort: AbortFlag,
): Promise<void> {
  const stack: DomNode[] = [root];
  let visited = 0;

  while (stack.length > 0) {
    guard.check();
    if (abort.aborted) throw new SanitizeTimeoutError();

    const node = stack.pop();
    if (!node) continue;
    visited += 1;

    if (visited % YIELD_EVERY_N_NODES === 0) {
      await delay(0);
      if (abort.aborted) throw new SanitizeTimeoutError();
    }

    if (node.nodeType === TEXT_NODE) {
      const text = node.textContent ?? "";
      const cleaned = stripZeroWidthChars(text);
      if (cleaned !== text) {
        (node as { textContent: string }).textContent = cleaned;
      }
      continue;
    }

    if (node.nodeType !== ELEMENT_NODE) continue;

    const tag = node.nodeName?.toLowerCase?.() ?? "";
    if (tag === "html" || tag === "body" || tag === "#document") {
      pushChildren(node, stack);
      continue;
    }

    const elementLike = {
      tagName: tag,
      getAttribute: (name: string) => node.getAttribute?.(name) ?? null,
    };
    const styleMap = resolveElementStyles(rules, elementLike);

    if (isInvisibleElement(elementLike, styleMap, options)) {
      doomed.push(node);
      continue;
    }

    pushChildren(node, stack);
  }
}

function removeDoomed(doomed: DomNode[], guard: TimeoutGuard): number {
  let removed = 0;
  for (const node of doomed) {
    guard.check();
    try {
      node.remove?.();
      removed += 1;
    } catch {
      // already detached
    }
  }
  return removed;
}

function pushChildren(node: DomNode, stack: DomNode[]): void {
  const children = node.childNodes;
  for (let i = children.length - 1; i >= 0; i -= 1) {
    const child = children[i];
    if (child) stack.push(child);
  }
}
