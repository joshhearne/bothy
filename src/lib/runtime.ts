/**
 * Bothy runs in two places: a Node container (the primary, fully featured
 * deployment) and Cloudflare Workers. A handful of seams differ between them,
 * and each one checks here rather than guessing.
 */

/** True inside a Cloudflare Worker, including during `wrangler dev`. */
export function isWorkers(): boolean {
  return (
    typeof navigator !== "undefined" &&
    navigator.userAgent === "Cloudflare-Workers"
  );
}

/** True in the Node server, which is where native modules and fs are allowed. */
export function isNodeRuntime(): boolean {
  return !isWorkers();
}
