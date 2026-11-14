"use client";

import { useRef, useState } from "react";
import { ChevronDown, ChevronUp, Gift, ImagePlus, Plus, Trash2 } from "lucide-react";
import { SectionCard } from "@/components/setup/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { awardedFor, orderedPrizes, remainingFor } from "@/lib/domain/selectors";
import type { Prize } from "@/lib/domain/types";
import { useAssetUrl } from "@/lib/hooks/use-asset-url";
import { storeImage } from "@/lib/persist/assets";
import { useEventStore } from "@/lib/store/event-store";

export function PrizesPanel() {
  const { state, commit } = useEventStore();
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const prizes = orderedPrizes(state);
  const totalSlots = prizes.reduce((sum, p) => sum + p.quantity, 0);

  async function addPrize() {
    if (!name.trim()) return;
    const prize: Prize = {
      // Date.now() alone collides for two prizes added in the same
      // millisecond, and PRIZE_UPSERTED would then overwrite rather than add.
      id: crypto.randomUUID(),
      name: name.trim(),
      quantity: Math.max(1, quantity),
    };
    try {
      await commit([
        { type: "PRIZE_UPSERTED", prize },
        {
          type: "SETTINGS_PATCHED",
          patch: { prizeOrder: [...state.settings.prizeOrder, prize.id] },
        },
      ]);
      setName("");
      setQuantity(1);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add that prize.");
    }
  }

  function move(prizeId: string, delta: number) {
    const order =
      state.settings.prizeOrder.length > 0
        ? [...state.settings.prizeOrder]
        : prizes.map((p) => p.id);
    const from = order.indexOf(prizeId);
    const to = from + delta;
    if (from === -1 || to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to], order[from]];
    commit([
      { type: "SETTINGS_PATCHED", patch: { prizeOrder: order } },
    ]).catch((e) =>
      setError(e instanceof Error ? e.message : "Could not reorder."),
    );
  }

  return (
    <SectionCard
      title="Prizes"
      icon={<Gift className="size-4" />}
      description="Drawn top to bottom when you use Next prize on the stage."
      actions={
        <Badge variant="outline" className="border-border text-foreground/75">
          {totalSlots} slot{totalSlots === 1 ? "" : "s"}
        </Badge>
      }
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-muted/40 p-4">
          <div className="flex min-w-56 flex-1 flex-col gap-1.5">
            <Label htmlFor="prize-name" className="text-foreground/75">
              Prize name
            </Label>
            <Input
              id="prize-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void addPrize();
              }}
              placeholder="Grand prize"
              className="border-border bg-background"
            />
          </div>
          <div className="flex w-24 flex-col gap-1.5">
            <Label htmlFor="prize-qty" className="text-foreground/75">
              How many
            </Label>
            <Input
              id="prize-qty"
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value) || 1)}
              className="border-border bg-background"
            />
          </div>
          <Button size="lg" onClick={addPrize} disabled={!name.trim()}>
            <Plus />
            Add prize
          </Button>
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        {prizes.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              No prizes yet. Add one above to open the stage.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {prizes.map((prize, i) => (
              <PrizeRow
                key={prize.id}
                prize={prize}
                position={i + 1}
                awarded={awardedFor(state, prize.id)}
                remaining={remainingFor(state, prize.id)}
                isFirst={i === 0}
                isLast={i === prizes.length - 1}
                onMove={(delta) => move(prize.id, delta)}
              />
            ))}
          </ul>
        )}
      </div>
    </SectionCard>
  );
}

function PrizeRow({
  prize,
  position,
  awarded,
  remaining,
  isFirst,
  isLast,
  onMove,
}: {
  prize: Prize;
  position: number;
  awarded: number;
  remaining: number;
  isFirst: boolean;
  isLast: boolean;
  onMove: (delta: number) => void;
}) {
  const { commit } = useEventStore();
  const imageUrl = useAssetUrl(prize.imageAssetId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = prize.quantity > 0 ? (awarded / prize.quantity) * 100 : 0;

  return (
    <li className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 transition-colors hover:border-muted-foreground/40">
      {/* Draw order. Explicit, because the stage follows it literally. */}
      <span className="w-5 shrink-0 text-center text-xs tabular-nums text-muted-foreground">
        {position}
      </span>

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setBusy(true);
          setError(null);
          try {
            const imageAssetId = await storeImage(file);
            await commit([
              { type: "PRIZE_UPSERTED", prize: { ...prize, imageAssetId } },
            ]);
          } catch (err) {
            setError(
              err instanceof Error ? err.message : "Could not use that image.",
            );
          } finally {
            setBusy(false);
            e.target.value = "";
          }
        }}
      />

      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        aria-label={`Set image for ${prize.name}`}
        className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-muted text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
      >
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- blob: URL from IndexedDB
          <img src={imageUrl} alt="" className="size-full object-cover" />
        ) : busy ? (
          <span className="text-xs">…</span>
        ) : (
          <ImagePlus className="size-4" />
        )}
      </button>

      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-foreground">{prize.name}</p>
        <p className="text-xs text-muted-foreground">
          {remaining} of {prize.quantity} left
          {awarded > 0 ? ` · ${awarded} awarded` : ""}
        </p>
        {awarded > 0 ? (
          <Progress
            value={done}
            className="mt-2 h-1 bg-muted [&>*]:bg-foreground"
          />
        ) : null}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>

      <Input
        type="number"
        min={awarded || 1}
        value={prize.quantity}
        aria-label={`Quantity for ${prize.name}`}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (!Number.isFinite(next) || next < 1) return;
          commit([
            { type: "PRIZE_UPSERTED", prize: { ...prize, quantity: next } },
          ]).catch((err) =>
            setError(err instanceof Error ? err.message : "Rejected."),
          );
        }}
        className="w-20 border-border bg-background"
      />

      <div className="flex flex-col">
        <Button
          variant="ghost"
          size="icon-xs"
          disabled={isFirst}
          onClick={() => onMove(-1)}
          aria-label={`Move ${prize.name} up`}
        >
          <ChevronUp />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          disabled={isLast}
          onClick={() => onMove(1)}
          aria-label={`Move ${prize.name} down`}
        >
          <ChevronDown />
        </Button>
      </div>

      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Delete ${prize.name}`}
        className="text-muted-foreground hover:text-destructive"
        onClick={() => {
          if (awarded > 0) {
            setError(
              `${prize.name} already has ${awarded} winner(s). Remove them first — deleting the prize would make them eligible again.`,
            );
            return;
          }
          commit([{ type: "PRIZE_REMOVED", prizeId: prize.id }]).catch((err) =>
            setError(
              err instanceof Error ? err.message : "Could not delete that.",
            ),
          );
        }}
      >
        <Trash2 />
      </Button>
    </li>
  );
}
