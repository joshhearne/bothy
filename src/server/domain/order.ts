/**
 * DNS answers arrive in whatever order the resolver felt like, and that
 * order carries no meaning. Sorted, the same records read the same every
 * time, and a diff by eye between two runs is honest.
 */

type Mx = { exchange: string; priority: number };

export type DnsRecords = {
  a: string[];
  aaaa: string[];
  mx: Mx[];
  ns: string[];
  txt: string[];
  cname: string[];
};

const byText = (a: string, b: string) =>
  a.localeCompare(b, "en", { sensitivity: "base" });

/** Addresses, names and TXT values alphabetically; MX by priority, then name. */
export function orderDns<T extends DnsRecords>(data: T): T {
  return {
    ...data,
    a: [...data.a].sort(byText),
    aaaa: [...data.aaaa].sort(byText),
    mx: [...data.mx].sort(
      (x, y) => x.priority - y.priority || byText(x.exchange, y.exchange),
    ),
    ns: [...data.ns].sort(byText),
    txt: [...data.txt].sort(byText),
    cname: [...data.cname].sort(byText),
  };
}
