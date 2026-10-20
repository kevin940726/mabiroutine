import { useEffect, useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function initialDark(): boolean {
  const stored = localStorage.getItem("theme");
  if (stored) return stored === "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** The app menu: choices and actions, where the header holds state that changes
 *  on its own. The theme is the only row for now, and it lives above the
 *  content so closing the menu does not unmount the toggle. */
export function AppMenu() {
  const [dark, setDark] = useState(initialDark);
  // Applying the class is syncing with an external system (allowed); the value
  // itself is derived during render, not set in an effect.
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    localStorage.setItem("theme", next ? "dark" : "light");
  };

  return (
    // Not modal, like the character switcher: Radix's scroll lock would shift
    // the fixed character pill.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="選單">
          <Menu className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" aria-label="選單" className="min-w-[9rem]">
        <DropdownMenuItem onSelect={toggle}>
          外觀
          <span className="ml-auto text-xs text-muted-foreground">{dark ? "深色" : "淺色"}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
