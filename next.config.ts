import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required for the slim runtime stage in the Dockerfile.
  output: "standalone",
  serverExternalPackages: ["@node-rs/argon2", "pg"],
  typedRoutes: true,
};

export default nextConfig;
