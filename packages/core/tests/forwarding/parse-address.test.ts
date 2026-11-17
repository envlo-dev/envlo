import { describe, expect, it } from "vitest";
import { extractEmailsFromHeader, parseAddressString } from "../../src/forwarding/index.js";

describe("parseAddressString", () => {
  it("parses name-addr and bare emails", () => {
    expect(parseAddressString("Alice Customer <alice@customer.example>")).toEqual({
      name: "Alice Customer",
      address: "alice@customer.example",
    });
    expect(parseAddressString("bob@buyer.example")).toEqual({
      name: "",
      address: "bob@buyer.example",
    });
  });

  it("extracts emails from X-Forwarded-For style values", () => {
    expect(extractEmailsFromHeader("eve@shopper.example")).toEqual(["eve@shopper.example"]);
    expect(extractEmailsFromHeader("203.0.113.10")).toEqual([]);
  });
});
