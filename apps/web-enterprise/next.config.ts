import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // React, please be extra strict
  reactStrictMode: true,
  
  
  // Environment variables exposed to browser
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000',
  },
};

export default nextConfig;
