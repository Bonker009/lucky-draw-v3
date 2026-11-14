import { Camera, CameraOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ROSTER_ALL } from "@/components/stage/photo-call";
import type { Channel } from "@/lib/channel";
import type { Prize } from "@/lib/domain/types";

/**
 * Events shoot a group photo per prize, so the projector needs every winner
 * of that prize up at once for people to find themselves and come to the
 * stage.
 */
export function PhotoSession({
  channel,
  busy,
  rosterUp,
  selectedPrize,
  awardedHere,
  awardedTotal,
}: {
  channel: Channel;
  busy: boolean;
  rosterUp: boolean;
  selectedPrize: Prize | undefined;
  awardedHere: number;
  awardedTotal: number;
}) {
  return (
    <section
      aria-label="Photo session"
      title="Puts every winner of a prize on the projector, numbered, so the group can be called up and checked before the photo."
      className="flex shrink-0 flex-col gap-2 rounded-2xl border border-border bg-card px-4 py-3"
    >
      <div className="flex h-7 items-center gap-2">
        <h2 className="ui-eyebrow whitespace-nowrap text-muted-foreground">Photo session</h2>
        {rosterUp ? (
          <Badge variant="outline" className="border-gold-ui/50 text-gold-ui-strong">
            On screen
          </Badge>
        ) : null}
        <Button
          variant={rosterUp ? "secondary" : "ghost"}
          size="sm"
          className="ml-auto"
          aria-label="Back to the draw"
          disabled={!rosterUp}
          onClick={() => channel.post({ kind: "cmd:hideRoster" })}
        >
          <CameraOff />
          <span className="sm:hidden">Back</span>
          <span className="hidden sm:inline">Back to the draw</span>
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          size="sm"
          className="min-w-0"
          disabled={busy || !selectedPrize || awardedHere === 0}
          onClick={() =>
            selectedPrize &&
            channel.post({ kind: "cmd:showRoster", scope: selectedPrize.id })
          }
        >
          <Camera />
          <span className="truncate">
            {selectedPrize
              ? `${selectedPrize.name} (${awardedHere})`
              : "This prize"}
          </span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy || awardedTotal === 0}
          onClick={() => channel.post({ kind: "cmd:showRoster", scope: ROSTER_ALL })}
        >
          <Camera />
          All winners ({awardedTotal})
        </Button>
      </div>
    </section>
  );
}
