// Light or dark. Until someone picks one, the app follows the device's own
// setting (handled in CSS). Once picked, only that one word is remembered:
// nothing else about the person or their data is stored here. The choice is
// this app's alone and is not shared with the Payroll Hub dashboard.
export type Theme = "light" | "dark";

const STORAGE_KEY = "pdf-editor:theme";

export function storedTheme(): Theme | null {
  const value = localStorage.getItem(STORAGE_KEY);
  return value === "light" || value === "dark" ? value : null;
}

export function deviceTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

// Run before the first paint so a remembered choice never flashes the
// other theme.
export function applyStoredTheme(): void {
  const theme = storedTheme();
  if (theme) document.documentElement.dataset.theme = theme;
}

export function chooseTheme(theme: Theme): void {
  localStorage.setItem(STORAGE_KEY, theme);
  document.documentElement.dataset.theme = theme;
}
