import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: "/webgpu-create2-salt-miner",
  output: "export",
  trailingSlash: true,
  webpack: (config, options) => {
    config.module.rules.push({
      test: /\.wgsl/,
      type: "asset/source",
    });
    return config;
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
