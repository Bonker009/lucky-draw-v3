"use client";

import { useCallback, useEffect, useRef } from "react";
import { assetUrl } from "@/lib/persist/assets";
import { iQuestCompleteSound } from "@/lib/sounds/i-quest-complete";
import { impactMetalHeavy004Sound } from "@/lib/sounds/impact-metal-heavy-004";
import { jinglesSteel07Sound } from "@/lib/sounds/jingles-steel-07";
import type { SoundAsset } from "@/lib/sounds/sound-types";
import { tick001Sound } from "@/lib/sounds/tick-001";

/**
 * Sound for the stage.
 *
 * The effects are soundcn assets (CC0, Kenney), which ship as base64 data URIs
 * inside TypeScript modules — so there is still nothing to fetch, and the
 * stage works from a cold cache with the network unplugged. They are decoded
 * once, up front, into AudioBuffers; playing one is then just a buffer source.
 *
 * soundcn's own `useSound` hook is deliberately not used: it sets React state
 * on every play, and the reel ticks ~20 times a second, which would re-render
 * the whole stage for the length of every spin.
 *
 * A custom win sound uploaded in setup overrides the fanfare. Note what is not
 * here: v2 called load() before every play, which re-fetched and re-decoded
 * the mp3 on each winner.
 */

const SOUNDS = {
  tick: tick001Sound,
  clunk: impactMetalHeavy004Sound,
  fanfare: jinglesSteel07Sound,
  photoCall: iQuestCompleteSound,
} satisfies Record<string, SoundAsset>;

type SoundName = keyof typeof SOUNDS;

/** Ticks closer together than this merge into a buzz, so extras are dropped. */
const MIN_TICK_GAP_S = 0.03;

function decodeDataUri(ctx: AudioContext, dataUri: string) {
  const binary = atob(dataUri.slice(dataUri.indexOf(",") + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return ctx.decodeAudioData(bytes.buffer);
}

export function useSound(options: { enabled: boolean; winAssetId?: string }) {
  const ctxRef = useRef<AudioContext | null>(null);
  const buffersRef = useRef<Partial<Record<SoundName, AudioBuffer>>>({});
  const photoCallRef = useRef<AudioBufferSourceNode | null>(null);
  const lastTickRef = useRef(0);
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

  // Decode everything at mount, not on first play: the first tick of the
  // first spin must not wait on a decode. A suspended context decodes fine.
  useEffect(() => {
    const ctx = context();
    if (!ctx) return;
    for (const [name, asset] of Object.entries(SOUNDS)) {
      decodeDataUri(ctx, asset.dataUri)
        .then((buffer) => {
          buffersRef.current[name as SoundName] = buffer;
        })
        // A sound that fails to decode is silent; it must never break a draw.
        .catch(() => {});
    }
  }, []);

  /** Fire-and-forget playback of a decoded effect. */
  const play = useCallback(
    (name: SoundName, volume: number, playbackRate = 1, when = 0) => {
      if (!enabledRef.current) return null;
      const ctx = context();
      const buffer = buffersRef.current[name];
      if (!ctx || !buffer) return null;
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      source.buffer = buffer;
      source.playbackRate.value = playbackRate;
      gain.gain.value = volume;
      source.connect(gain).connect(ctx.destination);
      source.start(when ? ctx.currentTime + when : 0);
      return source;
    },
    [],
  );

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

  const stopPhotoCall = useCallback(() => {
    try {
      photoCallRef.current?.stop();
    } catch {
      // Already finished.
    }
    photoCallRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      customRef.current?.pause();
      void ctxRef.current?.close().catch(() => {});
      ctxRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!options.enabled) {
      customRef.current?.pause();
      stopPhotoCall();
    }
  }, [options.enabled, stopPhotoCall]);

  /**
   * One name crossing the payline. Called by the reel from its own frame loop,
   * so it must stay cheap and must not touch React state.
   */
  const tick = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    if (ctx.currentTime - lastTickRef.current < MIN_TICK_GAP_S) return;
    lastTickRef.current = ctx.currentTime;
    // A little pitch jitter, so a run of ticks sounds mechanical rather than
    // like one sample on repeat.
    play("tick", 0.35, 0.94 + Math.random() * 0.12);
  }, [play]);

  /** The reel stops with a clunk, then the fanfare. */
  const playWin = useCallback(() => {
    if (!enabledRef.current) return;
    play("clunk", 0.7);

    const custom = customRef.current;
    if (custom) {
      custom.currentTime = 0;
      // Autoplay can be refused before the operator has clicked anything.
      // A missing sound must never interrupt the draw.
      void custom.play().catch(() => {});
      return;
    }
    play("fanfare", 0.8, 1, 0.08);
  }, [play]);

  /** The photo session opening. Stopped if the board closes before it ends. */
  const playPhotoCall = useCallback(() => {
    stopPhotoCall();
    photoCallRef.current = play("photoCall", 0.7);
  }, [play, stopPhotoCall]);

  /** A prize unveiled: the heavy clunk alone — the fanfare is for winners. */
  const playPrize = useCallback(() => {
    if (!enabledRef.current) return;
    play("clunk", 0.6, 0.9);
  }, [play]);

  return { tick, playWin, playPhotoCall, stopPhotoCall, playPrize };
}
