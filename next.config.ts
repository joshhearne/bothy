import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required for the slim runtime stage in the Dockerfile.
  output: "standalone",
  serverExternalPackages: ["pg"],
  /**
   * pg reaches for pg-cloudflare when it runs on Workers, where TCP goes
   * through cloudflare:sockets. Tracing copies the package manifest but not
   * its build output, so ask for the whole thing.
   */
  outputFileTracingIncludes: {
    "/**": ["./node_modules/pg-cloudflare/**"],
  },
  typedRoutes: true,
};

export default nextConfig;
