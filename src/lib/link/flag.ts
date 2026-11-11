const KEY = "mabiroutine:link:enabled";

export function linkEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setLinkEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: the switch does not stick, and the next reload is off.
  }
}
