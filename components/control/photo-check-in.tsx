"use client";

import { CheckCheck, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Channel } from "@/lib/channel";
import type { PhotoAction, PhotoState, RosterEntry } from "@/lib/stage/photo-session";

/**
 * Who has come up for the photo, ticked off by the presenter.
 *
 * Takes the remote's big pane while a photo board is up — the winners list it
 * replaces is the same people. Every tick goes to the stage as a command, and
 * the board on the projector greys the name out, so the room can see who is
 * still missing. Presentation only: nothing here is written to the log.
 */
export function PhotoCheckIn({
  channel,
  title,
  roster,
  photo,
  group,
  groups,
}: {
  channel: Channel;
  title: string;
  /** The current group's entries. */
  roster: RosterEntry[];
  photo: PhotoState;
  group: number;
  groups: number;
}) {
  const here = new Set(photo.here);
  const absent = new Set(photo.absent);
  const expected = roster.filter((r) => !absent.has(r.participantId));
  const arrived = expected.filter((r) => here.has(r.participantId)).length;
  const send = (action: PhotoAction) => channel.post({ kind: "cmd:photo", action });

  return (
    <section
      aria-label="Check-in"
      className="flex min-h-0 flex-col rounded-2xl border border-border bg-card"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 pb-2 pt-4">
        <h2 className="ui-eyebrow truncate text-muted-foreground">
          Check-in · {title}
          {groups > 1 ? ` · group ${group + 1} of ${groups}` : ""}
        </h2>
        <p className="text-sm tabular-nums text-foreground">
          <span className="font-semibold">
            {arrived} of {expected.length}
          </span>{" "}
          <span className="text-muted-foreground">on stage</span>
        </p>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          disabled={arrived === expected.length}
          onClick={() => send({ type: "allHere" })}
        >
          <CheckCheck />
          Mark all here
        </Button>
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {roster.map((r) => {
          const isHere = here.has(r.participantId);
          const isAbsent = absent.has(r.participantId);
          const id = `checkin-${r.participantId}`;
          return (
            <li
              key={r.participantId}
              className="flex items-center gap-3 rounded-lg px-2 hover:bg-muted/50"
            >
              <input
                id={id}
                type="checkbox"
                checked={isHere}
                onChange={(e) =>
                  send({ type: "here", participantId: r.participantId, here: e.target.checked })
                }
                className="size-5 shrink-0 accent-foreground"
              />
              <label
                htmlFor={id}
                className="flex min-w-0 flex-1 cursor-pointer items-baseline gap-3 py-2.5"
              >
                <span className="w-6 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                  {r.n}
                </span>
                <span
                  className={`min-w-0 flex-1 truncate text-base ${
                    isAbsent
                      ? "text-muted-foreground line-through"
                      : isHere
                        ? "text-muted-foreground"
                        : "font-medium text-foreground"
                  }`}
                >
                  {r.name}
                </span>
              </label>
              <Button
                variant={isAbsent ? "secondary" : "ghost"}
                size="sm"
                aria-pressed={isAbsent}
                aria-label={`${isAbsent ? "Undo no-show for" : "Mark as not here:"} ${r.name}`}
                onClick={() =>
                  send({ type: "absent", participantId: r.participantId, absent: !isAbsent })
                }
                className="shrink-0 text-muted-foreground"
              >
                <UserX />
                <span className="hidden sm:inline">{isAbsent ? "Undo" : "No-show"}</span>
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
