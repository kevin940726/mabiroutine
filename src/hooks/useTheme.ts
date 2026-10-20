import { useCallback, useEffect, useState } from "react";

/** The three settings 外觀 offers. `system` is the default: it is what a fresh
 *  save and an unreadable one both mean, so `prefers-color-scheme` keeps
 *  working until the user asks for one of the explicit two. */
export type ThemeMode = "system" | "light" | "dark";

const STORAGE_KEY = "theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function isThemeMode(value: string | null): value is ThemeMode {
  return value === "system" || value === "light" || value === "dark";
}

/** The stored mode, with anything unrecognised resolving to `system`.
 *
 *  Unknown covers more than a missing key: `theme` held only `dark` / `light`
 *  before `system` existed, so an old save is exactly as valid as a new one,
 *  and a hand-edited or cleared value should fall back to the OS rather than
 *  pin light. The pre-paint script in `index.html` reads the key the same way.
 *  Private mode throws on read — same answer, no theme pop. */
function readThemeMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isThemeMode(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

/** The app's theme: `mode` is the setting, `resolvedDark` what it paints today.
 *
 *  Mounted once in `App`, never inside a component that unmounts — the
 *  `matchMedia` subscription only exists while the mode is `system`, so a hook
 *  that lives in the dropdown would stop following the OS the moment the menu
 *  closes, which is the failure this three-state row exists to fix. */
export function useTheme() {
  const [mode, setStoredMode] = useState<ThemeMode>(readThemeMode);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia(DARK_QUERY).matches);

  // Only while following the system: an explicit light/dark must ignore the OS,
  // and the listener has nothing to do then.
  useEffect(() => {
    if (mode !== "system") return;
    const mql = window.matchMedia(DARK_QUERY);
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [mode]);

  const resolvedDark = mode === "system" ? systemDark : mode === "dark";

  // Applying the class is syncing with an external system (allowed); the value
  // itself is derived during render, not set in an effect.
  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolvedDark);
  }, [resolvedDark]);

  const setMode = useCallback((next: ThemeMode) => {
    setStoredMode(next);
    // Re-read the OS on the way back into `system`: the value cannot be stale
    // while following it (the listener keeps it current), only after a spell on
    // an explicit mode, and this is the event that makes it matter again.
    if (next === "system") setSystemDark(window.matchMedia(DARK_QUERY).matches);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private mode / blocked storage: the choice lasts this visit, and the
      // next load falls back to the OS rather than breaking the app.
    }
  }, []);

  return { mode, resolvedDark, setMode };
}
