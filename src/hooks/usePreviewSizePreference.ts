import { useCallback, useState } from "react";
import { type PreviewSize } from "../components/previewSizeConfig";

const STORAGE_KEY = "genesis.preview_size";
const DEFAULT_PREVIEW_SIZE: PreviewSize = "medium";
const PREVIEW_SIZE_VALUES: readonly PreviewSize[] = ["small", "medium", "large"] as const;

function isPreviewSize(value: string): value is PreviewSize {
  return (PREVIEW_SIZE_VALUES as readonly string[]).includes(value);
}

function loadInitialPreviewSize(): PreviewSize {
  if (typeof window === "undefined") {
    return DEFAULT_PREVIEW_SIZE;
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULT_PREVIEW_SIZE;
  return isPreviewSize(raw) ? raw : DEFAULT_PREVIEW_SIZE;
}

export function usePreviewSizePreference(): {
  previewSize: PreviewSize;
  setPreviewSize: (next: PreviewSize) => void;
} {
  const [previewSizeState, setPreviewSizeState] = useState<PreviewSize>(loadInitialPreviewSize);

  const setPreviewSize = useCallback((next: PreviewSize) => {
    setPreviewSizeState(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
  }, []);

  return { previewSize: previewSizeState, setPreviewSize };
}
