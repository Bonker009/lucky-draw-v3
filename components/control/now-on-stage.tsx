import { ExternalLink } from "lucide-react";
import { BlurFade } from "@/components/ui/blur-fade";
import { Button } from "@/components/ui/button";
import { NumberTicker } from "@/components/ui/number-ticker";
import type { StageLink, StageMirror } from "@/lib/hooks/use-stage-mirror";

const PHASE_COPY: Record<string, string> = {
  idle: "Ready",
  spinning: "Spinning",
  revealing: "Revealing",
  celebrating: "Celebrating",
  stopped: "Stopped",
};

const PHASE_DOT: Record<string, string> = {
  idle: "bg-muted-foreground/60",
  spinning: "bg-gold-ui pulse-soft",
  revealing: "bg-gold-ui",
  celebrating: "bg-gold-ui",
  stopped: "bg-destructive",
};

/**
 * What the projector is showing right now. The single most important thing
 * on the remote, so it gets the top slot and the big type.
 */
export function NowOnStage({
  mirror,
  link,
  now,
  revealedName,
  rosterLabel,
  boardLabel,
  boardTitle,
}: {
  mirror: StageMirror | null;
  link: StageLink;
  now: number;
  revealedName: string | null;
  /** Set while the photo-call board has replaced the name wall. */
  rosterLabel: string | null;
  /** Set while a prize is being announced: the eyebrow, and the prize. */
  boardLabel?: string;
  boardTitle?: string;
}) {
  // A prize announcement outranks a stale winner name, like the photo board.
  const headline = boardTitle ?? rosterLabel ?? revealedName;
  if (link === "none" || !mirror) {
    return (
      <StageProblem
        tone="border-destructive/30 bg-destructive/5"
        title="No stage window"
        titleTone="text-destructive"
        detail="Open the stage on the projector — this remote has nothing to drive until then."
        action="Open /stage"
      />
    );
  }

  if (link === "lost") {
    const ago = Math.max(1, Math.round((now - mirror.seenAt) / 1000));
    return (
      <StageProblem
        tone="border-amber-500/40 bg-amber-500/10"
        title="Stage stopped answering"
        titleTone="text-amber-700 dark:text-amber-400"
        detail={`Last heard ${ago}s ago — the tab may be closed or asleep. Draw is paused until it is back.`}
        action="Reopen /stage"
        alert
      />
    );
  }

  // One strip, not a card: it sits above the winners pane and only has to
  // answer "what is the projector doing" at a glance.
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-card px-4 py-2.5">
      <p className="ui-eyebrow flex shrink-0 items-center gap-2 text-muted-foreground">
        <span
          aria-hidden
          className={`size-2 rounded-full ${PHASE_DOT[mirror.phase] ?? "bg-muted-foreground/60"}`}
        />
        {boardLabel ?? (rosterLabel ? "Photo board" : (PHASE_COPY[mirror.phase] ?? mirror.phase))}
      </p>
      <div
        aria-live="polite"
        className={`min-w-0 flex-1 ${
          boardTitle
            ? "text-lg font-semibold text-foreground"
            : headline
              ? "text-lg font-semibold text-gold-ui-strong"
              : "text-sm text-muted-foreground/70"
        }`}
      >
        {/* Keyed on the text, so each newly revealed name blurs in rather
            than swapping in place — the presenter's eye catches the change. */}
        <BlurFade key={headline ?? "none"} duration={0.35} className="truncate">
          {headline ?? "Nothing on screen"}
        </BlurFade>
      </div>
      {mirror.pending > 0 ? (
        <p className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
          <NumberTicker
            value={mirror.pending}
            startValue={mirror.pending}
            className="tracking-normal text-inherit dark:text-inherit"
          />{" "}
          more to go
        </p>
      ) : null}
    </div>
  );
}

function StageProblem({
  tone,
  title,
  titleTone,
  detail,
  action,
  alert = false,
}: {
  tone: string;
  title: string;
  titleTone: string;
  detail: string;
  action: string;
  alert?: boolean;
}) {
  return (
    <div
      role={alert ? "alert" : undefined}
      className={`flex items-center gap-3 rounded-xl border px-4 py-2.5 ${tone}`}
    >
      <div className="min-w-0 flex-1">
        <p className={`ui-eyebrow ${titleTone}`}>{title}</p>
        <p className="line-clamp-2 text-xs text-foreground/75">{detail}</p>
      </div>
      <Button asChild variant="outline" size="sm" className="shrink-0">
        <a href="/stage" target="_blank" rel="noreferrer">
          <ExternalLink />
          {action}
        </a>
      </Button>
    </div>
  );
}
