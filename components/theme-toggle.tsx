"use client";

import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

const ORDER = ["light", "dark", "system"] as const;

const LABEL = {
  light: "Light",
  dark: "Dark",
  system: "System",
} as const;

/**
 * Cycles light → dark → system.
 *
 * Renders a placeholder until mounted: the resolved theme is only known in the
 * browser, and rendering the real icon during SSR produces a hydration
 * mismatch that React logs on every load.
 */
/** Never changes, so the store never notifies — this only distinguishes SSR. */
const neverChanges = () => () => {};

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    neverChanges,
    () => true,
    () => false,
  );

  const current = (theme ?? "system") as (typeof ORDER)[number];
  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];

  if (!mounted) {
    return <Button variant="ghost" size="icon-sm" disabled aria-hidden />;
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={() => setTheme(next)}
      title={`Theme: ${LABEL[current]}. Switch to ${LABEL[next]}.`}
      aria-label={`Theme: ${LABEL[current]}. Switch to ${LABEL[next]}.`}
    >
      {current === "light" ? (
        <Sun />
      ) : current === "dark" ? (
        <Moon />
      ) : (
        <Monitor />
      )}
    </Button>
  );
}
