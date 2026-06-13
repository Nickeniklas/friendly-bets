"use client";

import { createContext, useContext, useSyncExternalStore } from "react";

const STORAGE_KEY = "fb-dark";
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return document.documentElement.classList.contains("dark");
}

// Matches themeScript's default (dark unless localStorage says otherwise),
// so the post-hydration value from getSnapshot won't cause a visible flash.
function getServerSnapshot() {
  return true;
}

function toggleDark() {
  const next = !document.documentElement.classList.contains("dark");
  document.documentElement.classList.toggle("dark", next);
  localStorage.setItem(STORAGE_KEY, String(next));
  listeners.forEach((l) => l());
}

const ThemeContext = createContext<{ dark: boolean; toggleDark: () => void }>({
  dark: true,
  toggleDark: () => {},
});

/** Tracks the dark/light toggle (persisted in localStorage, default dark) and
 * keeps the `.dark` class on <html> in sync. The class itself is applied
 * before hydration by the inline script in layout.tsx (see ThemeScript) to
 * avoid a flash of the wrong theme. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const dark = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return (
    <ThemeContext.Provider value={{ dark, toggleDark }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

/** Inline script: sets the `.dark` class before first paint based on
 * localStorage (defaults to dark, matching ThemeProvider's server snapshot). */
export const themeScript = `(function(){try{var d=localStorage.getItem('${STORAGE_KEY}')!=='false';document.documentElement.classList.toggle('dark',d);}catch(e){}})()`;
