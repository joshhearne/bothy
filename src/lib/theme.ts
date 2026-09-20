/**
 * Color scheme choice. "system" follows the operating system, which is what a
 * reader who has never touched this gets.
 */
export const THEMES = ["system", "light", "dark"] as const;

export type Theme = (typeof THEMES)[number];

export const DEFAULT_THEME: Theme = "system";

export function isTheme(value: unknown): value is Theme {
  return (
    typeof value === "string" && (THEMES as readonly string[]).includes(value)
  );
}

/** The cookie a reader's own choice is remembered in. */
export const THEME_COOKIE = "bothy-theme";
