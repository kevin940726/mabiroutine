import { useEffect, useState } from "react";

// Mobile = Tailwind `sm` breakpoint and below (<640px). Used to keep the
// desktop UI pixel-identical to the released build while the RWD round
// iterates on mobile-only layouts. Single-mount (never render both versions:
// dnd-kit draggable ids must stay unique).
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
