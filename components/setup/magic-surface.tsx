"use client";

import type { ReactNode } from "react";
import { MagicCard } from "@/components/ui/magic-card";
import { cn } from "@/lib/utils";

/**
 * Magic UI's MagicCard, set up for the operator surfaces.
 *
 * Its defaults are purple and pink on a hard-coded near-black; here every
 * colour comes from the theme tokens, so the cursor spotlight and the lit
 * border work in light and dark alike and never read as gold (gold means
 * "winner"). `--color-background` is pointed at the card colour because the
 * component paints its face with `bg-background`.
 */
export function MagicSurface({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <MagicCard
      gradientSize={220}
      gradientColor="var(--color-muted)"
      gradientOpacity={0.9}
      gradientFrom="var(--color-muted-foreground)"
      gradientTo="var(--color-border)"
      className={cn("[--color-background:var(--color-card)]", className)}
    >
      {children}
    </MagicCard>
  );
}
