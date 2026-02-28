import { supabase } from "./supabase";
import type { CreditTier, GenerationJob, GenerationRecord, ImageModel, UserProfile } from "../types";

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

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = await authHeaders();
  const response = await fetch(resolveApiUrl(path), {
    ...init,
    headers: {
      ...headers,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error ?? `Request failed with status ${response.status}`);
  }
  return payload as T;
}

export const api = {
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

  async recharge(tier: CreditTier): Promise<{ credits: number; added: number; tier: CreditTier }> {
    return apiRequest("/api/credits/recharge", {
      method: "POST",
      body: JSON.stringify({ tier }),
    });
  },
};
