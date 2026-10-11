import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Loaded by Node at runtime instead of bundled: the Dial SDK reads its own
  // package.json at import time, and libsql/pg ship native or TCP code.
  serverExternalPackages: ["@getdial/sdk", "pubnub", "@libsql/client", "libsql", "pg"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
