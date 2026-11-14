"use client";

import { useRef, useState } from "react";
import {
  Database,
  Download,
  FileSpreadsheet,
  FlaskConical,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { SectionCard } from "@/components/setup/section-card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  downloadJson,
  exportBundle,
  exportWinnersCsv,
  importBundle,
  type Bundle,
} from "@/lib/persist/backup";
import { storeImage } from "@/lib/persist/assets";
import {
  loadSamplePrizePhotos,
  sampleEventEvents,
} from "@/lib/persist/sample-data";
import { useEventStore } from "@/lib/store/event-store";

export function DataPanel() {
  const {
    state,
    log,
    commit,
    replaceLog,
    rehearsal,
    enterRehearsal,
    exitRehearsal,
  } = useEventStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  // Inline fields rather than window.prompt(): some embedded browsers (and
  // kiosk shells) don't implement it and throw, which left both actions dead.
  const [sampleCount, setSampleCount] = useState("250");
  const [resetConfirm, setResetConfirm] = useState("");

  return (
    <SectionCard
      title="Data"
      icon={<Database className="size-4" />}
      description="The whole event lives in this browser. Export before you close the laptop."
      actions={
        rehearsal ? (
          <Badge
            variant="outline"
            className="border-gold-ui/40 text-gold-ui-strong"
          >
            <FlaskConical className="size-3" />
            Rehearsing
          </Badge>
        ) : null
      }
    >
      <div className="flex flex-col gap-6">
        {rehearsal ? (
          <Alert className="border-gold-ui/30 bg-gold-ui/5">
            <FlaskConical className="size-4 text-gold-ui" />
            <AlertDescription className="text-foreground/75">
              Rehearsal is running. Draw as much as you like — nothing is
              written to disk, and ending the rehearsal restores the real log.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button
            disabled={rehearsal}
            onClick={async () => {
              // Guarded during rehearsal: the in-memory log holds unpersisted
              // practice draws, and a bundle containing them would be
              // indistinguishable from the real event.
              const bundle = await exportBundle(log, state.settings.eventName);
              const slug =
                state.settings.eventName
                  .replace(/[^\w-]+/g, "-")
                  .toLowerCase() || "lucky-draw";
              downloadJson(bundle, `${slug}-backup.json`);
              setStatus("Backup downloaded.");
            }}
          >
            <Download />
            Export backup
          </Button>

          <Button
            variant="outline"
            disabled={rehearsal || state.winners.length === 0}
            onClick={() => exportWinnersCsv(state)}
          >
            <FileSpreadsheet />
            Export winners CSV
          </Button>

          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                if (
                  log.length > 0 &&
                  !confirm(
                    "Restoring replaces everything currently in this browser. Continue?",
                  )
                ) {
                  return;
                }
                const bundle = JSON.parse(await file.text()) as Bundle;
                const events = await importBundle(bundle);
                await replaceLog(events);
                setStatus(`Restored ${events.length} events.`);
              } catch (error) {
                setStatus(
                  error instanceof Error
                    ? error.message
                    : "Could not read that backup.",
                );
              } finally {
                e.target.value = "";
              }
            }}
          />
          <Button variant="outline" onClick={() => fileRef.current?.click()}>
            <Upload />
            Restore backup
          </Button>

          <div className="flex items-center gap-1.5">
            <Input
              type="number"
              min={1}
              max={20000}
              value={sampleCount}
              onChange={(e) => setSampleCount(e.target.value)}
              aria-label="Number of sample participants"
              className="w-24"
            />
            <Button
              variant="outline"
              onClick={async () => {
                const count = Math.floor(Number(sampleCount));
                if (!Number.isFinite(count) || count < 1) {
                  setStatus("Enter how many sample participants to create.");
                  return;
                }
                if (
                  (state.participants.length > 0 || state.prizes.length > 0) &&
                  !confirm(
                    "This replaces the current participants, prizes and settings with a sample event. Continue?",
                  )
                ) {
                  return;
                }
                const capped = Math.min(count, 20000);
                try {
                  const photos = await loadSamplePrizePhotos(storeImage);
                  await commit(sampleEventEvents(capped, photos));
                  setStatus(
                    `Loaded a sample event with ${capped} participants. Start a rehearsal to try the whole show.`,
                  );
                } catch (error) {
                  setStatus(
                    error instanceof Error
                      ? error.message
                      : "Could not load sample data.",
                  );
                }
              }}
            >
              <Sparkles />
              Load sample event
            </Button>
          </div>

          <Button
            variant={rehearsal ? "default" : "outline"}
            onClick={async () => {
              if (rehearsal) {
                await exitRehearsal();
                setStatus("Rehearsal ended. Nothing was saved.");
              } else {
                enterRehearsal();
                setStatus(
                  "Rehearsal started. Draw as much as you like — none of it is saved.",
                );
              }
            }}
          >
            <FlaskConical />
            {rehearsal ? "End rehearsal" : "Start rehearsal"}
          </Button>
        </div>

        {status ? (
          <p className="text-sm text-foreground" role="status">
            {status}
          </p>
        ) : null}

        <Separator className="bg-muted" />

        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-destructive/25 bg-destructive/5 p-4">
          <div>
            <p className="text-sm font-medium text-foreground">
              Clear all results
            </p>
            <p className="text-xs text-muted-foreground">
              Removes every winner. Participants, prizes and settings are kept.
              Type RESET to enable.
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Input
              value={resetConfirm}
              onChange={(e) => setResetConfirm(e.target.value)}
              placeholder="RESET"
              aria-label="Type RESET to confirm clearing all results"
              disabled={state.winners.length === 0}
              className="w-24"
            />
            <Button
              variant="destructive"
              disabled={state.winners.length === 0 || resetConfirm !== "RESET"}
              onClick={async () => {
                try {
                  await commit([{ type: "EVENT_RESET" }]);
                  setResetConfirm("");
                  setStatus("Results cleared.");
                } catch (error) {
                  setStatus(
                    error instanceof Error
                      ? error.message
                      : "Could not clear results.",
                  );
                }
              }}
            >
              <Trash2 />
              Clear all results
            </Button>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}
