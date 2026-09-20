"use client";

import { useMemo, useRef, useState } from "react";
import { Search, Trophy, Upload, UserRound, X } from "lucide-react";
import { SectionCard } from "@/components/setup/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  parseParticipantFile,
  parsePastedNames,
  rowsToParticipants,
} from "@/lib/persist/import";
import { useEventStore } from "@/lib/store/event-store";

const PAGE_SIZE = 60;

export function ParticipantsPanel() {
  const { state, commit } = useEventStore();
  const [search, setSearch] = useState("");
  const [paste, setPaste] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const fileRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return state.participants;
    return state.participants.filter((p) => p.name.toLowerCase().includes(q));
  }, [search, state.participants]);

  // Only ever render a page of rows. v2 rendered every participant as a card
  // with hover gradients and recomputed the winners list inside each one.
  const visible = filtered.slice(0, limit);
  const eligible = state.participants.length - state.winnerByParticipant.size;

  async function addRows(rows: Record<string, string>[], replace: boolean) {
    const existing = replace ? [] : state.participants;
    const result = rowsToParticipants(rows, existing);

    if (result.participants.length === 0) {
      setStatus(
        result.duplicates.length > 0
          ? `No new names — all ${result.duplicates.length} were already on the list.`
          : "No names found in that input.",
      );
      return;
    }

    try {
      await commit([
        {
          type: "PARTICIPANTS_SET",
          participants: [...existing, ...result.participants],
        },
      ]);
      const parts = [`Added ${result.participants.length}`];
      if (result.duplicates.length > 0) {
        parts.push(`skipped ${result.duplicates.length} duplicate`);
      }
      if (result.skipped > 0) parts.push(`${result.skipped} blank`);
      setStatus(`${parts.join(", ")}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not add those.");
    }
  }

  return (
    <SectionCard
      title="Participants"
      icon={<UserRound className="size-4" />}
      description="Import a spreadsheet or paste names. Every row becomes its own entry, so repeated names stay separate people."
      actions={
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="border-border text-foreground/75">
            {state.participants.length} on the list
          </Badge>
          <Badge variant="outline" className="border-gold-ui/40 text-gold-ui-strong">
            {eligible} eligible
          </Badge>
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        {/* Import */}
        <div className="rounded-xl border border-dashed border-border bg-muted/40 p-5">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xlsm,.txt,.tsv"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setStatus("Reading file…");
              try {
                const rows = await parseParticipantFile(file);
                await addRows(rows, false);
              } catch (error) {
                setStatus(
                  error instanceof Error
                    ? error.message
                    : "Could not read that file.",
                );
              } finally {
                e.target.value = "";
              }
            }}
          />
          <div className="flex flex-wrap items-center gap-4">
            <Button size="lg" onClick={() => fileRef.current?.click()}>
              <Upload />
              Import CSV or Excel
            </Button>
            <p className="text-xs text-muted-foreground">
              First row is headers. A column called Name is used if present,
              otherwise the first column. Other columns are kept and shown on
              the reveal.
            </p>
          </div>
        </div>

        {/* Paste */}
        <div className="flex flex-col gap-3">
          <Textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={3}
            placeholder="Or paste names, one per line or comma separated"
            className="resize-y border-border bg-background"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={!paste.trim()}
              onClick={async () => {
                await addRows(parsePastedNames(paste), false);
                setPaste("");
              }}
            >
              Add these
            </Button>
            <Button
              variant="ghost"
              disabled={!paste.trim()}
              onClick={async () => {
                if (
                  state.winners.length > 0 &&
                  !confirm(
                    "Winners have already been drawn. Replacing the roster is blocked while they exist. Continue anyway?",
                  )
                ) {
                  return;
                }
                await addRows(parsePastedNames(paste), true);
                setPaste("");
              }}
            >
              Replace all
            </Button>
          </div>
        </div>

        {status ? (
          <p className="text-sm text-gold-ui-strong" role="status">
            {status}
          </p>
        ) : null}

        {state.participants.length > 0 ? (
          <>
            <Separator className="bg-muted" />

            <div className="flex flex-col gap-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setLimit(PAGE_SIZE);
                  }}
                  placeholder="Search names"
                  className="border-border bg-background pl-9"
                />
              </div>

              <ScrollArea className="h-80 rounded-xl border border-border">
                {/* Two columns: the roster is the longest list on this page,
                    and one column wastes half the width and doubles the
                    scrolling. Numbered so a row can be called out aloud. */}
                <ol className="grid grid-cols-1 sm:grid-cols-2">
                  {visible.map((p, i) => {
                    const won = state.winnerByParticipant.get(p.id);
                    return (
                      <li
                        key={p.id}
                        className="group flex items-center gap-2 border-b border-border px-3 py-2 text-sm hover:bg-muted/50 sm:odd:border-r"
                      >
                        <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                          {i + 1}
                        </span>
                        <span className="flex-1 truncate text-foreground">
                          {p.name}
                        </span>
                        {won ? (
                          <span className="flex shrink-0 items-center gap-1.5 text-xs text-gold-ui">
                            <Trophy className="size-3.5" />
                            {state.prizesById.get(won.prizeId)?.name ?? "won"}
                          </span>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Remove ${p.name}`}
                            className="shrink-0 text-muted-foreground opacity-0 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                            onClick={() =>
                              commit([
                                {
                                  type: "PARTICIPANT_REMOVED",
                                  participantId: p.id,
                                },
                              ]).catch(() => {})
                            }
                          >
                            <X />
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </ScrollArea>

              {filtered.length > visible.length ? (
                <Button
                  variant="outline"
                  onClick={() => setLimit((n) => n + PAGE_SIZE)}
                >
                  Show more ({filtered.length - visible.length} hidden)
                </Button>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </SectionCard>
  );
}
