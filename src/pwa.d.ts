/// <reference types="vite-plugin-pwa/client" />

// Build stamp injected via vite `define` (vite.config.ts) — compared in App
// on boot to announce "已更新到新版本" after an auto-update takeover.
declare const __BUILD_TIME__: string;

// Chrome/Edge install prompt (Android + desktop). Not Safari — iOS installs
// only via Share → Add to Home Screen, detected separately by UA.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
