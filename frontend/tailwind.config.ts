import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        lime: "#CCFF00",
        oled: "#000000",
        // Theme-aware semantic colors. Defined as CSS-variable RGB triplets so
        // Tailwind opacity modifiers work: text-fg/30, border-fg/10, bg-bg, etc.
        bg:   "rgb(var(--color-bg)   / <alpha-value>)",
        fg:   "rgb(var(--color-fg)   / <alpha-value>)",
        card: "rgb(var(--color-card) / <alpha-value>)",
      },
      fontFamily: {
        display: ["var(--font-archivo)", "sans-serif"],
        body: ["var(--font-inter-tight)", "sans-serif"],
      },
      fontSize: {
        "10xl": ["10rem", { lineHeight: "1" }],
        "11xl": ["12rem", { lineHeight: "1" }],
      },
    },
  },
  plugins: [],
};

export default config;
