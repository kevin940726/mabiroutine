import { useEffect, useState } from "react";

// Mobile = Tailwind `sm` breakpoint and below (<640px). Single-mounts the
// mobile vs desktop layout variants (never render both versions: dnd-kit
// draggable ids must stay unique). Both variants evolve together — every UI
// change considers desktop and mobile.
export function useIsMobile() {
  const [mobile, setMobile] = useState(() => window.matchMedia("(max-width: 639px)").matches);
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 639px)");
    const onChange = () => setMobile(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return mobile;
}
