import type { Quality } from "@/lib/hooks/use-frame-budget";

/** One prize in the night's running order, for the lineup style. */
export interface LineupEntry {
  id: string;
  name: string;
  imageAssetId?: string;
  /** done: fully drawn. current: the one being announced. upcoming: still to come. */
  state: "done" | "current" | "upcoming";
}

/**
 * The contract every prize-reveal style implements.
 *
 * Two beats, both pressed by the presenter: covered (`revealed` false —
 * "Up next", how many will win, but not what) and revealed. A style animates
 * the change; it never advances on its own. The prize is lit in warm white,
 * never gold: gold means "winner", and the prize is not one.
 */
export interface PrizeRevealProps {
  name: string;
  imageUrl: string | null;
  revealed: boolean;
  /** 1-based place in the running order, and how many prizes there are. */
  position: number;
  total: number;
  /** How many of this prize are still to be won. */
  toWin: number;
  lineup: LineupEntry[];
  reducedMotion: boolean;
  quality: Quality;
}
