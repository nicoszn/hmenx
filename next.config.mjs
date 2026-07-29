/** @type {import('next').NextConfig} */
const nextConfig = {
  // @xenova/transformers loads native WASM/ONNX assets at runtime — it must run
  // as a real Node.js dependency, not get bundled into the serverless function.
  // On Next.js 15+ this option is `serverExternalPackages` (no `experimental` wrapper).
  experimental: {
    serverComponentsExternalPackages: ["@xenova/transformers"],
  },
};

export default nextConfig;
