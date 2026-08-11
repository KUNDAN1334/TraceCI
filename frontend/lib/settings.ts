"use client";

import { useCallback, useEffect, useState } from "react";
import { THEME_KEY, type Theme } from "./theme";

/**
 * Preferences, and the one thing that is not a preference: the API key.
 *
 * Default behaviour is that the key lives in React state for the lifetime of
 * the tab and nowhere else. `sessionStorage` is opt-in and survives a reload
 * but not the tab; `localStorage` is deliberately not an option, because a
 * key that outlives the browser session is a key somebody forgot they left on
 * a shared machine.
 */

const PREFS_KEY = "traceci.prefs";
const KEY_CACHE = "traceci.key";

export type KeyRetention = "session" | "memory";

export type Prefs = {
  model: string;
  keyRetention: KeyRetention;
  lastRepo: string;
  lastBranch: string;
};

const DEFAULTS: Prefs = {
  model: "",
  keyRetention: "memory",
  lastRepo: "",
  lastBranch: "",
};

function readPrefs(): Prefs {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Prefs>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function usePrefs() {
  const [prefs, setPrefsState] = useState<Prefs>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setPrefsState(readPrefs());
    setLoaded(true);
  }, []);

  const setPrefs = useCallback((patch: Partial<Prefs>) => {
    setPrefsState((current) => {
      const next = { ...current, ...patch };
      try {
        window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        /* preferences are a nicety */
      }
      return next;
    });
  }, []);

  return { prefs, setPrefs, loaded };
}

export function readCachedKey(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem(KEY_CACHE) || "";
  } catch {
    return "";
  }
}

export function writeCachedKey(key: string, retention: KeyRetention) {
  if (typeof window === "undefined") return;
  try {
    if (retention === "session" && key) window.sessionStorage.setItem(KEY_CACHE, key);
    else window.sessionStorage.removeItem(KEY_CACHE);
  } catch {
    /* ignore */
  }
}

export function forgetKey() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(KEY_CACHE);
  } catch {
    /* ignore */
  }
}

// ------------------------------------------------------------------- theme

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const current = (document.documentElement.getAttribute("data-theme") as Theme) || "light";
    setThemeState(current);
    setMounted(true);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    document.documentElement.setAttribute("data-theme", next);
    setThemeState(next);
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  return { theme, setTheme, mounted };
}
