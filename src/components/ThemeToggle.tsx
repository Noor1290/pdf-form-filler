import { useEffect, useState } from "react";
import { MoonIcon, SunIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  chooseTheme,
  deviceTheme,
  storedTheme,
  type Theme,
} from "@/lib/theme";

// Small light/dark switch in the header. It shows the theme you would
// switch TO, named in words for screen readers and as a tooltip.
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(
    () => storedTheme() ?? deviceTheme(),
  );

  // Until a choice is made the page follows the device, so the button has
  // to follow it too if the device setting changes while the app is open.
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: light)");
    function followDevice() {
      if (!storedTheme()) setTheme(deviceTheme());
    }
    query.addEventListener("change", followDevice);
    return () => query.removeEventListener("change", followDevice);
  }, []);

  const next: Theme = theme === "dark" ? "light" : "dark";
  const label =
    next === "light" ? "Switch to light theme" : "Switch to dark theme";

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      onClick={() => {
        chooseTheme(next);
        setTheme(next);
      }}
    >
      {next === "light" ? <SunIcon /> : <MoonIcon />}
    </Button>
  );
}
