import "server-only";
import { Resolver } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { gunzipSync } from "node:zlib";
import { PRODUCT_NAME, SOURCE_URL } from "@/lib/app-meta";
import { isPublicAddress, publicOnly } from "@/server/domain/addresses";

/**
 * Fetching a page for a connector. The address is typed by a person and every
 * link on every page is written by a stranger, so each request — each
 * redirect included — resolves the name first, refuses anything that is not a
 * public address, and connects to the address it checked.
 */

const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;
export const MAX_PAGE_BYTES = 8 * 1024 * 1024;

export const USER_AGENT = `${PRODUCT_NAME}/1.0 (+${SOURCE_URL})`;

export class FetchRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FetchRefusedError";
  }
}

export type FetchedPage = {
  url: string;
  status: number;
  contentType: string;
  body: Buffer;
  lastModified: Date | null;
};

async function vet(hostname: string): Promise<{ address: string; family: 4 | 6 }> {
  const host = hostname.replace(/^\[|\]$/g, "");

  const literal = isIP(host);
  if (literal !== 0) {
    if (!isPublicAddress(host)) throw new FetchRefusedError("That address is not public");
    return { address: host, family: literal as 4 | 6 };
  }

  const dns = new Resolver({ timeout: 5_000, tries: 2 });
  const [a, aaaa] = await Promise.all([
    dns.resolve4(host).catch(() => [] as string[]),
    dns.resolve6(host).catch(() => [] as string[]),
  ]);

  const address = publicOnly([...a, ...aaaa])[0];
  if (!address) throw new FetchRefusedError("That name has no public address");
  return { address, family: address.includes(":") ? 6 : 4 };
}

function once(url: URL, accept: string): Promise<{
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}> {
  return vet(url.hostname).then(
    ({ address, family }) =>
      new Promise((resolve, reject) => {
        const send = url.protocol === "https:" ? httpsRequest : httpRequest;
        const request = send(
          url,
          {
            method: "GET",
            timeout: TIMEOUT_MS,
            headers: { "User-Agent": USER_AGENT, Accept: accept, "Accept-Encoding": "gzip" },
            // The name is still what is asked for and what the certificate is
            // checked against; the connection goes to the vetted address.
            lookup: (_hostname, options, callback) => {
              if (typeof options === "object" && options.all) {
                (callback as unknown as (e: null, a: { address: string; family: number }[]) => void)(
                  null,
                  [{ address, family }],
                );
              } else {
                (callback as (e: null, a: string, f: number) => void)(null, address, family);
              }
            },
          },
          (response) => {
            const parts: Buffer[] = [];
            let size = 0;

            response.on("data", (part: Buffer) => {
              size += part.length;
              if (size > MAX_PAGE_BYTES) {
                request.destroy(new FetchRefusedError("The page is too large"));
                return;
              }
              parts.push(part);
            });
            response.on("end", () =>
              resolve({
                status: response.statusCode ?? 0,
                headers: response.headers,
                body: Buffer.concat(parts),
              }),
            );
            response.on("error", reject);
          },
        );

        request.on("timeout", () => request.destroy(new Error("Timed out")));
        request.on("error", reject);
        request.end();
      }),
  );
}

export function isWebUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username !== "" || url.password !== "") return null;
    return url;
  } catch {
    return null;
  }
}

export async function fetchPublic(
  address: string,
  accept = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5",
): Promise<FetchedPage> {
  let url = isWebUrl(address);
  if (!url) throw new FetchRefusedError("Only http and https addresses are fetched");

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await once(url, accept);

    const location = response.headers.location;
    if (response.status >= 300 && response.status < 400 && typeof location === "string") {
      const next = isWebUrl(new URL(location, url).toString());
      if (!next) throw new FetchRefusedError("Redirected somewhere that is not a web address");
      url = next;
      continue;
    }

    let body = response.body;
    const encoding = String(response.headers["content-encoding"] ?? "").toLowerCase();
    const gzipped = body[0] === 0x1f && body[1] === 0x8b;
    if ((encoding.includes("gzip") || url.pathname.endsWith(".gz")) && gzipped) {
      body = gunzipSync(body, { maxOutputLength: MAX_PAGE_BYTES * 4 });
    }

    const modified = response.headers["last-modified"];
    const lastModified = typeof modified === "string" ? new Date(modified) : null;

    return {
      url: url.toString(),
      status: response.status,
      contentType: String(response.headers["content-type"] ?? "").toLowerCase(),
      body,
      lastModified: lastModified && !Number.isNaN(lastModified.getTime()) ? lastModified : null,
    };
  }

  throw new FetchRefusedError("Too many redirects");
}
