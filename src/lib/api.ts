import { supabase } from "./supabase";
import type {
  CommerceGenerateRequest,
  CommercePack,
  CreditTier,
  GenerationJob,
  GenerationRecord,
  ImageModel,
  UserProfile,
} from "../types";
import type { UploadedImageRef } from "./imageUploads";

const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "";
const apiBaseNormalized = apiBase.replace(/\/+$/, "");

function resolveApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  if (path.startsWith("/api/") && apiBaseNormalized) {
    return `${apiBaseNormalized}${path}`;
  }
  return path;
}

async function authHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error("You must be logged in");
  }

  return {
    Authorization: `Bearer ${session.access_token}`,
  };
}

async function apiRequest<T>(
  path: string,
  init?: RequestInit,
  options?: { requireAuth?: boolean },
): Promise<T> {
  const requireAuth = options?.requireAuth ?? true;
  const headers = requireAuth ? await authHeaders() : {};
  const isFormData = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const response = await fetch(resolveApiUrl(path), {
    ...init,
    headers: {
      ...headers,
      ...(!isFormData && init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (
      requireAuth &&
      response.status === 401 &&
      typeof payload?.error === "string" &&
      payload.error.toLowerCase().includes("invalid or expired token")
    ) {
      await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    }
    throw new Error(payload?.error ?? `Request failed with status ${response.status}`);
  }
  return payload as T;
}

export const api = {
  async verifyTurnstile(token: string): Promise<{ success: boolean }> {
    return apiRequest(
      "/api/security/turnstile/verify",
      {
        method: "POST",
        body: JSON.stringify({ token }),
      },
      { requireAuth: false },
    );
  },

  async getMe(): Promise<UserProfile> {
    const data = await apiRequest<{ profile: UserProfile }>("/api/me");
    return data.profile;
  },

  async createGeneration(input: {
    prompt: string;
    referenceImages: string[];
    aspectRatio: string;
    imageSize: string;
    model: ImageModel;
  }, options?: {
    timeoutMs?: number;
  }): Promise<{ jobId: string; status: "queued" }> {
    const timeoutMs = options?.timeoutMs ?? 0;
    const controller = new AbortController();
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            controller.abort();
          }, timeoutMs)
        : null;

    try {
      return await apiRequest("/api/generations", {
        method: "POST",
        body: JSON.stringify(input),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("Create generation request timed out");
      }
      throw error;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  },

  async getGenerationJob(jobId: string): Promise<GenerationJob> {
    const data = await apiRequest<{ job: GenerationJob }>(`/api/generations/jobs/${jobId}`);
    return data.job;
  },

  async listHistory(limit = 20, offset = 0): Promise<{
    items: GenerationRecord[];
    limit: number;
    offset: number;
    hasMore: boolean;
  }> {
    const search = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    });
    return apiRequest(`/api/generations/history?${search.toString()}`);
  },

  async deleteGeneration(jobId: string): Promise<void> {
    await apiRequest(`/api/generations/${jobId}`, { method: "DELETE" });
  },

  async recharge(tier: CreditTier): Promise<{ credits: number; added: number; tier: CreditTier; expiresAt: string | null; validityDays: number; priceCny: number; plan: string }> {
    return apiRequest("/api/credits/recharge", {
      method: "POST",
      body: JSON.stringify({ tier }),
    });
  },

  async generateCommercePack(input: CommerceGenerateRequest): Promise<{ packId: string; pack: CommercePack | null }> {
    return apiRequest("/api/commerce/pack/generate", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  async uploadImages(files: File[]): Promise<UploadedImageRef[]> {
    const maxFileSizeMb = 25;
    const oversized = files.find((file) => file.size > maxFileSizeMb * 1024 * 1024);
    if (oversized) {
      throw new Error(`图片“${oversized.name}”超过 ${maxFileSizeMb}MB，请压缩后再上传`);
    }

    const formData = new FormData();
    files.forEach((file) => {
      formData.append("images", file);
    });
    const data = await apiRequest<{ items: UploadedImageRef[] }>("/api/uploads/images", {
      method: "POST",
      body: formData,
    });
    return data.items;
  },

  async getCommercePack(packId: string): Promise<CommercePack> {
    const data = await apiRequest<{ pack: CommercePack }>(`/api/commerce/pack/${packId}`);
    return data.pack;
  },
};
