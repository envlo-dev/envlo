/**
 * Heuristics to distinguish legacy email *layout* grids from real data tables.
 * Layout tables should be flattened to stacked Markdown blocks; data tables can
 * keep tabular structure.
 */

type ElementLike = {
  nodeName: string;
  getAttribute: (name: string) => string | null;
  hasAttribute: (name: string) => boolean;
  children: ArrayLike<ElementLike>;
  querySelectorAll: (selector: string) => ArrayLike<ElementLike>;
  textContent: string | null;
};

function tag(el: ElementLike): string {
  return el.nodeName.toLowerCase();
}

function directChildren(el: ElementLike, name: string): ElementLike[] {
  const out: ElementLike[] = [];
  const kids = el.children;
  for (let i = 0; i < kids.length; i += 1) {
    const child = kids[i];
    if (child && tag(child) === name) out.push(child);
  }
  return out;
}

function directRows(table: ElementLike): ElementLike[] {
  const rows: ElementLike[] = [];
  for (const section of [
    ...directChildren(table, "thead"),
    ...directChildren(table, "tbody"),
    ...directChildren(table, "tfoot"),
  ]) {
    rows.push(...directChildren(section, "tr"));
  }
  rows.push(...directChildren(table, "tr"));
  return rows;
}

function directCells(row: ElementLike): ElementLike[] {
  return [...directChildren(row, "td"), ...directChildren(row, "th")];
}

function countDescendant(table: ElementLike, selector: string): number {
  return table.querySelectorAll(selector).length;
}

function avgCellTextLength(table: ElementLike): number {
  const cells = table.querySelectorAll("td, th");
  if (cells.length === 0) return 0;
  let total = 0;
  for (let i = 0; i < cells.length; i += 1) {
    total += (cells[i]?.textContent ?? "").trim().length;
  }
  return total / cells.length;
}

function maxColumns(table: ElementLike): number {
  let max = 0;
  for (const row of directRows(table)) {
    max = Math.max(max, directCells(row).length);
  }
  return max;
}

/**
 * True when a `<table>` is almost certainly an email layout grid rather than
 * a semantic data table.
 */
export function isLayoutTable(node: ElementLike): boolean {
  if (tag(node) !== "table") return false;

  const role = (node.getAttribute("role") ?? "").toLowerCase();
  if (role === "presentation" || role === "none") return true;

  // Explicit data semantics win.
  if (role === "table" || role === "grid") return false;
  if (countDescendant(node, "th") > 0 && maxColumns(node) >= 3) return false;

  const className = (node.getAttribute("class") ?? "").toLowerCase();
  if (/\b(data-table|datatable|spreadsheet)\b/.test(className)) return false;

  // Classic HTML-email layout signals.
  const layoutAttrHints =
    node.hasAttribute("cellpadding") ||
    node.hasAttribute("cellspacing") ||
    node.hasAttribute("bgcolor") ||
    node.hasAttribute("background") ||
    (node.getAttribute("width") === "100%" && maxColumns(node) <= 3);

  const nestedLayout = countDescendant(node, "table") > 0;
  const singleColumn = maxColumns(node) <= 1;
  const mostlyBlocks =
    countDescendant(node, "td p, td div, td table, td img, td h1, td h2, td h3") >=
    Math.max(1, Math.floor(countDescendant(node, "td") * 0.4));

  // Short multi-column numeric/text grids look like data.
  if (maxColumns(node) >= 4 && avgCellTextLength(node) < 48 && !nestedLayout) {
    return false;
  }

  if (layoutAttrHints || nestedLayout || singleColumn || mostlyBlocks) {
    return true;
  }

  // Default for email HTML: prefer flatten when uncertain and narrow.
  return maxColumns(node) <= 2;
}

export function getDirectTableRows(table: ElementLike): ElementLike[] {
  return directRows(table);
}

export function getDirectTableCells(row: ElementLike): ElementLike[] {
  return directCells(row);
}
