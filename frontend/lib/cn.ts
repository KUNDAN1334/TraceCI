/** Class joiner. Deliberately not `clsx` -- twelve lines beats a dependency. */
export type ClassValue =
  | string
  | number
  | null
  | undefined
  | false
  | ClassValue[]
  | Record<string, boolean | null | undefined>;

export function cn(...values: ClassValue[]): string {
  const out: string[] = [];
  for (const v of values) {
    if (!v) continue;
    if (typeof v === "string" || typeof v === "number") out.push(String(v));
    else if (Array.isArray(v)) {
      const nested = cn(...v);
      if (nested) out.push(nested);
    } else {
      for (const [key, on] of Object.entries(v)) if (on) out.push(key);
    }
  }
  return out.join(" ");
}
