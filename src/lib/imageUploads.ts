import type { UploadedImageAsset } from "../types";

export const MAX_UPLOADED_IMAGE_COUNT = 6;

export type ImagePreviewMap = Record<string, string>;

export function dedupeImageRefs(values: string[], max = MAX_UPLOADED_IMAGE_COUNT): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const next = value.trim();
    if (!next || seen.has(next)) continue;
    seen.add(next);
    result.push(next);
    if (result.length >= max) break;
  }
  return result;
}

export function isStorageImageRef(value: string): boolean {
  return value.startsWith("storage://");
}

export function resolveImagePreviewUrl(value: string | null | undefined, previewMap: ImagePreviewMap): string | null {
  if (!value) return null;
  if (previewMap[value]) return previewMap[value];
  if (isStorageImageRef(value)) return null;
  return value;
}

export function buildPreviewMapFromUploads(images: UploadedImageAsset[]): ImagePreviewMap {
  return images.reduce<ImagePreviewMap>((acc, image) => {
    acc[image.ref] = image.previewUrl;
    return acc;
  }, {});
}
