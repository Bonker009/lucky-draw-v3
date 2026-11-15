"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { MonitorPlay, Play, RotateCcw, Settings2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { StoredEvent } from "@/lib/domain/types";
import { storeImage } from "@/lib/persist/assets";
import { loadSamplePrizePhotos, sampleEventEvents } from "@/lib/persist/sample-data";
import { useEventStore } from "@/lib/store/event-store";

/** Big enough to show off the wall's dots and groups, small enough to load instantly. */
const DEMO_PARTICIPANTS = 250;
/** What `sampleEventEvents` names the event; anything else is someone's real event. */
const SAMPLE_EVENT_NAME = "Sample Event";

/**
 * `/demo`: a ready-to-draw event for testers, with no setup.
 *
 * Opening it replaces whatever this browser holds with the sample event — 250
 * people, four prizes with photos — and offers the stage and the remote. It is
 * a clean slate every time (the log is replaced, not appended to), so "reset
 * the demo" is just opening the link again. Everything stays in this browser,
 * like any event; two testers never share data.
 *
 * Goes through the same paths as setup's "Load sample event" (photos stored
 * as real image assets) and backup import (`replaceLog`, which also tells any
 * open stage or remote window to reload).
 *
 * The one guard: if this browser holds an event that is not the demo — the
 * real event, on the real laptop — it asks before replacing it. Wiping a live
 * roster because someone opened the wrong link is not a test-environment
 * problem any more.
 */
export default function DemoPage() {
  const replaceLog = useEventStore((s) => s.replaceLog);
  const load = useEventStore((s) => s.load);
  const [status, setStatus] = useState<"loading" | "confirm" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [existingName, setExistingName] = useState("");
  const started = useRef(false);

  const setUp = async () => {
    setStatus("loading");
    try {
      const photos = await loadSamplePrizePhotos(storeImage);
      const at = Date.now();
      const events: StoredEvent[] = sampleEventEvents(DEMO_PARTICIPANTS, photos).map(
        (event, i) => ({ seq: i + 1, at, event }),
      );
      await replaceLog(events);
      setStatus("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not set up the demo event.");
      setStatus("error");
    }
  };

  useEffect(() => {
    // Once per visit, even if an effect runs twice.
    if (started.current) return;
    started.current = true;
    void (async () => {
      await load();
      const { state } = useEventStore.getState();
      const hasEvent = state.participants.length > 0 || state.prizes.length > 0;
      if (hasEvent && state.settings.eventName !== SAMPLE_EVENT_NAME) {
        setExistingName(state.settings.eventName || "Untitled event");
        setStatus("confirm");
        return;
      }
      await setUp();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per visit
  }, []);

  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-12">
      <div className="flex w-full max-w-xl flex-col gap-6 rounded-2xl border border-border bg-card p-8">
        {/* Announced as it changes; the heading keeps its heading role. */}
        <div className="flex flex-col gap-2" aria-live="polite">
          <p className="ui-eyebrow text-muted-foreground">Lucky Draw · test environment</p>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {status === "loading"
              ? "Setting up the demo event…"
              : status === "confirm"
                ? "Replace this browser's event?"
                : status === "ready"
                  ? "Demo event ready"
                  : "The demo could not be set up"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {status === "error"
              ? error
              : status === "confirm"
                ? `This browser already holds “${existingName}”. The demo replaces it — its participants, prizes and winners. Export a backup from Setup → Data first if you need it.`
                : `${DEMO_PARTICIPANTS} sample participants and four prizes with photos, in this browser only. Open this page again any time to start over.`}
          </p>
        </div>

        {status === "confirm" ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="destructive" onClick={() => void setUp()}>
              <TriangleAlert />
              Replace it with the demo
            </Button>
            <Button asChild variant="outline">
              <Link href="/">Keep it, go to setup</Link>
            </Button>
          </div>
        ) : null}

        {status === "ready" ? (
          <>
            <ol className="flex flex-col gap-2 text-sm text-foreground/85">
              <li>
                <span className="font-medium text-foreground">1.</span> Open the stage — the
                projector screen.
              </li>
              <li>
                <span className="font-medium text-foreground">2.</span> Open the control in another
                tab or window of <em>this</em> browser — it drives the stage.
              </li>
              <li>
                <span className="font-medium text-foreground">3.</span> On the control: Show and Reveal
                a prize, Draw, then try the photo session.
              </li>
            </ol>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button asChild size="lg">
                <a href="/stage" target="_blank" rel="noreferrer">
                  <Play />
                  Open stage
                </a>
              </Button>
              <Button asChild size="lg" variant="outline">
                <a href="/control" target="_blank" rel="noreferrer">
                  <MonitorPlay />
                  Open control
                </a>
              </Button>
            </div>
            <div className="flex flex-wrap gap-2 border-t border-border pt-4">
              <Button asChild variant="ghost" size="sm">
                <Link href="/">
                  <Settings2 />
                  Setup
                </Link>
              </Button>
              <Button variant="ghost" size="sm" onClick={() => window.location.reload()}>
                <RotateCcw />
                Reset demo
              </Button>
            </div>
          </>
        ) : status === "error" ? (
          <Button variant="outline" onClick={() => window.location.reload()}>
            <RotateCcw />
            Try again
          </Button>
        ) : null}
      </div>
    </main>
  );
}
