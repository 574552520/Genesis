import { Router } from "express";
import {
  createCommercePack,
  createGenerationJobAtomic,
  getCommercePackByIdForUser,
  insertCommercePackItems,
  setCommercePackFailed,
  setCommercePackReady,
} from "../services/db.js";
import { generateCommerceDraft } from "../services/commerceLlm.js";
import { enqueueGenerationJob } from "../services/queue.js";
import type {
  CommerceGenerateRequest,
  CommerceMode,
  CommerceModuleInput,
  FlatlayInput,
  ImageModel,
  InvisibleMannequinInput,
  LaunchPackInput,
  LookbookAngle,
  LookbookInput,
  QualityWarning,
  TryOnInput,
} from "../types.js";

const router = Router();

const validModes = new Set<CommerceMode>([
  "launch_pack",
  "try_on",
  "lookbook",
  "flatlay",
  "invisible_mannequin_3d",
]);

const validLookbookAngles = new Set<LookbookAngle>(["front", "side", "back"]);
const validLaunchCounts = new Set([2, 4, 6, 8, 10]);

function parseStringArray(input: unknown): string[] {
  return Array.isArray(input)
    ? input.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean)
    : [];
}

function clamp(input: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, input));
}

function normalizeImageModel(input: unknown): ImageModel {
  return input === "v2" ? "v2" : "pro";
}

function normalizeBaseSettings(body: any): {
  imageSize: string;
  aspectRatio: string;
  model: ImageModel;
  imageTaskCount: number;
} {
  const imageTaskCountRaw = Number(body?.imageTaskCount ?? 4);
  return {
    imageSize: typeof body?.imageSize === "string" ? body.imageSize : "1K",
    aspectRatio: typeof body?.aspectRatio === "string" ? body.aspectRatio : "3:4",
    model: normalizeImageModel(body?.model),
    imageTaskCount: Number.isFinite(imageTaskCountRaw) ? clamp(Math.floor(imageTaskCountRaw), 1, 6) : 4,
  };
}

function normalizeLaunchPackInput(body: any): LaunchPackInput {
  const titleCountRaw = Number(body?.titleCount ?? 5);
  const requestedCountRaw = Number(body?.requestedCount ?? body?.imageTaskCount ?? 4);
  const platform = body?.platform === "douyin" || body?.platform === "amazon" ? body.platform : "taobao";
  const normalizedRequestedCount = validLaunchCounts.has(requestedCountRaw) ? requestedCountRaw : 4;
  const legacySellingPoints = parseStringArray(body?.coreSellingPoints).slice(0, 8).join("；");
  return {
    mode: "launch_pack",
    ...normalizeBaseSettings({ ...body, imageTaskCount: normalizedRequestedCount }),
    imageTaskCount: normalizedRequestedCount,
    productName: typeof body?.productName === "string" ? body.productName.trim() : "",
    gender:
      body?.gender === "menswear" || body?.gender === "unisex"
        ? body.gender
        : "womenswear",
    agePreset: body?.agePreset === "teen" || body?.agePreset === "kids" ? body.agePreset : "adult",
    photographyStyle:
      body?.photographyStyle === "lifestyle_light" ||
      body?.photographyStyle === "premium_texture" ||
      body?.photographyStyle === "promo_impact"
        ? body.photographyStyle
        : "minimal_white",
    descriptionPrompt: typeof body?.descriptionPrompt === "string" ? body.descriptionPrompt.trim() : legacySellingPoints || undefined,
    referenceImages: parseStringArray(body?.referenceImages).slice(0, 6),
    platform,
    amazonMarketplace: body?.amazonMarketplace === "amazon_us" ? body.amazonMarketplace : "amazon_us",
    templateType: platform === "douyin" ? "douyin_detail" : platform === "amazon" ? "amazon_detail" : "taobao_detail",
    heroStyle:
      body?.heroStyle === "scene" || body?.heroStyle === "selling_point_overlay"
        ? body.heroStyle
        : "white_background",
    detailDepth:
      body?.detailDepth === "concise" || body?.detailDepth === "rich"
        ? body.detailDepth
        : "standard",
    requestedCount: normalizedRequestedCount,
    titleCount: Number.isFinite(titleCountRaw) ? clamp(Math.floor(titleCountRaw), 3, 10) : 5,
  };
}

function normalizeTryOnInput(body: any): TryOnInput {
  const modelReferenceImages = parseStringArray(body?.modelReferenceImages).slice(0, 6);
  return {
    mode: "try_on",
    ...normalizeBaseSettings(body),
    productImages: parseStringArray(body?.productImages).slice(0, 6),
    descriptionPrompt: typeof body?.descriptionPrompt === "string" ? body.descriptionPrompt.trim() : undefined,
    genderCategory:
      body?.genderCategory === "menswear" || body?.genderCategory === "unisex"
        ? body.genderCategory
        : "womenswear",
    ageGroup:
      body?.ageGroup === "teen" ||
      body?.ageGroup === "older_kids" ||
      body?.ageGroup === "middle_kids" ||
      body?.ageGroup === "younger_kids" ||
      body?.ageGroup === "toddlers"
        ? body.ageGroup
        : "adult",
    sceneReferenceImages: parseStringArray(body?.sceneReferenceImages).slice(0, 6),
    modelReferenceImages,
    referenceImages: parseStringArray(body?.referenceImages).slice(0, 6),
    builtinScenePresetId: typeof body?.builtinScenePresetId === "string" ? body.builtinScenePresetId : null,
    builtinModelPresetId: typeof body?.builtinModelPresetId === "string" ? body.builtinModelPresetId : null,
    useModelReference: modelReferenceImages.length > 0 || Boolean(body?.useModelReference),
    modelEthnicity: typeof body?.modelEthnicity === "string" ? body.modelEthnicity.trim() : undefined,
    modelStyle: typeof body?.modelStyle === "string" ? body.modelStyle.trim() : undefined,
    keepBackground: body?.keepBackground !== false,
    useSceneAsTextReference: body?.useSceneAsTextReference === true,
  };
}

function normalizeLookbookInput(body: any): LookbookInput {
  const lookbookMode = body?.lookbookMode === "count_input" ? "count_input" : "angle_preset";
  const selectedAngles = parseStringArray(body?.selectedAngles).filter((x): x is LookbookAngle =>
    validLookbookAngles.has(x as LookbookAngle),
  );
  const requestedCountRaw = Number(body?.requestedCount ?? body?.imageTaskCount ?? 6);
  const manualCount = Number.isFinite(requestedCountRaw) ? clamp(Math.floor(requestedCountRaw), 1, 6) : 6;
  const finalSelectedAngles: LookbookAngle[] = lookbookMode === "angle_preset"
    ? (selectedAngles.length > 0 ? selectedAngles : ["front"])
    : [];
  const requestedCount = lookbookMode === "angle_preset"
    ? Math.max(1, finalSelectedAngles.length || 1)
    : manualCount;

  return {
    mode: "lookbook",
    lookbookMode,
    ...normalizeBaseSettings({ ...body, imageTaskCount: requestedCount }),
    baseModelImage: typeof body?.baseModelImage === "string" ? body.baseModelImage.trim() : null,
    backReferenceImage: typeof body?.backReferenceImage === "string" ? body.backReferenceImage.trim() : null,
    referenceImages: parseStringArray(body?.referenceImages).slice(0, 6),
    selectedAngles: finalSelectedAngles,
    requestedCount,
    descriptionPrompt: typeof body?.descriptionPrompt === "string" ? body.descriptionPrompt.trim() : undefined,
  };
}

function normalizeFlatlayInput(body: any, mode: "flatlay" | "invisible_mannequin_3d"): FlatlayInput | InvisibleMannequinInput {
  const normalized = {
    mode,
    ...normalizeBaseSettings(body),
    frontImage: typeof body?.frontImage === "string" ? body.frontImage.trim() : null,
    backImage: typeof body?.backImage === "string" ? body.backImage.trim() : null,
    generationMode: body?.generationMode === "reference" ? "reference" : "smart",
    referenceImages: parseStringArray(body?.referenceImages).slice(0, 6),
    garmentMainCategory: typeof body?.garmentMainCategory === "string" ? body.garmentMainCategory.trim() : "",
    garmentSubCategory: typeof body?.garmentSubCategory === "string" ? body.garmentSubCategory.trim() : undefined,
    customGarmentType: typeof body?.customGarmentType === "string" ? body.customGarmentType.trim() : undefined,
    descriptionPrompt: typeof body?.descriptionPrompt === "string" ? body.descriptionPrompt.trim() : undefined,
  };
  return normalized as FlatlayInput | InvisibleMannequinInput;
}

function normalizeGenerateRequest(body: any): CommerceGenerateRequest {
  const mode = validModes.has(body?.mode) ? (body.mode as CommerceMode) : "launch_pack";
  const payload = body?.input && typeof body.input === "object" ? body.input : body;
  const editMode = body?.editMode === true;

  let input: CommerceModuleInput;
  if (mode === "try_on") {
    input = normalizeTryOnInput(payload);
  } else if (mode === "lookbook") {
    input = normalizeLookbookInput(payload);
  } else if (mode === "flatlay") {
    input = normalizeFlatlayInput(payload, "flatlay");
  } else if (mode === "invisible_mannequin_3d") {
    input = normalizeFlatlayInput(payload, "invisible_mannequin_3d");
  } else {
    input = normalizeLaunchPackInput(payload);
  }

  return { mode, input, editMode };
}

function validateRequest(request: CommerceGenerateRequest): string | null {
  const input = request.input;
  if (request.mode === "launch_pack") {
    const launchInput = input as LaunchPackInput;
    if (!launchInput.productName) {
      return "Missing required field: productName";
    }
    if (launchInput.referenceImages.length < 1) {
      return "At least one reference image is required";
    }
    return null;
  }

  if (request.mode === "try_on") {
    const tryOnInput = input as TryOnInput;
    if (tryOnInput.productImages.length < 1) {
      return "Try-on requires at least one product image";
    }
    return null;
  }

  if (request.mode === "lookbook") {
    const lookbookInput = input as LookbookInput;
    if (!lookbookInput.baseModelImage) {
      return "Lookbook requires one base model image";
    }
    return null;
  }

  const flatInput = input as FlatlayInput | InvisibleMannequinInput;
  if (!flatInput.frontImage && !flatInput.backImage) {
    return "At least one side image is required";
  }
  if (flatInput.generationMode === "reference" && flatInput.referenceImages.length < 1) {
    return "Reference mode requires at least one reference image";
  }
  if (!flatInput.garmentMainCategory) {
    return "Garment category is required";
  }
  return null;
}

router.post("/pack/generate", async (req, res) => {
  const request = normalizeGenerateRequest(req.body);
  const validationError = validateRequest(request);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  const input = request.input;
  let packId = "";

  try {
    packId = await createCommercePack({
      userId: req.user!.id,
      platform: request.mode === "launch_pack" ? (input as LaunchPackInput).platform : "taobao",
      mode: request.mode,
      templateType: request.mode === "launch_pack" ? (input as LaunchPackInput).templateType : "commuter_womenswear",
      input,
    });

    const draft = await generateCommerceDraft(request);
    const warnings: QualityWarning[] = [...draft.qualityWarnings];
    const taskResults = await Promise.all(
      draft.imageTasks.map(async (task) => {
        let jobId: string | null = null;
        let warning: QualityWarning | null = null;
        try {
          jobId = await createGenerationJobAtomic({
            userId: req.user!.id,
            prompt: task.prompt,
            aspectRatio: task.aspectRatio,
            imageSize: task.imageSize,
            model: task.model,
            lane: request.mode,
          });

          enqueueGenerationJob({
            jobId,
            userId: req.user!.id,
            prompt: task.prompt,
            referenceImages: (task.referenceImages ?? []).filter(Boolean),
            aspectRatio: task.aspectRatio,
            imageSize: task.imageSize,
            model: task.model,
            lane: request.mode,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to enqueue image task";
          warning = {
            code: "image_task_enqueue_failed",
            message: `${task.title}: ${message}`,
            severity: "warning",
          };
        }

        return {
          warning,
          item: {
            title: task.title,
            prompt: task.prompt,
            aspectRatio: task.aspectRatio,
            imageSize: task.imageSize,
            model: task.model,
            jobId,
          },
        };
      }),
    );

    taskResults.forEach((result) => {
      if (result.warning) warnings.push(result.warning);
    });

    const insertedItems = taskResults.map((result) => result.item);

    await insertCommercePackItems({ packId, imageTasks: insertedItems });

    await setCommercePackReady({
      packId,
      copyBlocks: draft.copyBlocks,
      titleCandidates: draft.titleCandidates,
      keywords: draft.keywords,
      qualityWarnings: warnings,
    });

    const pack = await getCommercePackByIdForUser({ userId: req.user!.id, packId });
    res.status(202).json({ packId, pack });
  } catch (error) {
    if (packId) {
      try {
        await setCommercePackFailed({
          packId,
          error: error instanceof Error ? error.message : "Failed to generate commerce pack",
        });
      } catch {
        // Ignore secondary failure.
      }
    }
    const rawMessage = error instanceof Error ? error.message : "Failed to generate commerce pack";
    const message =
      request.mode === "lookbook" && rawMessage.toLowerCase().includes("lookbook")
        ? "Lookbook prompt generation failed, please retry"
        : rawMessage;
    res.status(500).json({ error: message });
  }
});

router.get("/pack/:packId", async (req, res) => {
  const startedAt = Date.now();
  const packId = req.params.packId;
  const userId = req.user!.id;
  try {
    const pack = await getCommercePackByIdForUser({
      userId,
      packId,
    });
    if (!pack) {
      res.status(404).json({ error: "Commerce pack not found" });
      return;
    }
    console.log("[COMMERCE][GET]", {
      packId,
      userId,
      itemCount: pack.imageTasks.length,
      status: pack.status,
      warnings: pack.qualityWarnings.length,
      elapsedMs: Date.now() - startedAt,
      succeededJobs: pack.imageTasks.filter((task) => task.status === "succeeded").length,
    });
    res.json({ pack });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load commerce pack";
    console.error("[COMMERCE][GET] failed", {
      packId,
      userId,
      elapsedMs: Date.now() - startedAt,
      message,
    });
    res.status(500).json({ error: message });
  }
});

export default router;
