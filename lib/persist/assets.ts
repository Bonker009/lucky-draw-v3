import { deleteAsset, getAsset, putAsset, type StoredAsset } from "./db";

const MAX_EDGE = 1920;
const WEBP_QUALITY = 0.85;

/** objectURL cache, so re-rendering does not leak a URL per paint. */
const urlCache = new Map<string, string>();

function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Downscale and re-encode an image before it is ever stored.
 *
 * v2 kept 12 MB PNGs and served them with images.unoptimized, so every reveal
 * paid a full-resolution decode on the main thread. Shrinking at the door
 * removes that cost permanently instead of trying to animate around it.
 */
async function normalizeImage(file: File): Promise<Blob> {
  // SVG is not re-encodable here, and an inline SVG is a script vector.
  if (file.type === "image/svg+xml") {
    throw new Error("SVG images are not supported. Use PNG, JPEG or WebP.");
  }

  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas =
      typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(width, height)
        : Object.assign(document.createElement("canvas"), { width, height });

    const ctx = canvas.getContext("2d") as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!ctx) throw new Error("Could not prepare the image for storage.");
    ctx.drawImage(bitmap, 0, 0, width, height);

    if (canvas instanceof OffscreenCanvas) {
      return canvas.convertToBlob({ type: "image/webp", quality: WEBP_QUALITY });
    }
    return new Promise<Blob>((resolve, reject) => {
      (canvas as HTMLCanvasElement).toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error("Image encoding failed.")),
        "image/webp",
        WEBP_QUALITY,
      );
    });
  } finally {
    bitmap.close();
  }
}

export async function storeImage(file: File): Promise<string> {
  const blob = await normalizeImage(file);
  const id = newId();
  await putAsset({ id, kind: "image", blob, name: file.name, at: Date.now() });
  return id;
}

export async function storeAudio(file: File): Promise<string> {
  if (!file.type.startsWith("audio/")) {
    throw new Error("That file is not audio.");
  }
  if (file.size > 8 * 1024 * 1024) {
    throw new Error("Audio must be under 8 MB.");
  }
  const id = newId();
  await putAsset({
    id,
    kind: "audio",
    blob: file,
    name: file.name,
    at: Date.now(),
  });
  return id;
}

export async function assetUrl(id: string | undefined): Promise<string | null> {
  if (!id) return null;
  const cached = urlCache.get(id);
  if (cached) return cached;
  const asset = await getAsset(id);
  if (!asset) return null;
  const url = URL.createObjectURL(asset.blob);
  urlCache.set(id, url);
  return url;
}

export async function removeAsset(id: string): Promise<void> {
  const url = urlCache.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    urlCache.delete(id);
  }
  await deleteAsset(id);
}

export function revokeAllAssetUrls() {
  for (const url of urlCache.values()) URL.revokeObjectURL(url);
  urlCache.clear();
}

export type { StoredAsset };
