export const STORAGE_KEY = "mabiroutine:v2";

export function loadRaw(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
export function saveRaw(json: string) {
  try {
    localStorage.setItem(STORAGE_KEY, json);
  } catch {
    // quota exceeded silently
  }
}
export function clearRaw() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}
