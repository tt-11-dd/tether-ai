export const THEMES = ["white", "paper", "dark"] as const;
export type ThemeId = (typeof THEMES)[number];
export const DEFAULT_THEME: ThemeId = "paper";
export const THEME_STORAGE_KEY = "tether.theme";

export function parseTheme(value: unknown): ThemeId {
  return THEMES.includes(value as ThemeId) ? (value as ThemeId) : DEFAULT_THEME;
}

export function readStoredTheme(): ThemeId {
  try {
    return parseTheme(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

export function applyTheme(theme: ThemeId): ThemeId {
  const next = parseTheme(theme);
  document.documentElement.dataset.theme = next;
  document.documentElement.style.colorScheme = next === "dark" ? "dark" : "light";
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    /* private mode */
  }
  return next;
}
