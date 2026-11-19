import { describe, expect, it } from "vitest";
import { sanitizeInvisibleHtml } from "../../src/firewall/sanitize-dom.js";

describe("sanitizeInvisibleHtml full documents", () => {
  it("preserves body content when given a DOCTYPE/html document", () => {
    const html = `<!DOCTYPE html>
<html><head><style>.x{color:red}</style></head>
<body><p>Visible order update</p>
<div style="display:none">HIDDEN INJECTION</div>
</body></html>`;

    const result = sanitizeInvisibleHtml(html);
    expect(result.timedOut).toBe(false);
    expect(result.html).toContain("Visible order update");
    expect(result.html).not.toContain("HIDDEN INJECTION");
    // Full-document parse must not collapse to an empty/DOCTYPE-only body.
    expect(result.html.length).toBeGreaterThan(20);
  });
});
