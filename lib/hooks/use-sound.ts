"use client";

import { useCallback, useEffect, useRef } from "react";
import { assetUrl } from "@/lib/persist/assets";

/**
 * Sound for the stage.
 *
 * The defaults are synthesised with WebAudio rather than shipped as files, so
 * the app has no audio assets to fetch and works from a cold cache with the
 * network unplugged. A custom win sound uploaded in setup overrides the
 * synthesised sting.
 *
 * Note what is not here: v2 called load() before every play, which re-fetched
 * and re-decoded the mp3 on each winner.
 */
export function useSound(options: { enabled: boolean; winAssetId?: string }) {
  const ctxRef = useRef<AudioContext | null>(null);
  const bedRef = useRef<{ stop: () => void } | null>(null);
  const customRef = useRef<HTMLAudioElement | null>(null);
  const enabledRef = useRef(options.enabled);

  useEffect(() => {
    enabledRef.current = options.enabled;
  }, [options.enabled]);

  function context(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!ctxRef.current) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return null;
      ctxRef.current = new Ctor();
    }
    // Browsers suspend the context until a gesture; resuming is harmless.
    void ctxRef.current.resume().catch(() => {});
    return ctxRef.current;
  }

  // Load a custom win sound, if one was uploaded.
  useEffect(() => {
    let cancelled = false;
    if (!options.winAssetId) {
      customRef.current?.pause();
      customRef.current = null;
      return;
    }
    void assetUrl(options.winAssetId).then((url) => {
      if (cancelled || !url) return;
      const el = new Audio(url);
      el.preload = "auto";
      customRef.current = el;
    });
    return () => {
      cancelled = true;
    };
  }, [options.winAssetId]);

  const stopBed = useCallback(() => {
    bedRef.current?.stop();
    bedRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      bedRef.current?.stop();
      customRef.current?.pause();
      void ctxRef.current?.close().catch(() => {});
      ctxRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!options.enabled) {
      bedRef.current?.stop();
      bedRef.current = null;
      customRef.current?.pause();
    }
  }, [options.enabled]);

  /** A rising two-note sting. */
  const playWin = useCallback(() => {
    if (!enabledRef.current) return;

    const custom = customRef.current;
    if (custom) {
      custom.currentTime = 0;
      // Autoplay can be refused before the operator has clicked anything.
      // A missing sound must never interrupt the draw.
      void custom.play().catch(() => {});
      return;
    }

    const ctx = context();
    if (!ctx) return;

    const now = ctx.currentTime;
    for (const [i, freq] of [523.25, 659.25, 783.99, 1046.5].entries()) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      const start = now + i * 0.09;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.22, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.65);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.7);
    }
  }, []);

  /** A low pulsing bed while the reel spins. */
  const startBed = useCallback(() => {
    if (!enabledRef.current || bedRef.current) return;
    const ctx = context();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    const gain = ctx.createGain();

    osc.type = "sawtooth";
    osc.frequency.value = 82;
    lfo.frequency.value = 6.5;
    lfoGain.gain.value = 0.045;
    gain.gain.value = 0.05;

    lfo.connect(lfoGain).connect(gain.gain);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    lfo.start();

    bedRef.current = {
      stop: () => {
        const t = ctx.currentTime;
        gain.gain.cancelScheduledValues(t);
        gain.gain.setValueAtTime(gain.gain.value, t);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
        osc.stop(t + 0.25);
        lfo.stop(t + 0.25);
      },
    };
  }, []);

  return { playWin, startBed, stopBed };
}
