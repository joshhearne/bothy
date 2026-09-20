/**
 * Which addresses a check is allowed to talk to. A domain is typed by a user,
 * so "connect to whatever this name resolves to" is a request to reach
 * anything the server can reach — including the database, the vault sidecar,
 * and a cloud metadata endpoint.
 *
 * Checks therefore resolve a name first, drop anything that is not a public
 * address, and connect to the address rather than to the name. That also
 * closes DNS rebinding: the address that was checked is the address that is
 * connected to.
 */

function ipv4ToParts(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;

  const numbers = parts.map((part) => Number(part));
  if (numbers.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return numbers;
}

function isPublicIpv4(address: string): boolean {
  const parts = ipv4ToParts(address);
  if (!parts) return false;
  const [a, b] = parts as [number, number, number, number];

  if (a === 0 || a === 10 || a === 127) return false; // this host, private, loopback
  if (a === 169 && b === 254) return false; // link local, and cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false; // private
  if (a === 192 && b === 168) return false; // private
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier grade NAT
  if (a === 192 && b === 0) return false; // protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a >= 224) return false; // multicast and reserved
  return true;
}

export function isPublicAddress(address: string): boolean {
  const value = address.trim().toLowerCase();
  if (value === "") return false;

  if (!value.includes(":")) return isPublicIpv4(value);

  // An IPv4 address wearing an IPv6 coat still goes where IPv4 goes.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
  if (mapped?.[1]) return isPublicIpv4(mapped[1]);

  if (value === "::" || value === "::1") return false; // unspecified, loopback
  if (/^f[cd]/.test(value)) return false; // unique local
  if (/^fe[89ab]/.test(value)) return false; // link local
  if (value.startsWith("ff")) return false; // multicast
  return true;
}

/** The addresses a check may use, or an empty list, which means "do not connect". */
export function publicOnly(addresses: string[]): string[] {
  return addresses.filter((address) => isPublicAddress(address));
}
