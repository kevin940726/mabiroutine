import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ThemeMode } from "@/hooks/useTheme";

/** 外觀's three settings, in the order the row lists them. `system` first: it is
 *  the default, and putting the default first keeps the choice the user most
 *  often wants one click from the top of the group. */
const THEME_CHOICES: { value: ThemeMode; label: string }[] = [
  { value: "system", label: "跟隨系統" },
  { value: "light", label: "淺色" },
  { value: "dark", label: "深色" },
];

/** The app menu: choices and actions, where the header holds state that changes
 *  on its own.
 *
 *  Theme state is NOT here — `App` owns `useTheme` and passes it down, because
 *  this menu unmounts on close and a hook mounted inside it would drop the
 *  `matchMedia` listener that keeps 跟隨系統 live. */
export function AppMenu({ mode, setMode }: { mode: ThemeMode; setMode: (mode: ThemeMode) => void }) {
  return (
    // Not modal, like the character switcher: Radix's scroll lock would shift
    // the fixed character pill.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="選單">
          <Menu className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" aria-label="選單" className="min-w-[10rem]">
        {/* 外觀 is one row of the menu and three options of that row. Radio
            items rather than buttons in a single item: the menu swallows Tab
            (`event.preventDefault()` in Radix's content), so a nested control
            would be pointer-only, while these stay a `menuitemradio` group —
            arrows move, Enter/Space picks, `aria-checked` states the mode. */}
        <DropdownMenuLabel className="pb-0.5">外觀</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={mode}
          onValueChange={(v) => {
            if (v === "system" || v === "light" || v === "dark") setMode(v);
          }}
          aria-label="外觀"
        >
          {THEME_CHOICES.map((choice) => (
            <DropdownMenuRadioItem
              key={choice.value}
              value={choice.value}
              // Choosing is inline, so the menu stays open: Radix closes on
              // select unless the item's own event is cancelled, and the two
              // clicks of "dark, then back to system" should not need the
              // trigger twice.
              onSelect={(e) => e.preventDefault()}
            >
              {choice.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
