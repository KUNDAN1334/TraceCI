import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      colors: {
        ink: {
          950: "#0a0c10",
          900: "#0f1218",
          850: "#141922",
          800: "#1a212c",
          700: "#242d3a",
          600: "#33404f",
          400: "#7c8899",
          300: "#a3adbb",
          100: "#e6eaf0",
        },
      },
      keyframes: {
        slidein: { from: { opacity: "0", transform: "translateY(6px)" }, to: { opacity: "1", transform: "none" } },
        pulseline: { "0%,100%": { opacity: "0.35" }, "50%": { opacity: "1" } },
      },
      animation: {
        slidein: "slidein 220ms ease-out",
        pulseline: "pulseline 1.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
export default config;
