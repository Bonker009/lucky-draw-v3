"use client";

import { useSyncExternalStore } from "react";
import { getEngine, type EngineSnapshot } from "./draw-engine";

const SERVER_SNAPSHOT: EngineSnapshot = {
  phase: "idle",
  prizeId: null,
  revealed: null,
  target: null,
  pending: 0,
  batch: [],
  error: null,
};

/**
 * Subscribe React to the engine. The engine owns the draw; React only paints
 * what it reports, which is why a re-render can never disturb a running draw.
 */
export function useEngineSnapshot(): EngineSnapshot {
  const engine = getEngine();
  return useSyncExternalStore(
    engine.subscribe,
    engine.getSnapshot,
    () => SERVER_SNAPSHOT,
  );
}
