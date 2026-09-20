"use client";

import { useEffect, useState } from "react";
import { assetUrl } from "@/lib/persist/assets";

/**
 * Resolve an IndexedDB asset id to a blob: URL, cached across components.
 *
 * The resolved id is stored alongside the URL so a change of id reads as null
 * during render, rather than needing an effect to clear stale state — which
 * would show the previous prize's image for a frame.
 */
export function useAssetUrl(id: string | undefined): string | null {
  const [resolved, setResolved] = useState<{
    id: string | undefined;
    url: string | null;
  }>({ id: undefined, url: null });

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void assetUrl(id).then((url) => {
      if (!cancelled) setResolved({ id, url });
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return id && resolved.id === id ? resolved.url : null;
}
