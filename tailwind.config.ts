import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: "#0B0E11",
        panel: "#12161B",
        border: "#232A31",
        ink: "#E7ECEF",
        muted: "#8B98A5",
        signal: "#E8A33D", // coherence / adaptive-threshold accent
        edge: "#4FD1C5", // graph edges / tool-token accent
        danger: "#E5484D",
      },
      fontFamily: {
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
        sans: ["ui-sans-serif", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
