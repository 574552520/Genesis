import type { ImageModel } from "../types.js";

const apiDebugLog = process.env.API_DEBUG_LOG !== "0";

function logImageApi(event: string, meta: Record<string, unknown>): void {
  if (!apiDebugLog) return;
  console.log(`[IMG] ${event} ${JSON.stringify(meta)}`);
}

function sanitizeEndpoint(endpoint: string): string {
  return endpoint.replace(/([?&]key=)[^&]+/, "$1***");
}

type InlineDataStyle = "inline_data" | "inlineData";

function buildRequestPayload(params: {
  parts: Array<Record<string, unknown>>;
  aspectRatio: string;
  imageSize: string;
  responseModalities: string[];
}): Record<string, unknown> {
  const parts = params.parts.map((part) => {
    if ("inline_data" in part || "inlineData" in part) {
      return part;
    }
    return part;
  });

  return {
    contents: [
      {
        role: "user",
        parts,
      },
    ],
    generationConfig: {
      responseModalities: params.responseModalities,
      imageConfig: {
        aspectRatio: params.aspectRatio,
        imageSize: params.imageSize,
      },
    },
  };
}

function getModelCandidates(model: ImageModel): string[] {
  const forcedModel = process.env.LINGKE_IMAGE_MODEL?.trim();
  const forcedModelV2 = process.env.LINGKE_IMAGE_MODEL_V2?.trim();
  const forcedModelPro = process.env.LINGKE_IMAGE_MODEL_PRO?.trim();
  const fallbackPrimary = model === "v2"
    ? [forcedModelV2 ?? "gemini-3.1-flash-image-preview"]
    : [forcedModelPro ?? "gemini-3-pro-image-preview"];
  const candidates = new Set<string>();
  if (forcedModel) {
    candidates.add(forcedModel);
  }
  for (const candidate of fallbackPrimary) {
    candidates.add(candidate);
  }
  return Array.from(candidates);
}

function clonePartsForStyle(parts: Array<Record<string, unknown>>, style: InlineDataStyle): Array<Record<string, unknown>> {
  return parts.map((part) => {
    if (style === "inline_data" && "inlineData" in part && part.inlineData && typeof part.inlineData === "object") {
      const inline = part.inlineData as { data?: string; mimeType?: string };
      return {
        inline_data: {
          data: inline.data ?? "",
          mime_type: inline.mimeType ?? "",
        },
      };
    }
    if (style === "inlineData" && "inline_data" in part && part.inline_data && typeof part.inline_data === "object") {
      const inline = part.inline_data as { data?: string; mime_type?: string };
      return {
        inlineData: {
          data: inline.data ?? "",
          mimeType: inline.mime_type ?? "",
        },
      };
    }
    return part;
  });
}

export async function generateImageBuffer(params: {
  prompt: string;
  referenceImages: string[];
  aspectRatio: string;
  imageSize: string;
  model: ImageModel;
  lane?: string;
}): Promise<{ buffer: Buffer; mimeType: string }> {
  const lingkeApiBaseUrl = process.env.LINGKE_API_BASE_URL ?? "https://lingkeapi.com";
  const lingkeApiKey = process.env.LINGKE_API_KEY ?? process.env.GEMINI_API_KEY;
  const lingkeBearerToken = process.env.LINGKE_BEARER_TOKEN ?? lingkeApiKey;

  if (!lingkeApiKey) {
    throw new Error("Missing LINGKE_API_KEY");
  }

  const parts: Array<Record<string, unknown>> = [];

  for (const img of params.referenceImages) {
    const [header, data] = img.split(",");
    if (!header || !data || !header.startsWith("data:")) {
      continue;
    }
    const mimeType = header.split(";")[0].replace("data:", "");
    parts.push({
      inline_data: {
        data,
        mime_type: mimeType,
      },
    });
  }

  const trimmedPrompt = params.prompt.trim();
  const finalPrompt = trimmedPrompt
    ? trimmedPrompt
    : params.referenceImages.length > 0
      ? "Generate an image based on the provided reference images."
      : "Generate a high quality image.";
  parts.push({ text: finalPrompt });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (lingkeBearerToken) {
    headers.Authorization = `Bearer ${lingkeBearerToken}`;
  }

  const modelCandidates = getModelCandidates(params.model);
  const inlineStyles: InlineDataStyle[] = ["inline_data", "inlineData"];
  const modalityCandidates = [["TEXT", "IMAGE"], ["IMAGE"]];
  const baseEndpoint = `${lingkeApiBaseUrl.replace(/\/$/, "")}/v1beta/models`;
  const startedAt = Date.now();
  let lastError: Error = new Error("Lingke image generation failed");

  for (const modelName of modelCandidates) {
    for (const inlineStyle of inlineStyles) {
      for (const responseModalities of modalityCandidates) {
        const convertedParts = clonePartsForStyle(parts, inlineStyle);
        const requestBody = buildRequestPayload({
          parts: convertedParts,
          aspectRatio: params.aspectRatio,
          imageSize: params.imageSize,
          responseModalities,
        });
        const endpoint = `${baseEndpoint}/${modelName}:generateContent?key=${encodeURIComponent(lingkeApiKey)}`;

        logImageApi("request.start", {
          endpoint: sanitizeEndpoint(endpoint),
          mode: params.lane ?? "unknown",
          modelName,
          inlineDataStyle: inlineStyle,
          imageSize: params.imageSize,
          aspectRatio: params.aspectRatio,
          referenceImages: params.referenceImages.length,
          promptLen: finalPrompt.length,
          responseModalities,
        });

        let response: Response;
        try {
          response = await fetch(endpoint, {
            method: "POST",
            headers,
            body: JSON.stringify(requestBody),
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logImageApi("request.network_error", {
            endpoint: sanitizeEndpoint(endpoint),
            modelName,
            inlineDataStyle: inlineStyle,
            elapsedMs: Date.now() - startedAt,
            message,
          });
          lastError = new Error(message);
          continue;
        }

        if (!response.ok) {
          const detail = await response.text();
          logImageApi("request.http_error", {
            endpoint: sanitizeEndpoint(endpoint),
            modelName,
            inlineDataStyle: inlineStyle,
            status: response.status,
            elapsedMs: Date.now() - startedAt,
            responseModalities,
            detail: detail.slice(0, 200),
          });
          lastError = new Error(`Lingke image generation failed (${response.status}): ${detail.slice(0, 400)}`);
          if (response.status === 429 || response.status >= 500) {
            continue;
          }
          continue;
        }

        const payload = (await response.json()) as {
          candidates?: Array<{
            content?: {
              parts?: Array<{
                inlineData?: { data?: string; mimeType?: string };
                inline_data?: { data?: string; mime_type?: string };
              }>;
            };
          }>;
        };

        for (const part of payload.candidates?.[0]?.content?.parts || []) {
          const base64 = part.inlineData?.data ?? part.inline_data?.data;
          const mimeType = part.inlineData?.mimeType ?? part.inline_data?.mime_type;
          if (base64 && mimeType) {
            logImageApi("request.success", {
              endpoint: sanitizeEndpoint(endpoint),
              modelName,
              inlineDataStyle: inlineStyle,
              status: response.status,
              elapsedMs: Date.now() - startedAt,
              responseModalities,
              mimeType,
            });
            return {
              buffer: Buffer.from(base64, "base64"),
              mimeType,
            };
          }
        }

        logImageApi("request.no_image", {
          endpoint: sanitizeEndpoint(endpoint),
          modelName,
          inlineDataStyle: inlineStyle,
          status: response.status,
          elapsedMs: Date.now() - startedAt,
          responseModalities,
        });
        lastError = new Error(`Lingke image generation succeeded but no image returned (${modelName})`);
      }
    }
  }

  throw lastError;
}
