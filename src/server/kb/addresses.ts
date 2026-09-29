import { BlockList, isIP } from "node:net";

/**
 * Which visitors count as on site. An operator lists addresses and ranges, one
 * per line; a visitor is on site when theirs is among them.
 */

export type AddressList = { entries: string[]; rejected: string[] };

const MAX_ENTRIES = 200;

function normalize(entry: string): { address: string; prefix: number; family: "ipv4" | "ipv6" } | null {
  const [address = "", bits, ...rest] = entry.split("/");
  if (rest.length > 0) return null;

  const version = isIP(address);
  if (version === 0) return null;

  const widest = version === 4 ? 32 : 128;
  const prefix = bits === undefined ? widest : Number(bits);
  if (!/^\d+$/.test(bits ?? String(widest)) || prefix < 0 || prefix > widest) return null;

  return { address, prefix, family: version === 4 ? "ipv4" : "ipv6" };
}

/** Splits what was typed into what can be used and what cannot. */
export function parseAddressList(text: string): AddressList {
  const entries: string[] = [];
  const rejected: string[] = [];

  for (const raw of text.split(/[\s,;]+/)) {
    // A comment after the address says whose it is.
    const entry = raw.trim();
    if (entry === "") continue;
    if (normalize(entry) && entries.length < MAX_ENTRIES) entries.push(entry);
    else rejected.push(entry);
  }

  return { entries: [...new Set(entries)], rejected };
}

/**
 * Whether an address is on the list. An address that does not parse is on no
 * list, and an empty list admits nobody.
 */
export function isListed(address: string | null, entries: readonly string[]): boolean {
  if (!address) return false;

  let candidate = address.trim().toLowerCase();
  // An IPv4 visitor arriving over a dual-stack socket.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(candidate);
  if (mapped?.[1]) candidate = mapped[1];

  const version = isIP(candidate);
  if (version === 0) return false;

  const list = new BlockList();
  for (const entry of entries) {
    const parsed = normalize(entry);
    if (parsed) list.addSubnet(parsed.address, parsed.prefix, parsed.family);
  }
  return list.check(candidate, version === 4 ? "ipv4" : "ipv6");
}
