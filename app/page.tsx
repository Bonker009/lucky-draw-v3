"use client";

import { useEffect } from "react";
import Link from "next/link";
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
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { eventStats } from "@/lib/domain/selectors";
import { useEventStore } from "@/lib/store/event-store";

export default function SetupPage() {
  const { state, ready, load, lastError, clearError } = useEventStore();

  useEffect(() => {
    void load();
  }, [load]);

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
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-4 px-6 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-full bg-gold-ui shadow-[0_0_14px_2px_rgb(212_175_55/0.55)]"
            />
            <div className="min-w-0">
              <p className="ui-eyebrow text-muted-foreground">
                Lucky Draw · Setup
              </p>
              <h1 className="truncate text-lg font-semibold text-foreground">
                {state.settings.eventName || "Untitled event"}
              </h1>
            </div>
          </div>

          <Badge
            variant="outline"
            className={
              canRun
                ? "border-gold-ui/40 bg-gold-ui/10 text-gold-ui-strong"
                : "border-border text-muted-foreground"
            }
          >
            {canRun ? "Ready to run" : "Not ready"}
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
              <Button asChild size="sm">
                <Link href="/stage">
                  <Play />
                  Open stage
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
          <Alert className="mb-6 border-gold-ui/30 bg-gold-ui/5 text-foreground/75">
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

        <dl className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Participants" value={stats.totalParticipants} />
          <Stat label="Eligible" value={stats.eligible} />
          <Stat label="Awarded" value={stats.awarded} accent />
          <Stat label="Slots left" value={stats.remaining} />
        </dl>

        {/* Tabs rather than one long scroll: the five panels are five separate
            jobs, and only Participants is normally revisited mid-event. */}
        <Tabs defaultValue="participants" className="gap-6">
          <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-card p-1">
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
      className="gap-2 px-4 py-2 text-muted-foreground data-[state=active]:bg-muted data-[state=active]:text-gold-ui-strong"
    >
      {icon}
      {children}
    </TabsTrigger>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <dt className="ui-eyebrow text-muted-foreground">{label}</dt>
      <dd
        className={`mt-1 text-2xl font-semibold tabular-nums ${
          accent ? "text-gold-ui-strong" : "text-foreground"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
