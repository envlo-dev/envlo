import { describe, expect, it } from "vitest";
import { parseStylesheetRules, resolveElementStyles } from "../../src/firewall/index.js";

describe("parseStylesheetRules", () => {
  it("parses tag, class, and id selectors", () => {
    const rules = parseStylesheetRules(`
      /* comment */
      p { color: red }
      .hidden { display: none }
      #x { opacity: 0 }
      .a, .b { font-size: 0 }
    `);

    expect(rules.byTag.get("p")?.get("color")).toBe("red");
    expect(rules.byClass.get("hidden")?.get("display")).toBe("none");
    expect(rules.byId.get("x")?.get("opacity")).toBe("0");
    expect(rules.byClass.get("a")?.get("font-size")).toBe("0");
    expect(rules.byClass.get("b")?.get("font-size")).toBe("0");
  });

  it("ignores descendant selectors", () => {
    const rules = parseStylesheetRules(`div span { display: none }`);
    expect(rules.byTag.size).toBe(0);
    expect(rules.byClass.size).toBe(0);
  });
});

describe("resolveElementStyles", () => {
  it("lets inline styles override stylesheet rules", () => {
    const rules = parseStylesheetRules(`.box { display: none; color: red }`);
    const styles = resolveElementStyles(rules, {
      tagName: "div",
      getAttribute: (name) => {
        if (name === "class") return "box";
        if (name === "style") return "display: block";
        return null;
      },
    });
    expect(styles.get("display")).toBe("block");
    expect(styles.get("color")).toBe("red");
  });
});
