"use client";

import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";

/**
 * Motion (used by the Magic UI components in `components/ui/`) ignores the OS
 * reduced-motion setting unless told otherwise. "user" makes every motion
 * animation honour it app-wide; the stage nests its own MotionConfig on top,
 * so the event's "Force reduced motion" setting reaches them too.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
