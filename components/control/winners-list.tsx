import { participantName, winnersFor } from "@/lib/domain/selectors";
import type { DrawState } from "@/lib/domain/types";

/**
 * Committed winners of the selected prize, newest first.
 *
 * Deliberately not spoiler-adjusted like the stage's rail: this is the
 * presenter's own screen, and they should see a winner the moment it is
 * committed — it lets them find the name before the drum lands on it.
 */
export function WinnersList({
  state,
  prizeId,
  wide = false,
}: {
  state: DrawState;
  prizeId: string | null;
  /** In the main pane: bigger names, flowed into columns on wide screens. */
  wide?: boolean;
}) {
  const prize = prizeId ? state.prizesById.get(prizeId) : undefined;
  const winners = prizeId ? winnersFor(state, prizeId) : [];

  return (
    <section
      aria-label="Winners"
      className="flex min-h-0 flex-col rounded-2xl border border-border bg-card"
    >
      <div className="flex items-baseline justify-between gap-3 px-4 pb-2 pt-4">
        <h2 className="ui-eyebrow truncate text-muted-foreground">
          Winners{prize ? ` · ${prize.name}` : ""}
        </h2>
        {prize ? (
          <p className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {winners.length} of {prize.quantity}
          </p>
        ) : null}
      </div>

      {winners.length === 0 ? (
        <p
          className={`px-4 pb-4 text-sm text-muted-foreground ${
            wide ? "flex flex-1 items-center justify-center py-10" : ""
          }`}
        >
          No winners yet{prize ? ` for ${prize.name}` : ""}.
        </p>
      ) : (
        <ol
          className={`min-h-0 flex-1 overflow-y-auto px-2 pb-2 ${
            wide
              ? "grid content-start gap-x-2 gap-y-0.5 sm:grid-cols-2 2xl:grid-cols-3"
              : ""
          }`}
        >
          {winners
            .map((w, i) => ({ w, n: i + 1 }))
            .reverse()
            .map(({ w, n }, i) => (
              <li
                key={w.seq}
                className={`flex items-center gap-3 rounded-lg px-2 ${wide ? "py-2" : "py-1.5"} ${
                  i === 0 ? "bg-gold-ui/10" : ""
                }`}
              >
                <span className="w-6 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                  {n}
                </span>
                <span
                  className={`min-w-0 flex-1 truncate ${wide ? "text-base" : "text-sm"} ${
                    i === 0 ? "font-medium text-foreground" : "text-foreground/80"
                  }`}
                >
                  {participantName(state, w.participantId)}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {new Date(w.at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </li>
            ))}
        </ol>
      )}
    </section>
  );
}
