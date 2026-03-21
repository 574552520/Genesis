import type { GenerationLane, ImageModel } from "../types";

export type GeneratorStyleModalItem = {
  id: string;
  url: string;
  prompt?: string;
  model: ImageModel;
  imageSize: string;
  aspectRatio: string;
  referenceImages: string[];
  status?: "submitting" | "queued" | "processing" | "succeeded" | "failed";
  error?: string | null;
  mode?: GenerationLane;
  stableId?: string;
  resolvedId?: string;
};

export function buildGeneratorStyleModalItems<T>(
  items: T[],
  mapItem: (item: T) => GeneratorStyleModalItem | null,
): GeneratorStyleModalItem[] {
  return items.map(mapItem).filter((item): item is GeneratorStyleModalItem => Boolean(item));
}

export function getGeneratorStyleSelectedIndex(
  items: GeneratorStyleModalItem[],
  selectedId: string | null,
): number {
  if (!selectedId) return 0;
  const index = items.findIndex((item) => item.id === selectedId);
  return index >= 0 ? index : 0;
}

export function getGeneratorStyleSelectedItem(
  items: GeneratorStyleModalItem[],
  selectedId: string | null,
): GeneratorStyleModalItem | null {
  if (!selectedId) return null;
  return items.find((item) => item.id === selectedId) ?? null;
}
