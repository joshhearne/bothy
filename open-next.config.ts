import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * Trove KB renders everything per request (`force-dynamic` throughout), so there
 * is no incremental cache to configure. Defaults are correct here.
 */
export default defineCloudflareConfig();
