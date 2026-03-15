import type { ImageModel } from "../types";

export interface GeneratorSubmitInput {
  prompt: string;
  referenceImages: string[];
  aspectRatio: string;
  imageSize: string;
  model: ImageModel;
}

export interface GeneratorSubmitOptions {
  anchorJobId?: string;
  anchorLocalId?: string;
  sourceImageUrl?: string | null;
  sourcePrompt?: string | null;
  onOptimistic?: (info: { localId: string; sourceImageUrl?: string | null }) => void;
}

export interface GeneratorSubmitResult {
  ok: boolean;
  error?: string;
  localId?: string;
  jobId?: string | null;
}

export interface GeneratorSubmitEventDetail {
  input: GeneratorSubmitInput;
  options?: GeneratorSubmitOptions;
  respond?: (result: GeneratorSubmitResult) => void;
}

export const GENERATOR_SUBMIT_EVENT = "genesis:generator-submit";

export function requestGeneratorSubmit(
  input: GeneratorSubmitInput,
  options?: GeneratorSubmitOptions,
): Promise<GeneratorSubmitResult> {
  if (typeof window === "undefined") {
    return Promise.resolve({ ok: false, error: "Generator submission is unavailable" });
  }

  return new Promise((resolve) => {
    window.dispatchEvent(
      new CustomEvent<GeneratorSubmitEventDetail>(GENERATOR_SUBMIT_EVENT, {
        detail: { input, options, respond: resolve },
      }),
    );
  });
}
