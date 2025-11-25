import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  webpack: (config) => {
    config.resolve = config.resolve || {};
    config.resolve.alias = config.resolve.alias || {};
    config.resolve.alias["@lark-base-open/js-sdk"] = path.resolve(
      __dirname,
      "app/lib/bitable-sdk.ts"
    );
    return config;
  },
};

export default nextConfig;
