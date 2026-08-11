"use client";

import { useTheme } from "@/lib/settings";

export function ThemeToggle() {
  const { theme, setTheme, mounted } = useTheme();
  const next = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      className="grid h-8 w-8 place-items-center rounded-md border border-line text-fg-subtle transition-colors hover:border-line-strong hover:text-fg"
    >
      {/* Shows the theme you would switch *to*. Stable until the client knows
          the current theme, so the markup does not mismatch on hydration. */}
      {!mounted || theme === "light" ? (
        <svg viewBox="0 0 16 16" aria-hidden className="h-4 w-4">
          <path
            d="M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8 5.7 5.7 0 1 0 13.2 9.6Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" aria-hidden className="h-4 w-4">
          <circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path
            d="M8 1v1.6M8 13.4V15M15 8h-1.6M2.6 8H1M12.9 3.1l-1.1 1.1M4.2 11.8l-1.1 1.1M12.9 12.9l-1.1-1.1M4.2 4.2 3.1 3.1"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      )}
    </button>
  );
}
