import TurndownService from "turndown";
import {
  getDirectTableCells,
  getDirectTableRows,
  isLayoutTable,
} from "./layout-tables.js";

type HtmlElement = {
  nodeName: string;
  innerHTML: string;
  getAttribute: (name: string) => string | null;
  hasAttribute: (name: string) => boolean;
  children: ArrayLike<HtmlElement>;
  querySelectorAll: (selector: string) => ArrayLike<HtmlElement>;
  textContent: string | null;
};

function cellInnerHtml(cell: { innerHTML?: string; textContent?: string | null }): string {
  if (typeof cell.innerHTML === "string") return cell.innerHTML;
  return cell.textContent ?? "";
}

export type LayoutRuleStats = {
  layoutTablesFlattened: number;
  dataTablesPreserved: number;
};

export type EmailTurndownOptions = {
  /**
   * When true (default), layout grids are stacked as blocks.
   * When false, every `<table>` is treated as a data table (force-keep).
   */
  flattenLayoutTables?: boolean;
};

/**
 * Register Turndown rules that flatten email layout tables into stacked
 * Markdown blocks instead of broken GFM pipe tables.
 */
export function addEmailLayoutTurndownRules(
  service: TurndownService,
  stats: LayoutRuleStats,
  options: EmailTurndownOptions = {},
): void {
  const flattenLayoutTables = options.flattenLayoutTables ?? true;

  if (flattenLayoutTables) {
    service.addRule("envloEmailLayoutTable", {
      filter: (node) => {
        const el = node as unknown as HtmlElement;
        if (el.nodeName !== "TABLE") return false;
        return isLayoutTable(el);
      },
      replacement: (_content, node) => {
        stats.layoutTablesFlattened += 1;
        const table = node as unknown as HtmlElement;
        const chunks: string[] = [];

        for (const row of getDirectTableRows(table)) {
          for (const cell of getDirectTableCells(row)) {
            // Recurse with the same service so nested layout tables also flatten.
            const cellMd = service.turndown(cellInnerHtml(cell)).trim();
            if (cellMd) chunks.push(cellMd);
          }
        }

        if (chunks.length === 0) return "\n\n";
        return `\n\n${chunks.join("\n\n")}\n\n`;
      },
    });
  }

  // Soften leftover data tables: still convertible, but track preservation.
  // When flattenLayoutTables is false, *all* tables hit this path.
  service.addRule("envloDataTableMarker", {
    filter: (node) => {
      const el = node as unknown as HtmlElement;
      if (el.nodeName !== "TABLE") return false;
      return !flattenLayoutTables || !isLayoutTable(el);
    },
    replacement: (content) => {
      stats.dataTablesPreserved += 1;
      const cleaned = content.replace(/\n{3,}/g, "\n\n").trim();
      return cleaned ? `\n\n${cleaned}\n\n` : "\n\n";
    },
  });

  // Drop empty spacer paragraphs / leftovers commonly left after flatten.
  service.addRule("envloCollapseBlank", {
    filter: (node) => {
      const el = node as unknown as HtmlElement;
      if (el.nodeName !== "P" && el.nodeName !== "DIV") return false;
      const text = (el.textContent ?? "").replace(/\u00a0/g, " ").trim();
      const imgs = el.querySelectorAll("img");
      return text.length === 0 && imgs.length === 0;
    },
    replacement: () => "\n",
  });
}

export function createEmailTurndown(options: EmailTurndownOptions = {}): {
  service: TurndownService;
  stats: LayoutRuleStats;
} {
  const service = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
  });
  const stats: LayoutRuleStats = {
    layoutTablesFlattened: 0,
    dataTablesPreserved: 0,
  };
  addEmailLayoutTurndownRules(service, stats, options);
  return { service, stats };
}

/**
 * Baseline Turndown that naively emits GFM pipe tables for *every* `<table>`.
 * Matches the common “drop email HTML into Turndown+GFM” mistake — layout grids
 * become broken/noisy pipes. Used as a compression / quality foil.
 */
export function createNaiveTurndown(): TurndownService {
  const service = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });

  service.addRule("envloNaiveGfmTables", {
    filter: "table",
    replacement: (_content, node) => {
      const table = node as unknown as HtmlElement;
      const rows = getDirectTableRows(table);
      if (rows.length === 0) return "\n\n";

      const matrix: string[][] = [];
      for (const row of rows) {
        const cells = getDirectTableCells(row).map((cell) => {
          const cellMd = service.turndown(cellInnerHtml(cell)).trim();
          return cellMd.replace(/\n+/g, " ").replace(/\|/g, "\\|");
        });
        if (cells.length > 0) matrix.push(cells);
      }
      if (matrix.length === 0) return "\n\n";

      const colCount = Math.max(...matrix.map((r) => r.length));
      const pad = (row: string[]) =>
        Array.from({ length: colCount }, (_, i) => row[i] ?? "").join(" | ");
      const header = pad(matrix[0] ?? []);
      const sep = Array.from({ length: colCount }, () => "---").join(" | ");
      const body = matrix.slice(1).map((row) => pad(row));
      return `\n\n| ${header} |\n| ${sep} |\n${body.map((r) => `| ${r} |`).join("\n")}\n\n`;
    },
  });

  return service;
}
