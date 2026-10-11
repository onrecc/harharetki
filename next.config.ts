import { networkInterfaces } from "node:os";
import type { NextConfig } from "next";

/** This machine's LAN IPv4 addresses, so phones on the same network can use `next dev -H 0.0.0.0`. */
const lanHosts = Object.values(networkInterfaces())
  .flat()
  .filter((n) => n && n.family === "IPv4" && !n.internal)
  .map((n) => n!.address);

const nextConfig: NextConfig = {
  // Testers run the app with `npm run dev`; keep the Next.js dev badge from covering the UI.
  // Compile/runtime errors are still shown.
  devIndicators: false,
  allowedDevOrigins: lanHosts,
  cacheComponents: true,
  partialPrefetching: true,
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
