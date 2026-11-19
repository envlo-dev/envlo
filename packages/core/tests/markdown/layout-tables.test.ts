import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { isLayoutTable } from "../../src/markdown/index.js";

function tableFrom(html: string) {
  const { document } = parseHTML(`<!DOCTYPE html><html><body>${html}</body></html>`);
  return document.querySelector("table");
}

describe("isLayoutTable", () => {
  it("treats role=presentation tables as layout", () => {
    const table = tableFrom(`<table role="presentation"><tr><td>Hi</td></tr></table>`);
    expect(isLayoutTable(table!)).toBe(true);
  });

  it("treats nested email grids as layout", () => {
    const table = tableFrom(`
      <table width="100%" cellpadding="0">
        <tr><td>
          <table><tr><td>Inner</td></tr></table>
        </td></tr>
      </table>
    `);
    expect(isLayoutTable(table!)).toBe(true);
  });

  it("preserves headered multi-column data tables", () => {
    const table = tableFrom(`
      <table>
        <tr><th>SKU</th><th>Qty</th><th>Price</th><th>Total</th></tr>
        <tr><td>A1</td><td>2</td><td>3</td><td>6</td></tr>
      </table>
    `);
    expect(isLayoutTable(table!)).toBe(false);
  });
});
