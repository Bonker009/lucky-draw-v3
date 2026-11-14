"use client";

import { useRef, useState, type ReactNode } from "react";
import { Image as ImageIcon, SlidersHorizontal, Volume2 } from "lucide-react";
import { SectionCard } from "@/components/setup/section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useAssetUrl } from "@/lib/hooks/use-asset-url";
import { storeAudio, storeImage } from "@/lib/persist/assets";
import { useEventStore } from "@/lib/store/event-store";

export function PresentationPanel() {
  const { state, commit } = useEventStore();
  const settings = state.settings;
  const backgroundUrl = useAssetUrl(settings.backgroundAssetId);
  const bgRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const patch = (p: Partial<typeof settings>) =>
    commit([{ type: "SETTINGS_PATCHED", patch: p }]).catch(() => {});

  return (
    <SectionCard
      title="Presentation"
      icon={<SlidersHorizontal className="size-4" />}
      description="How the stage looks and sounds. Images are downscaled and re-encoded on upload."
    >
      <div className="flex flex-col gap-7">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="event-name" className="text-foreground/75">
            Event name
          </Label>
          <Input
            id="event-name"
            value={settings.eventName}
            onChange={(e) => patch({ eventName: e.target.value })}
            className="max-w-sm border-border bg-background"
          />
        </div>

        <Separator className="bg-muted" />

        {/* Timing. Sliders show the value in the label, because the operator
            sets these against a run-of-show measured in seconds. */}
        <div className="grid gap-7 sm:grid-cols-2">
          <TimingSlider
            id="spin-duration"
            label="Draw duration"
            value={settings.spinDurationMs}
            min={1500}
            max={12000}
            step={250}
            onChange={(spinDurationMs) => patch({ spinDurationMs })}
          />
          <TimingSlider
            id="reveal-hold"
            label="Hold each winner on screen"
            value={settings.revealHoldMs}
            min={800}
            max={8000}
            step={100}
            onChange={(revealHoldMs) => patch({ revealHoldMs })}
          />
        </div>

        <Separator className="bg-muted" />

        <div className="flex flex-col gap-1">
          <ToggleRow
            id="sound"
            label="Sound effects"
            hint="A tick on every knock-out round, plus a hit on each reveal."
            checked={settings.soundEnabled}
            onChange={(soundEnabled) => patch({ soundEnabled })}
          />
          <ToggleRow
            id="suspense"
            label="Stretch the final spins for suspense"
            hint="The last few winners of a prize spin longer."
            checked={settings.suspenseScaling}
            onChange={(suspenseScaling) => patch({ suspenseScaling })}
          />
          <ToggleRow
            id="reduced-motion"
            label="Force reduced motion"
            hint="Short spins, no drift, no motion blur. Overrides the OS setting."
            checked={settings.reducedMotionOverride}
            onChange={(reducedMotionOverride) =>
              patch({ reducedMotionOverride })
            }
          />
        </div>

        <Separator className="bg-muted" />

        <div className="grid gap-4 sm:grid-cols-2">
          {/* Background image */}
          <AssetRow
            icon={<ImageIcon className="size-4" />}
            label="Stage background"
            preview={
              backgroundUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- blob: URL from IndexedDB
                <img
                  src={backgroundUrl}
                  alt=""
                  className="h-12 w-20 rounded-lg border border-border object-cover"
                />
              ) : null
            }
            set={!!settings.backgroundAssetId}
            onPick={() => bgRef.current?.click()}
            onClear={() => patch({ backgroundAssetId: undefined })}
            clearLabel="Clear"
          >
            <input
              ref={bgRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  patch({ backgroundAssetId: await storeImage(file) });
                  setError(null);
                } catch (err) {
                  setError(
                    err instanceof Error ? err.message : "Could not use that.",
                  );
                } finally {
                  e.target.value = "";
                }
              }}
            />
          </AssetRow>

          {/* Win sound */}
          <AssetRow
            icon={<Volume2 className="size-4" />}
            label="Win sound"
            set={!!settings.winAudioAssetId}
            onPick={() => audioRef.current?.click()}
            onClear={() => patch({ winAudioAssetId: undefined })}
            clearLabel="Use default"
          >
            <input
              ref={audioRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  patch({ winAudioAssetId: await storeAudio(file) });
                  setError(null);
                } catch (err) {
                  setError(
                    err instanceof Error ? err.message : "Could not use that.",
                  );
                } finally {
                  e.target.value = "";
                }
              }}
            />
          </AssetRow>
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
    </SectionCard>
  );
}

function TimingSlider({
  id,
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <Label htmlFor={id} className="text-foreground/75">
          {label}
        </Label>
        <span className="font-mono text-sm tabular-nums text-foreground">
          {(value / 1000).toFixed(1)}s
        </span>
      </div>
      <Slider
        id={id}
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([next]) => onChange(next)}
      />
    </div>
  );
}

function ToggleRow({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-6 rounded-lg px-1 py-3">
      <div className="min-w-0">
        <Label htmlFor={id} className="text-foreground">
          {label}
        </Label>
        {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        className="mt-0.5 shrink-0"
      />
    </div>
  );
}

function AssetRow({
  icon,
  label,
  preview,
  set,
  onPick,
  onClear,
  clearLabel,
  children,
}: {
  icon: ReactNode;
  label: string;
  preview?: ReactNode;
  set: boolean;
  onPick: () => void;
  onClear: () => void;
  clearLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 p-3">
      {children}
      {preview ?? (
        <span className="grid size-12 shrink-0 place-items-center rounded-lg border border-border bg-muted text-muted-foreground">
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{set ? "Custom" : "Default"}</p>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button variant="outline" size="sm" onClick={onPick}>
          {set ? "Change" : "Upload"}
        </Button>
        {set ? (
          <Button variant="ghost" size="sm" onClick={onClear}>
            {clearLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
