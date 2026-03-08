import { createClient } from "@supabase/supabase-js";
import type {
  CommerceMode,
  CommerceModuleInput,
  CommercePack,
  CommercePackItemRow,
  CommercePackRow,
  CommercePlatform,
  CommerceTemplateType,
  FlatlayInput,
  CopyBlock,
  GenerationJobRow,
  GenerationLane,
  InvisibleMannequinInput,
  LaunchPackInput,
  LookbookInput,
  ImageTaskSpec,
  ImageModel,
  QualityWarning,
  TryOnInput,
  UserProfile,
} from "../types.js";

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

export const storageBucket = process.env.SUPABASE_STORAGE_BUCKET ?? "generated-images";

const generationCostByModelAndSize: Record<ImageModel, Record<string, number>> = {
  v2: { "1K": 70, "2K": 80, "4K": 130 },
  pro: { "1K": 90, "2K": 100, "4K": 160 },
};

export function getGenerationCost(model: ImageModel, imageSize: string): number {
  return generationCostByModelAndSize[model]?.[imageSize] ?? generationCostByModelAndSize[model]["1K"];
}

function mapProfile(row: any): UserProfile {
  return {
    userId: row.user_id,
    email: row.email,
    credits: row.credits,
    creditsExpiresAt: row.credits_expires_at,
    createdAt: row.created_at,
  };
}

export async function getProfile(userId: string, email?: string | null): Promise<UserProfile> {
  const { data, error } = await adminClient
    .from("profiles")
    .select("user_id,email,credits,credits_expires_at,created_at")
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
    .select("user_id,email,credits,credits_expires_at,created_at")
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
  lane: GenerationLane;
}): Promise<string> {
  const { data, error } = await adminClient.rpc("create_generation_job", {
    p_user_id: params.userId,
    p_prompt: params.prompt,
    p_aspect_ratio: params.aspectRatio,
    p_image_size: params.imageSize,
    p_model: params.model,
    p_lane: params.lane,
    p_cost: getGenerationCost(params.model, params.imageSize),
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
  const { data: job, error: loadError } = await adminClient
    .from("generation_jobs")
    .select("model,image_size")
    .eq("id", jobId)
    .maybeSingle();

  if (loadError) {
    throw new Error(loadError.message);
  }

  const model = (job?.model === "pro" ? "pro" : "v2") as ImageModel;
  const refundAmount = getGenerationCost(model, job?.image_size ?? "1K");

  const { error } = await adminClient.rpc("fail_generation_job_and_refund", {
    p_job_id: jobId,
    p_error: errorMessage,
    p_refund_amount: refundAmount,
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
  expiresAt: string;
}): Promise<{ credits: number; creditsExpiresAt: string | null }> {
  const { data, error } = await adminClient.rpc("recharge_credits", {
    p_user_id: params.userId,
    p_delta: params.amount,
    p_reason: "recharge_simulated",
    p_meta: { tier: params.tier },
    p_expires_at: params.expiresAt,
  });

  if (error) {
    throw new Error(error.message);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (row?.credits === undefined || row?.credits === null) {
    throw new Error("Failed to recharge credits");
  }

  return {
    credits: row.credits as number,
    creditsExpiresAt: (row.credits_expires_at as string | null | undefined) ?? null,
  };
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

export async function createCommercePack(params: {
  userId: string;
  platform: CommercePlatform;
  mode: CommerceMode;
  templateType: CommerceTemplateType;
  input: CommerceModuleInput;
}): Promise<string> {
  const { data, error } = await adminClient
    .from("commerce_packs")
    .insert({
      user_id: params.userId,
      platform: params.platform,
      mode: params.mode,
      template_type: params.templateType,
      status: "processing",
      input: params.input,
      copy_blocks: [],
      title_candidates: [],
      keywords: [],
      quality_warnings: [],
    })
    .select("id")
    .single();

  if (error || !data?.id) {
    throw new Error(error?.message ?? "Failed to create commerce pack");
  }

  return data.id as string;
}

export async function setCommercePackFailed(params: {
  packId: string;
  error: string;
}): Promise<void> {
  const { error } = await adminClient
    .from("commerce_packs")
    .update({
      status: "failed",
      error: params.error.slice(0, 1200),
    })
    .eq("id", params.packId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function setCommercePackReady(params: {
  packId: string;
  copyBlocks: CopyBlock[];
  titleCandidates: string[];
  keywords: string[];
  qualityWarnings: QualityWarning[];
}): Promise<void> {
  const { error } = await adminClient
    .from("commerce_packs")
    .update({
      status: "ready",
      error: null,
      copy_blocks: params.copyBlocks,
      title_candidates: params.titleCandidates,
      keywords: params.keywords,
      quality_warnings: params.qualityWarnings,
    })
    .eq("id", params.packId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function insertCommercePackItems(params: {
  packId: string;
  imageTasks: Array<{
    title: string;
    prompt: string;
    aspectRatio: string;
    imageSize: string;
    model: ImageModel;
    jobId: string | null;
  }>;
}): Promise<void> {
  if (params.imageTasks.length === 0) return;

  const payload = params.imageTasks.map((task) => ({
    pack_id: params.packId,
    item_type: "image_task",
    title: task.title,
    prompt: task.prompt,
    aspect_ratio: task.aspectRatio,
    image_size: task.imageSize,
    model: task.model,
    job_id: task.jobId,
  }));

  const { error } = await adminClient.from("commerce_pack_items").insert(payload);
  if (error) {
    throw new Error(error.message);
  }
}

function mapCommercePackRow(row: CommercePackRow): CommercePack {
  return {
    id: row.id,
    userId: row.user_id,
    platform: row.platform,
    mode: row.mode ?? "launch_pack",
    templateType: row.template_type,
    status: row.status,
    input: row.input,
    copyBlocks: Array.isArray(row.copy_blocks) ? row.copy_blocks : [],
    titleCandidates: Array.isArray(row.title_candidates) ? row.title_candidates : [],
    keywords: Array.isArray(row.keywords) ? row.keywords : [],
    qualityWarnings: Array.isArray(row.quality_warnings) ? row.quality_warnings : [],
    imageTasks: [],
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getCommercePackByIdForUser(params: {
  userId: string;
  packId: string;
}): Promise<CommercePack | null> {
  const syncWarnings: QualityWarning[] = [];
  const addPackWarning = (code: string, message: string): void => {
    syncWarnings.push({ code, message, severity: "warning" });
    console.warn("Commerce pack fetch warning", {
      packId: params.packId,
      code,
      message,
    });
  };

  const { data: packData, error: packError } = await adminClient
    .from("commerce_packs")
    .select("*")
    .eq("id", params.packId)
    .eq("user_id", params.userId)
    .maybeSingle();

  if (packError) {
    throw new Error(packError.message);
  }
  if (!packData) {
    return null;
  }

  let items: CommercePackItemRow[] = [];
  try {
    const { data: itemData, error: itemError } = await adminClient
      .from("commerce_pack_items")
      .select("*")
      .eq("pack_id", params.packId)
      .order("id", { ascending: true });

    if (itemError) {
      addPackWarning("items_query_failed", itemError.message);
    } else {
      items = (itemData ?? []) as CommercePackItemRow[];
      console.log("Commerce pack items context", {
        packId: params.packId,
        itemsLength: items.length,
      });
    }
  } catch (error) {
    addPackWarning("items_query_exception", error instanceof Error ? error.message : "Unknown items query error");
  }

  const jobIds = items.map((item) => item.job_id).filter((id): id is string => typeof id === "string");
  if (jobIds.length > 0) {
    console.log("Commerce pack context", {
      packId: params.packId,
      itemsLength: items.length,
      jobIdsLength: jobIds.length,
    });
  }

  const jobsById = new Map<string, GenerationJobRow>();
  if (jobIds.length > 0) {
    try {
      const { data: jobs, error: jobsError } = await adminClient
        .from("generation_jobs")
        .select("*")
        .in("id", jobIds)
        .eq("user_id", params.userId);

      if (jobsError) {
        addPackWarning("jobs_query_failed", jobsError.message);
      } else {
        (jobs ?? []).forEach((job) => {
          jobsById.set((job as GenerationJobRow).id, job as GenerationJobRow);
        });
        console.log("Commerce pack jobs context", {
          packId: params.packId,
          jobsLength: jobs?.length ?? 0,
          jobsWithImagePath: (jobs ?? []).filter((job) => Boolean((job as GenerationJobRow).result_image_path)).length,
        });
      }
    } catch (error) {
      addPackWarning("jobs_query_exception", error instanceof Error ? error.message : "Unknown jobs query error");
    }
  }

  const mapped = mapCommercePackRow(packData as CommercePackRow);
  const seenWarningKeys = new Set(mapped.qualityWarnings.map((warning) => `${warning.code}:${warning.message}`));
  for (const warning of syncWarnings) {
    const key = `${warning.code}:${warning.message}`;
    if (!seenWarningKeys.has(key)) {
      mapped.qualityWarnings.push(warning);
      seenWarningKeys.add(key);
    }
  }

  let signedUrlFailureCount = 0;
  const imageTasks: ImageTaskSpec[] = await Promise.all(
    items.map(async (item, idx) => {
      const job = item.job_id ? jobsById.get(item.job_id) : null;
      let imageUrl: string | null = null;
      if (job?.result_image_path) {
        try {
          imageUrl = await createSignedImageUrl(job.result_image_path);
        } catch {
          signedUrlFailureCount += 1;
          addPackWarning("signed_url_failed", `Task ${item.id} image URL generation failed`);
          imageUrl = null;
        }
      }

      const itemReferenceImages =
        "reference_images" in item && Array.isArray((item as { reference_images?: unknown }).reference_images)
          ? (item as { reference_images?: string[] }).reference_images ?? []
          : inferReferenceImagesFromPackItem({
              mode: mapped.mode,
              input: mapped.input,
              item,
              itemIndex: idx,
            });

      return {
        id: `${item.id}`,
        title: item.title || `图片任务 ${idx + 1}`,
        prompt: item.prompt,
        aspectRatio: item.aspect_ratio,
        imageSize: item.image_size,
        model: item.model,
        status: job?.status ?? "queued",
        imageUrl,
        error: job?.error ?? null,
        jobId: item.job_id,
        referenceImages: dedupeTrimmed(itemReferenceImages),
      };
    }),
  );

  console.log("Commerce pack assembled", {
    packId: params.packId,
    itemsLength: items.length,
    jobIdsLength: jobIds.length,
    jobsLength: jobsById.size,
    jobsWithImagePath: Array.from(jobsById.values()).filter((job) => Boolean(job.result_image_path)).length,
    signedUrlFailureCount,
    warningsLength: mapped.qualityWarnings.length,
  });

  mapped.imageTasks = imageTasks;
  return mapped;
}

function inferReferenceImagesFromPackItem(params: {
  mode: CommerceMode;
  input: CommerceModuleInput;
  item: CommercePackItemRow;
  itemIndex: number;
}): string[] {
  if (params.mode === "launch_pack") {
    return dedupeTrimmed((params.input as unknown as LaunchPackInput).referenceImages);
  }

  if (params.mode === "lookbook") {
    const baseModelImage = (params.input as unknown as LookbookInput).baseModelImage;
    return baseModelImage ? [baseModelImage] : [];
  }

  if (params.mode === "flatlay" || params.mode === "invisible_mannequin_3d") {
    const flatInput = params.input as unknown as FlatlayInput | InvisibleMannequinInput;
    const title = params.item.title.toLowerCase();
    const sideImage = title.includes("front") ? flatInput.frontImage : title.includes("back") ? flatInput.backImage : null;
    return dedupeTrimmed(sideImage ? [sideImage, ...(flatInput.referenceImages ?? [])] : flatInput.referenceImages ?? []);
  }

  if (params.mode === "try_on") {
    const tryOn = params.input as unknown as TryOnInput;
    const productRefs = dedupeTrimmed(tryOn.productImages);
    const sceneRefs = dedupeTrimmed(tryOn.sceneReferenceImages);
    const modelRefs = dedupeTrimmed(tryOn.modelReferenceImages);
    const sceneRef = sceneRefs.length > 0 ? sceneRefs[params.itemIndex % sceneRefs.length] : null;
    return dedupeTrimmed(sceneRef ? [...productRefs, sceneRef, ...modelRefs] : [...productRefs, ...modelRefs]);
  }

  return [];
}

function dedupeTrimmed(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const next = typeof value === "string" ? value.trim() : "";
    if (!next || seen.has(next)) continue;
    seen.add(next);
    result.push(next);
    if (result.length >= 6) break;
  }
  return result;
}


