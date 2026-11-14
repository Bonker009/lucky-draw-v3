import { Check } from "lucide-react";
import { awardedFor, orderedPrizes, remainingFor } from "@/lib/domain/selectors";
import type { DrawState } from "@/lib/domain/types";

/**
 * The running order, one compact line per prize.
 *
 * It lives in the side column, so it has to be scannable at a glance: name on
 * the left, a mini meter and what is left on the right. Two markers, because
 * they can differ for a moment: the highlighted row is what this remote has
 * selected, the gold dot is what the projector says it is showing.
 */
export function PrizeList({
  state,
  selected,
  onStage,
  disabled,
  onSelect,
}: {
  state: DrawState;
  selected: string | null;
  onStage: string | undefined;
  disabled: boolean;
  onSelect: (prizeId: string) => void;
}) {
  const prizes = orderedPrizes(state);

  if (prizes.length === 0) {
    return (
      <p className="p-4 text-center text-sm text-muted-foreground">
        No prizes yet. Add them in Setup.
      </p>
    );
  }

  return (
    <ul className="px-2 pb-2">
      {prizes.map((prize) => {
        const left = remainingFor(state, prize.id);
        const awarded = awardedFor(state, prize.id);
        const isSelected = prize.id === selected;
        const isOnStage = prize.id === onStage;
        const done = prize.quantity > 0 ? (awarded / prize.quantity) * 100 : 0;
        const finished = left === 0;
        return (
          <li key={prize.id}>
            <button
              type="button"
              disabled={disabled}
              aria-pressed={isSelected}
              title={`${prize.name} — ${awarded} of ${prize.quantity} awarded`}
              onClick={() => onSelect(prize.id)}
              className={`flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-sm transition-colors disabled:opacity-50 ${
                isSelected
                  ? "bg-muted text-foreground ring-1 ring-border ring-inset"
                  : "hover:bg-muted/60"
              }`}
            >
              <span
                aria-hidden
                className={`size-1.5 shrink-0 rounded-full ${
                  isOnStage ? "bg-gold-ui" : "bg-transparent"
                }`}
              />
              {isOnStage ? <span className="sr-only">On stage: </span> : null}
              <span
                className={`min-w-0 flex-1 truncate ${
                  finished
                    ? "text-muted-foreground"
                    : isSelected
                      ? "font-medium"
                      : "text-foreground/85"
                }`}
              >
                {prize.name}
              </span>

              {finished ? (
                <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                  <Check className="size-3.5" />
                  {prize.quantity}
                </span>
              ) : (
                <>
                  <span
                    aria-hidden
                    className="h-1 w-10 shrink-0 overflow-hidden rounded-full bg-muted"
                  >
                    <span
                      className="block h-full rounded-full bg-foreground"
                      style={{ width: `${done}%` }}
                    />
                  </span>
                  <span className="min-w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                    <span className="font-medium text-foreground">{left}</span>{" "}
                    left
                  </span>
                </>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
