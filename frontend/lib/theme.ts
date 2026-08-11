/**
 * Theme constants, deliberately in their own module with no "use client".
 *
 * `THEME_BOOTSTRAP` is inlined into the document head by the root layout, which
 * is a server component. A plain value exported from a "use client" module
 * cannot be read on the server -- it arrives as a client reference proxy -- so
 * this has to live outside the client boundary.
 */
export type Theme = "dark" | "light";

export const THEME_KEY = "traceci.theme";

/**
 * Runs before first paint, so the page never renders one theme and snaps to
 * the other. Falls back to the OS preference, then to light -- light is the
 * design's native mode, and the neutral ramp is tuned there first.
 */
export const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_KEY
)});if(t!=="dark"&&t!=="light"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}document.documentElement.setAttribute("data-theme",t);}catch(e){document.documentElement.setAttribute("data-theme","light");}})();`;
