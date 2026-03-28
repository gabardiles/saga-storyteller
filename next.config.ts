import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Intentionally no COOP/COEP: this POC uses ScriptProcessorNode, not AudioWorklet/SAB.
  // COEP in particular has caused touch/interaction issues on iPad Safari while not being required here.
};

export default nextConfig;
