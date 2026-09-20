"use client";

import { useEffect, useSyncExternalStore } from "react";
import { getWriterLease } from "@/lib/store/lease";

function subscribe(onChange: () => void) {
  return getWriterLease().subscribe(onChange);
}

/**
 * Claim the right to write from this tab, and report whether we hold it.
 *
 * Any surface that can commit must call this — the store refuses writes from
 * a tab that does not hold the lease. During the show the stage holds it, so
 * the setup window correctly goes read-only rather than editing the roster
 * out from under a running draw.
 */
export function useWriterLease(): boolean {
  useEffect(() => {
    // Acquiring is a side effect on an external system, which is what an
    // effect is for; the ownership flag itself is read through the
    // subscription below rather than mirrored into React state.
    getWriterLease().acquire();
  }, []);

  return useSyncExternalStore(
    subscribe,
    () => getWriterLease().isOwner,
    () => false,
  );
}
