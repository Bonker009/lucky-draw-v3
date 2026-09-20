"use client";

import { useEffect, useState } from "react";
import {
  BadgeCheck,
  Copy,
  Dices,
  Lock,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { SectionCard } from "@/components/setup/section-card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { verifyLog } from "@/lib/domain/draw";
import { computeCommitment, generateSeed } from "@/lib/domain/rng";
import { useEventStore } from "@/lib/store/event-store";

/**
 * Publish a commitment before the event; verify the log after it.
 *
 * The commitment covers the seed, the exact roster and the exact prize
 * manifest, so it proves the draw was fixed in advance and that nobody was
 * quietly added, removed or reweighted along the way.
 */
export function FairnessPanel() {
  const { state, log, commit } = useEventStore();
  const [computed, setComputed] = useState<{ key: string; hash: string } | null>(
    null,
  );
  const [verification, setVerification] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const locked = state.winners.length > 0;

  // Identifies exactly the inputs the commitment covers.
  const commitmentKey = `${state.settings.seed}|${state.participants.length}|${state.prizes
    .map((p) => `${p.id}:${p.quantity}`)
    .join(",")}`;

  useEffect(() => {
    if (!state.settings.seed) return;
    let cancelled = false;
    void computeCommitment({
      seed: state.settings.seed,
      participantIds: state.participants.map((p) => p.id),
      prizes: state.prizes,
    }).then((hash) => {
      if (!cancelled) setComputed({ key: commitmentKey, hash });
    });
    return () => {
      cancelled = true;
    };
  }, [commitmentKey, state.settings.seed, state.participants, state.prizes]);

  const commitment =
    computed && computed.key === commitmentKey ? computed.hash : null;

  return (
    <SectionCard
      title="Fairness"
      icon={<ShieldCheck className="size-4" />}
      description="A seeded draw that can be replayed and checked afterwards."
      actions={
        locked ? (
          <Badge variant="outline" className="border-gold-ui/40 text-gold-ui-strong">
            <Lock className="size-3" />
            Seed locked
          </Badge>
        ) : null
      }
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="seed" className="text-foreground/75">
            Seed
          </Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="seed"
              value={state.settings.seed}
              disabled={locked}
              onChange={(e) =>
                commit([
                  { type: "SETTINGS_PATCHED", patch: { seed: e.target.value } },
                ]).catch(() => {})
              }
              placeholder="No seed set"
              className="w-full max-w-md border-border bg-background font-mono text-sm tracking-wide"
            />
            <Button
              variant="outline"
              disabled={locked}
              onClick={() =>
                commit([
                  { type: "SETTINGS_PATCHED", patch: { seed: generateSeed() } },
                ]).catch(() => {})
              }
            >
              <Dices />
              Generate
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {locked
              ? "Locked — the draw has started. Changing it now would invalidate the commitment."
              : "Fix this before the event and announce the commitment below."}
          </p>
        </div>

        {commitment ? (
          <div className="rounded-xl border border-gold-ui/40 bg-card p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="ui-eyebrow text-muted-foreground">
                Commitment
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(commitment);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1800);
                  } catch {
                    // Clipboard can be blocked; the hash is selectable anyway.
                  }
                }}
              >
                <Copy />
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <p className="break-all font-mono text-sm leading-relaxed text-gold-ui-strong">
              {commitment}
            </p>
            <p className="mt-3 text-xs text-muted-foreground">
              Show this before the first draw. It covers the seed,{" "}
              {state.participants.length} participants and {state.prizes.length}{" "}
              prizes.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              Set a seed to produce a commitment.
            </p>
          </div>
        )}

        <div className="flex flex-col gap-3">
          <div>
            <Button
              variant="secondary"
              disabled={state.winners.length === 0}
              onClick={() => {
                const result = verifyLog(log);
                setVerification(
                  result.ok
                    ? {
                        ok: true,
                        message: `Verified. All ${result.checked} winners match the seed exactly.`,
                      }
                    : {
                        ok: false,
                        message: `Mismatch at entry ${result.firstMismatch?.seq}: the log records ${result.firstMismatch?.recorded} where the seed produces ${result.firstMismatch?.expected}.`,
                      },
                );
              }}
            >
              <BadgeCheck />
              Verify the draw
            </Button>
          </div>

          {verification ? (
            <Alert
              variant={verification.ok ? "default" : "destructive"}
              className={
                verification.ok
                  ? "border-gold-ui/30 bg-gold-ui/5 text-gold-ui-strong"
                  : undefined
              }
            >
              {verification.ok ? (
                <BadgeCheck className="size-4" />
              ) : (
                <ShieldAlert className="size-4" />
              )}
              <AlertDescription
                className={verification.ok ? "text-gold-ui-strong" : undefined}
              >
                {verification.message}
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
      </div>
    </SectionCard>
  );
}
