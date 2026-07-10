import { useCallback, useEffect, useState } from 'react';

// Drei global auswählbare Oberflächen-Themes:
// - 'light'  : helle Variante (kühl, weiße Cards auf grau-blauem Grund)
// - 'dark'   : Navy-Produkt-Look (Default für Sitzungen ohne Präferenz)
// - 'studio' : warmes, ruhiges Sand/Creme-Theme nach den Studio-Mockups
export type Theme = 'light' | 'dark' | 'studio';

// Reihenfolge für das zyklische Durchschalten (z. B. Kompakt-Topbar auf Mobile).
export const THEME_ORDER: Theme[] = ['light', 'dark', 'studio'];

const THEME_STORAGE_KEY = 'asset-console-theme';

function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark' || value === 'studio';
}

function resolveInitialTheme(): Theme {
  if (typeof window === 'undefined') {
    return 'dark';
  }
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (isTheme(stored)) {
    return stored;
  }
  // UI-V2: Dark (Navy) ist der Produkt-Look und damit Default für alle ohne
  // gespeicherte Präferenz — unabhängig vom OS-Schema. Der Umschalter bleibt.
  return 'dark';
}

// Setzt die passende Theme-Klasse auf <html>. Nur eine der Nicht-Light-Klassen
// darf aktiv sein — Light ist der klassenlose Basiszustand (:root ohne Modifier).
function applyThemeClass(theme: Theme): void {
  const root = document.documentElement;
  root.classList.remove('dark', 'studio');
  if (theme === 'dark') {
    root.classList.add('dark');
  } else if (theme === 'studio') {
    root.classList.add('studio');
  }
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(resolveInitialTheme);

  useEffect(() => {
    applyThemeClass(theme);
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState((current) => (current === next ? current : next));
  }, []);

  // Durchschalten in fester Reihenfolge (für Ein-Klick-Umschalter ohne Menü).
  const cycleTheme = useCallback(() => {
    setThemeState((current) => {
      const index = THEME_ORDER.indexOf(current);
      return THEME_ORDER[(index + 1) % THEME_ORDER.length];
    });
  }, []);

  return {
    theme,
    setTheme,
    cycleTheme,
    // Rückwärtskompatibler Alias: schaltet jetzt zyklisch durch alle Themes.
    toggleTheme: cycleTheme,
  };
}
