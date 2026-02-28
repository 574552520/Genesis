import { createClient } from "@supabase/supabase-js";
import type { GenerationJobRow, ImageModel, UserProfile } from "../types.js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function parseJwtRole(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as {
      role?: string;
    };
    return payload.role ?? null;
  } catch {
    return null;
  }
}

if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
  throw new Error(
    "Missing SUPABASE_URL, SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY",
  );
}

const serviceRole = parseJwtRole(supabaseServiceRoleKey);
if (serviceRole && serviceRole !== "service_role") {
  throw new Error(
    `SUPABASE_SERVICE_ROLE_KEY is invalid for admin usage (detected role: ${serviceRole}). ` +
      "Use the service_role (or secret server) key from Supabase Settings -> API.",
  );
}

export const authClient = createClient(supabaseUrl, supabaseAnonKey);

export const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export const generationCost = Number(process.env.GENERATION_COST ?? 50);
export const storageBucket = process.env.SUPABASE_STORAGE_BUCKET ?? "generated-images";

function mapProfile(row: any): UserProfile {
  return {
    userId: row.user_id,
    email: row.email,
    credits: row.credits,
    createdAt: row.created_at,
  };
}

export async function getProfile(userId: string, email?: string | null): Promise<UserProfile> {
  const { data, error } = await adminClient
    .from("profiles")
    .select("user_id,email,credits,created_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error?.message ?? "Profile not found");
  }

  if (data) {
    return mapProfile(data);
  }

  const fallbackEmail = email ?? "unknown@example.com";
  const { error: upsertError } = await adminClient
    .from("profiles")
    .upsert({ user_id: userId, email: fallbackEmail }, { onConflict: "user_id" });

  if (upsertError) {
    throw new Error(upsertError.message);
  }

  const { data: created, error: createdError } = await adminClient
    .from("profiles")
    .select("user_id,email,credits,created_at")
    .eq("user_id", userId)
    .single();

  if (createdError || !created) {
    throw new Error(createdError?.message ?? "Profile not found");
  }

  return mapProfile(created);
}

export async function createGenerationJobAtomic(params: {
  userId: string;
  prompt: string;
  aspectRatio: string;
  imageSize: string;
  model: ImageModel;
}): Promise<string> {
  const { data, error } = await adminClient.rpc("create_generation_job", {
    p_user_id: params.userId,
    p_prompt: params.prompt,
    p_aspect_ratio: params.aspectRatio,
    p_image_size: params.imageSize,
    p_model: params.model,
    p_cost: generationCost,
  });

  if (error) {
    throw new Error(error.message);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.job_id) {
    throw new Error("Failed to create generation job");
  }

  return row.job_id as string;
}

export async function setJobProcessing(jobId: string): Promise<void> {
  const { error } = await adminClient
    .from("generation_jobs")
    .update({ status: "processing", started_at: new Date().toISOString() })
    .eq("id", jobId)
    .eq("status", "queued");

  if (error) {
    throw new Error(error.message);
  }
}

export async function setJobSucceeded(jobId: string, imagePath: string): Promise<void> {
  const { error } = await adminClient
    .from("generation_jobs")
    .update({
      status: "succeeded",
      result_image_path: imagePath,
      error: null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function setJobFailedAndRefund(jobId: string, errorMessage: string): Promise<void> {
  const { error } = await adminClient.rpc("fail_generation_job_and_refund", {
    p_job_id: jobId,
    p_error: errorMessage,
    p_refund_amount: generationCost,
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function getJobByIdForUser(
  userId: string,
  jobId: string,
): Promise<GenerationJobRow | null> {
  const { data, error } = await adminClient
    .from("generation_jobs")
    .select("*")
    .eq("id", jobId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as GenerationJobRow | null) ?? null;
}

export async function listJobsForUser(params: {
  userId: string;
  limit: number;
  offset: number;
}): Promise<GenerationJobRow[]> {
  const { data, error } = await adminClient
    .from("generation_jobs")
    .select("*")
    .eq("user_id", params.userId)
    .order("created_at", { ascending: false })
    .range(params.offset, params.offset + params.limit - 1);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as GenerationJobRow[];
}

export async function deleteJobForUser(params: {
  userId: string;
  jobId: string;
}): Promise<{ deleted: boolean; imagePath: string | null }> {
  const existing = await getJobByIdForUser(params.userId, params.jobId);
  if (!existing) {
    return { deleted: false, imagePath: null };
  }

  const { error } = await adminClient
    .from("generation_jobs")
    .delete()
    .eq("id", params.jobId)
    .eq("user_id", params.userId);

  if (error) {
    throw new Error(error.message);
  }

  return { deleted: true, imagePath: existing.result_image_path };
}

export async function rechargeCredits(params: {
  userId: string;
  tier: "standard" | "pro" | "enterprise";
  amount: number;
}): Promise<number> {
  const { data, error } = await adminClient.rpc("recharge_credits", {
    p_user_id: params.userId,
    p_delta: params.amount,
    p_reason: "recharge_simulated",
    p_meta: { tier: params.tier },
  });

  if (error) {
    throw new Error(error.message);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (row?.credits === undefined || row?.credits === null) {
    throw new Error("Failed to recharge credits");
  }

  return row.credits as number;
}

export async function createSignedImageUrl(path: string): Promise<string> {
  const { data, error } = await adminClient.storage
    .from(storageBucket)
    .createSignedUrl(path, 60 * 60);

  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? "Failed to create signed URL");
  }

  return data.signedUrl;
}
