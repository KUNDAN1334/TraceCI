import type { Config } from "tailwindcss";

/**
 * One token set, two themes.
 *
 * Colours are stored as bare OKLCH channels (`L C H`) in globals.css and
 * composed here, so `<alpha-value>` still works (`border-line/60`,
 * `bg-danger/10`). OKLCH rather than HSL because the palette is a perceptual
 * neutral ramp -- in HSL the mid-greys drift and the borders stop reading as
 * one family.
 */
const oklch = (name: string) => `oklch(var(--${name}) / <alpha-value>)`;

const config: Config = {
  darkMode: ["class", '[data-theme="dark"]'],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Instrument Sans",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      colors: {
        canvas: oklch("canvas"),
        surface: oklch("surface"),
        elevated: oklch("elevated"),
        line: {
          DEFAULT: oklch("line"),
          strong: oklch("line-strong"),
        },
        fg: {
          DEFAULT: oklch("fg"),
          muted: oklch("fg-muted"),
          subtle: oklch("fg-subtle"),
        },
        accent: {
          DEFAULT: oklch("accent"),
          fg: oklch("accent-fg"),
        },
        ok: oklch("ok"),
        warn: oklch("warn"),
        danger: oklch("danger"),
        info: oklch("info"),
        violet: oklch("violet"),
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.02em" }],
      },
      borderRadius: {
        DEFAULT: "0.375rem",
        md: "0.5rem",
        lg: "0.75rem",
        xl: "1rem",
      },
      maxWidth: {
        prose: "68ch",
        shell: "1120px",
      },
      boxShadow: {
        panel: "0 1px 2px oklch(var(--shadow) / 0.05), 0 12px 32px -22px oklch(var(--shadow) / 0.22)",
        // The hero panel's signature lift, taken from the reference design.
        hero: "0 40px 90px -50px oklch(var(--shadow) / 0.30)",
        sticky: "0 24px 60px -34px oklch(var(--shadow) / 0.14)",
      },
      transitionTimingFunction: {
        rail: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
      keyframes: {
        // Log lines and trace rows arriving: the motion that makes a stream
        // read as a stream instead of as a list that was already there.
        line: {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "none" },
        },
        rise: {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "none" },
        },
        fade: { from: { opacity: "0" }, to: { opacity: "1" } },
        blink: { "0%,100%": { opacity: "1" }, "50%": { opacity: "0" } },
        pulse: { "0%,100%": { opacity: "1" }, "50%": { opacity: "0.25" } },
        sweep: { "0%": { transform: "translateX(-100%)" }, "100%": { transform: "translateX(200%)" } },
      },
      animation: {
        line: "line 320ms cubic-bezier(0.22, 1, 0.36, 1) both",
        rise: "rise 420ms cubic-bezier(0.22, 1, 0.36, 1) both",
        fade: "fade 260ms ease-out both",
        blink: "blink 1s steps(1) infinite",
        pulse: "pulse 1.8s ease-in-out infinite",
        sweep: "sweep 1.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
export default config;
