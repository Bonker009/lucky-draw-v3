"use client";

import { Eye, EyeOff, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Channel } from "@/lib/channel";
import type { Prize } from "@/lib/domain/types";
import type { PrizeAction, PrizeShow } from "@/lib/stage/prize-show";

/**
 * Announce the next prize before drawing for it: put it up covered ("Up next,
 * 3 to be won"), then reveal it, then hand the screen back to the draw.
 * Pressing Draw also takes it down, so forgetting the last step costs nothing.
 */
export function PrizeRevealControls({
  channel,
  busy,
  linked,
  selectedPrize,
  shown,
  shownName,
}: {
  channel: Channel;
  busy: boolean;
  linked: boolean;
  selectedPrize: Prize | undefined;
  /** What the stage is announcing, mirrored back. */
  shown: PrizeShow | null;
  shownName: string | null;
}) {
  const send = (action: PrizeAction) => channel.post({ kind: "cmd:prize", action });
  return (
    <section
      aria-label="Prize reveal"
      className="flex shrink-0 flex-col gap-2 rounded-2xl border border-border bg-card px-4 py-3"
    >
      <div className="flex h-7 items-center gap-2">
        <h2 className="ui-eyebrow whitespace-nowrap text-muted-foreground">Prize reveal</h2>
        {shown ? (
          <Badge variant="outline" className="max-w-40 truncate">
            {shown.revealed ? shownName : "Up next"}
          </Badge>
        ) : null}
        <Button
          variant={shown ? "secondary" : "ghost"}
          size="sm"
          className="ml-auto"
          disabled={!shown}
          onClick={() => send({ type: "hide" })}
        >
          <EyeOff />
          <span className="sm:hidden">Back</span>
          <span className="hidden sm:inline">Back to the draw</span>
        </Button>
      </div>
      {shown && !shown.revealed ? (
        <Button size="sm" disabled={!linked} onClick={() => send({ type: "reveal" })}>
          <Sparkles />
          Reveal {shownName}
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="min-w-0"
          disabled={!linked || busy || !selectedPrize}
          onClick={() => selectedPrize && send({ type: "show", prizeId: selectedPrize.id })}
        >
          <Eye />
          <span className="truncate">
            {selectedPrize ? `Show ${selectedPrize.name}` : "Show the prize"}
          </span>
        </Button>
      )}
    </section>
  );
}
