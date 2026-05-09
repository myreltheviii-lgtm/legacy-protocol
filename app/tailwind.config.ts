import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Base palette — deep obsidian with warm undertones
        obsidian:  { DEFAULT: "#0C0A09", 50: "#1C1917", 100: "#292524", 200: "#44403C" },
        // Zone colours — match ActivityZone enum
        zone: {
          green:  "#10B981",
          yellow: "#EAB308",
          orange: "#F97316",
          red:    "#EF4444",
        },
        // Amber accent — primary interactive colour
        amber: {
          DEFAULT: "#F59E0B",
          dim:     "#92400E",
          muted:   "#78350F",
        },
        // Warm white for body text
        cream: "#FAFAF9",
        stone: {
          300: "#D6D3D1",
          400: "#A8A29E",
          500: "#78716C",
          600: "#57534E",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        mono:    ["var(--font-mono)", "Courier New", "monospace"],
        body:    ["var(--font-body)", "system-ui", "sans-serif"],
      },
      animation: {
        "ring-pulse":  "ringPulse 2s ease-in-out infinite",
        "fade-in":     "fadeIn 0.4s ease-out forwards",
        "slide-up":    "slideUp 0.3s ease-out forwards",
      },
      keyframes: {
        ringPulse: {
          "0%, 100%": { opacity: "1" },
          "50%":      { opacity: "0.6" },
        },
        fadeIn: {
          from: { opacity: "0" },
          to:   { opacity: "1" },
        },
        slideUp: {
          from: { opacity: "0", transform: "translateY(8px)" },
          to:   { opacity: "1", transform: "translateY(0)" },
        },
      },
      backgroundImage: {
        "grid-pattern":
          "linear-gradient(rgba(255,255,255,.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.03) 1px, transparent 1px)",
      },
      backgroundSize: {
        "grid-sm": "32px 32px",
      },
    },
  },
  plugins: [],
};

export default config;

