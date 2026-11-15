"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useReducedMotion } from "motion/react";
import {
  Database,
  Gift,
  MonitorPlay,
  Play,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { DataPanel } from "@/components/setup/data-panel";
import { FairnessPanel } from "@/components/setup/fairness-panel";
import { ParticipantsPanel } from "@/components/setup/participants-panel";
import { PresentationPanel } from "@/components/setup/presentation-panel";
import { PrizesPanel } from "@/components/setup/prizes-panel";
import { ThemeToggle } from "@/components/theme-toggle";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { AnimatedShinyText } from "@/components/ui/animated-shiny-text";
import { BorderBeam } from "@/components/ui/border-beam";
import { Button } from "@/components/ui/button";
import { NumberTicker } from "@/components/ui/number-ticker";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { eventStats } from "@/lib/domain/selectors";
import { useEventStore } from "@/lib/store/event-store";

export default function SetupPage() {
  const { state, ready, load, lastError, clearError } = useEventStore();

  useEffect(() => {
    void load();
  }, [load]);

  // Motion's border beam is not a transform, so MotionConfig's reduced-motion
  // switch does not stop it; it is simply not mounted then.
  const reduceMotion = useReducedMotion();
  const stats = eventStats(state);
  const canRun = stats.totalParticipants > 0 && stats.totalPrizes > 0;

  if (!ready) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <p className="ui-eyebrow text-muted-foreground">Loading event…</p>
      </main>
    );
  }

  return (
    <div className="setup-aura min-h-dvh">
      {/* Sticky, because the operator jumps between panels constantly during
          setup and the stage buttons have to stay within reach. */}
      <header className="sticky top-0 z-40 border-b border-border/80 bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex min-h-15 w-full max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-6 py-3">
          <span
            aria-hidden
            // Always the stage's near-black, in both themes: it is the
            // projector in miniature, and the gold dot vanished on the light
            // square that `bg-foreground` turned into in dark mode.
            className="grid size-6 shrink-0 place-items-center rounded-[7px] bg-base-900 ring-1 ring-white/10"
          >
            <span className="size-2 rounded-full bg-gold-bright" />
          </span>
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <span className="shrink-0 text-muted-foreground">Lucky Draw</span>
            <span aria-hidden className="text-muted-foreground/50">
              /
            </span>
            <h1 className="truncate font-semibold text-foreground">
              {state.settings.eventName || "Untitled event"}
            </h1>
          </div>

          <Badge
            variant="outline"
            className="gap-1.5 rounded-full border-border bg-card font-medium text-foreground"
          >
            <span
              aria-hidden
              className={`size-1.5 rounded-full ${
                canRun
                  ? "bg-emerald-600 shadow-[0_0_0_3px_rgb(5_150_105/0.15)]"
                  : "bg-muted-foreground"
              }`}
            />
            {canRun ? (
              // A slow sheen across "Ready to run": the one status line on
              // this page that means "you can start".
              <AnimatedShinyText className="mx-0 text-foreground/80 dark:text-foreground/80">
                Ready to run
              </AnimatedShinyText>
            ) : (
              "Not ready"
            )}
          </Badge>

          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <Button asChild variant="outline" size="sm">
              <Link href="/control">
                <MonitorPlay />
                Open control
              </Link>
            </Button>
            {canRun ? (
              // A light travelling the edge of the next step. A link, not
              // Magic UI's ShimmerButton: it has to stay an <a> so it can be
              // opened in a new window on the projector.
              <Button asChild size="sm" className="relative overflow-hidden">
                <Link href="/stage">
                  <Play />
                  Open stage
                  {reduceMotion ? null : (
                    <BorderBeam
                      size={36}
                      duration={4}
                      colorFrom="var(--primary-foreground)"
                      colorTo="var(--muted-foreground)"
                    />
                  )}
                </Link>
              </Button>
            ) : (
              <Button size="sm" disabled>
                <Play />
                Open stage
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-6 pb-20 pt-8">
        <p className="mb-6 max-w-2xl text-sm text-muted-foreground">
          Everything runs in this browser. Once the event is loaded you can
          unplug the network — no server is involved in the draw.
        </p>

        {!canRun ? (
          <Alert className="mb-6 border-border bg-muted/50 text-foreground/80">
            <AlertDescription>
              Add participants and at least one prize to open the stage.
            </AlertDescription>
          </Alert>
        ) : null}

        {lastError ? (
          <Alert
            variant="destructive"
            className="mb-6 flex items-center justify-between gap-4"
          >
            <AlertDescription>{lastError}</AlertDescription>
            <Button variant="ghost" size="sm" onClick={clearError}>
              Dismiss
            </Button>
          </Alert>
        ) : null}

        {/* One strip split by hairlines rather than four cards: the numbers are
            read together ("248 in, 12 out, 4 to go"), so they sit together. */}
        <dl className="mb-8 grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-card sm:grid-cols-4 [&>div]:border-border [&>div:not(:last-child)]:sm:border-r [&>div:nth-child(odd)]:max-sm:border-r [&>div:nth-child(-n+2)]:max-sm:border-b">
          <Stat label="Participants" value={stats.totalParticipants} />
          <Stat label="Eligible" value={stats.eligible} />
          <Stat label="Awarded" value={stats.awarded} />
          <Stat label="Slots left" value={stats.remaining} />
        </dl>

        {/* Tabs rather than one long scroll: the five panels are five separate
            jobs, and only Participants is normally revisited mid-event. */}
        <Tabs defaultValue="participants" className="gap-6">
          <TabsList
            variant="line"
            className="h-auto w-full flex-wrap justify-start gap-6 border-b border-border p-0"
          >
            <SetupTab value="participants" icon={<Users />}>
              Participants
            </SetupTab>
            <SetupTab value="prizes" icon={<Gift />}>
              Prizes
            </SetupTab>
            <SetupTab value="presentation" icon={<SlidersHorizontal />}>
              Presentation
            </SetupTab>
            <SetupTab value="fairness" icon={<ShieldCheck />}>
              Fairness
            </SetupTab>
            <SetupTab value="data" icon={<Database />}>
              Data
            </SetupTab>
          </TabsList>

          <TabsContent value="participants">
            <ParticipantsPanel />
          </TabsContent>
          <TabsContent value="prizes">
            <PrizesPanel />
          </TabsContent>
          <TabsContent value="presentation">
            <PresentationPanel />
          </TabsContent>
          <TabsContent value="fairness">
            <FairnessPanel />
          </TabsContent>
          <TabsContent value="data">
            <DataPanel />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function SetupTab({
  value,
  icon,
  children,
}: {
  value: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <TabsTrigger
      value={value}
      // An underline, not a filled pill: the tab row is navigation, and a
      // filled active tab read as one more button among the panel's actions.
      className="h-11 flex-none gap-2 rounded-none px-0 text-muted-foreground hover:text-foreground group-data-horizontal/tabs:after:-bottom-px"
    >
      {icon}
      {children}
    </TabsTrigger>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="px-5 py-4">
      <dt className="ui-eyebrow text-muted-foreground">{label}</dt>
      <dd className="mt-1.5 font-mono text-[1.75rem] leading-none font-semibold tracking-tight tabular-nums text-foreground">
        {/* Rolls to the new figure on load and after an import or undo. */}
        <NumberTicker
          value={value}
          className="tracking-tight text-inherit dark:text-inherit"
        />
      </dd>
    </div>
  );
}
