import { Camera, CameraOff, ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ROSTER_ALL } from "@/components/stage/photo-call";
import type { Channel } from "@/lib/channel";
import type { Prize } from "@/lib/domain/types";
import type { PhotoAction, PhotoState } from "@/lib/stage/photo-session";

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
  photo,
  groups,
}: {
  channel: Channel;
  busy: boolean;
  rosterUp: boolean;
  selectedPrize: Prize | undefined;
  awardedHere: number;
  awardedTotal: number;
  /** The board's mode and group, mirrored from the stage while it is up. */
  photo: PhotoState | null;
  groups: number;
}) {
  const send = (action: PhotoAction) => channel.post({ kind: "cmd:photo", action });
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

      {/* While a board is up: what the projector shows (names to call people
          up, or the backdrop for the photo itself), and which group. */}
      {rosterUp && photo ? (
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="radiogroup"
            aria-label="Board shows"
            className="grid grid-cols-2 gap-0.5 rounded-lg border border-border p-0.5"
          >
            {(
              [
                ["call", "Call up"],
                ["backdrop", "Backdrop"],
              ] as const
            ).map(([mode, label]) => (
              <Button
                key={mode}
                role="radio"
                aria-checked={photo.mode === mode}
                variant={photo.mode === mode ? "secondary" : "ghost"}
                size="sm"
                onClick={() => send({ type: "mode", mode })}
              >
                {label}
              </Button>
            ))}
          </div>
          {groups > 1 ? (
            <div className="ml-auto flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Previous group"
                disabled={photo.group <= 0}
                onClick={() => send({ type: "group", group: photo.group - 1 })}
              >
                <ChevronLeft />
              </Button>
              <span className="text-xs tabular-nums text-muted-foreground">
                Group {photo.group + 1} of {groups}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Next group"
                disabled={photo.group >= groups - 1}
                onClick={() => send({ type: "group", group: photo.group + 1 })}
              >
                <ChevronRight />
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

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
