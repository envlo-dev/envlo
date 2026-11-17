import type { Address, Mailbox } from "postal-mime";
import type { MimeAddress } from "./types.js";

function isMailbox(address: Address): address is Mailbox {
  return typeof address.address === "string" && address.group === undefined;
}

/** Flatten postal-mime address objects / groups into simple `{ name, address }` rows. */
export function flattenAddresses(addresses: Address | Address[] | undefined): MimeAddress[] {
  if (!addresses) return [];

  const list = Array.isArray(addresses) ? addresses : [addresses];
  const out: MimeAddress[] = [];

  for (const entry of list) {
    if (isMailbox(entry)) {
      if (entry.address) {
        out.push({ name: entry.name || "", address: entry.address });
      }
      continue;
    }

    for (const member of entry.group ?? []) {
      if (member.address) {
        out.push({ name: member.name || "", address: member.address });
      }
    }
  }

  return out;
}

export function firstAddress(addresses: Address | Address[] | undefined): MimeAddress | null {
  return flattenAddresses(addresses)[0] ?? null;
}
