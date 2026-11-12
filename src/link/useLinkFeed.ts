import { useEffect } from "react";
import { startLinkFeed } from "@/link/feed";

// Start-only: the dialog's switch stops the feed, and StrictMode's
// mount/unmount/mount would otherwise kill a client started by the click.
export function useLinkFeed(): void {
  useEffect(() => {
    startLinkFeed();
  }, []);
}
