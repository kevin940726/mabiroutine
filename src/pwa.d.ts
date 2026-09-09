/// <reference types="vite-plugin-pwa/client" />

// Chrome/Edge install prompt (Android + desktop). Not Safari — iOS installs
// only via Share → Add to Home Screen, detected separately by UA.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
