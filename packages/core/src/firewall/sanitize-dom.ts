import { parseHTML } from "linkedom";
import { SanitizeTimeoutError, TimeoutGuard } from "./timeout.js";
import {
  DEFAULT_MAX_INPUT_CHARS,
  DEFAULT_SANITIZE_TIMEOUT_MS,
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

/**
 * Parse HTML with linkedom, delete invisible / dangerous nodes, strip zero-width
 * characters from remaining text. Hidden prompt-injection payloads are removed
 * *before* any Markdown conversion.
 */
export function sanitizeInvisibleHtml(
  html: string,
  options: SanitizeOptions = {},
): SanitizeDomResult {
  const timeoutMs = options.timeoutMs ?? DEFAULT_SANITIZE_TIMEOUT_MS;
  const maxInputChars = options.maxInputChars ?? DEFAULT_MAX_INPUT_CHARS;

  if (!html || !html.trim()) {
    return { html: "", strippedHiddenElementsCount: 0, timedOut: false };
  }

  if (html.length > maxInputChars) {
    // Refuse to walk unbounded payloads — treat as timed-out / aborted sanitize.
    return {
      html: "",
      strippedHiddenElementsCount: 0,
      timedOut: true,
    };
  }

  const guard = TimeoutGuard.fromMs(timeoutMs);
  let strippedHiddenElementsCount = 0;

  try {
    guard.check();
    // linkedom fragment parsing makes the first element the documentElement and
    // leaves body empty — wrap so we always have a stable <body> to serialize.
    const { document } = parseHTML(`<!DOCTYPE html><html><body></body></html>`);
    document.body.innerHTML = html;

    strippedHiddenElementsCount = stripInvisibleTree(
      document.body as unknown as DomNode,
      guard,
    );

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

function stripInvisibleTree(root: DomNode, guard: TimeoutGuard): number {
  let removed = 0;
  const stack: DomNode[] = [root];
  const doomed: DomNode[] = [];

  while (stack.length > 0) {
    guard.check();
    const node = stack.pop();
    if (!node) continue;

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
    // Never strip the walk roots themselves.
    if (tag === "html" || tag === "body" || tag === "#document") {
      pushChildren(node, stack);
      continue;
    }

    const elementLike = {
      tagName: tag,
      getAttribute: (name: string) => node.getAttribute?.(name) ?? null,
    };

    if (isInvisibleElement(elementLike)) {
      doomed.push(node);
      continue; // do not descend into removed subtrees
    }

    pushChildren(node, stack);
  }

  for (const node of doomed) {
    guard.check();
    try {
      node.remove?.();
      removed += 1;
    } catch {
      // Node may already be detached if a parent was also queued — ignore.
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
