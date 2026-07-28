import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Playwright drives the dev server via 127.0.0.1 (see playwright.config.ts).
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
