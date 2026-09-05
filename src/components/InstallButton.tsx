import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

// Install affordance: Android/desktop Chrome fires beforeinstallprompt once
// the manifest + SW criteria pass — capture it and offer one 安裝 App button.
// iOS Safari never fires it: render a static Share → 加入主畫面 hint instead.
// Renders nothing when already running standalone.
export function InstallButton() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(
    () =>
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
  const isIos =
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  // Samsung Internet installs via its own menu (no beforeinstallprompt).
  const isSamsung = /samsungbrowser/i.test(navigator.userAgent);

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

  if (installed) return null;
  if (deferred) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          void deferred.prompt();
          setDeferred(null);
        }}
      >
        <Download className="h-4 w-4" />
        安裝 App
      </Button>
    );
  }
  if (isIos) {
    return (
      <span className="text-xs text-muted-foreground">iPhone：分享 → 加入主畫面即可安裝</span>
    );
  }
  if (isSamsung) {
    return (
      <span className="text-xs text-muted-foreground">三星瀏覽器：選單 → 加到主畫面即可安裝</span>
    );
  }
  return null;
}
