import { useEffect, useState } from "react";

export type InstallStatus = "installed" | "prompt" | "ios" | "samsung" | "none";

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function useInstall() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandalone);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const status: InstallStatus = installed
    ? "installed"
    : deferred
      ? "prompt"
      : isIos()
        ? "ios"
        : /samsungbrowser/i.test(navigator.userAgent)
          ? "samsung"
          : "none";

  const promptInstall = () => {
    if (!deferred) return;
    void deferred.prompt();
    setDeferred(null);
  };

  return { status, promptInstall };
}
