export type PreviewSize = "small" | "medium" | "large";

export const PREVIEW_SIZE_MIN_CARD_WIDTH: Record<PreviewSize, string> = {
  small: "220px",
  medium: "300px",
  large: "380px",
};

export const PREVIEW_SIZE_LABEL: Record<PreviewSize, string> = {
  small: "Small",
  medium: "Medium",
  large: "Large",
};

export const PREVIEW_SIZE_ORDER: PreviewSize[] = ["small", "medium", "large"];

export const PREVIEW_GRID_GAP_CLASS = "gap-6";
