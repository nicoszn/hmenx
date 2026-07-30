/** @type {import('next').NextConfig} */
const nextConfig = {
  // Stable top-level option as of Next.js 16 (was `experimental.serverComponentsExternalPackages`
  // pre-15). Keeps @huggingface/transformers as a real Node dependency instead of
  // getting bundled — it loads native WASM/ONNX assets at runtime.
  serverExternalPackages: ["@huggingface/transformers"],
};

export default nextConfig;
