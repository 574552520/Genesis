import type {
  CommerceGenerateRequest,
  CommerceMode,
  CopyBlock,
  FlatlayInput,
  ImageModel,
  ImageTaskSpec,
  InvisibleMannequinInput,
  LaunchPackInput,
  LookbookAngle,
  LookbookInput,
  QualityWarning,
  TryOnInput,
} from "../types.js";

interface CommerceDraft {
  copyBlocks: CopyBlock[];
  titleCandidates: string[];
  keywords: string[];
  qualityWarnings: QualityWarning[];
  imageTasks: ImageTaskSpec[];
}

const apiDebugLog = process.env.API_DEBUG_LOG !== "0";

function logLlm(event: string, meta: Record<string, unknown>): void {
  if (!apiDebugLog) return;
  console.log(`[LLM] ${event} ${JSON.stringify(meta)}`);
}

function sanitizeEndpoint(endpoint: string): string {
  return endpoint.replace(/([?&]key=)[^&]+/, "$1***");
}

function clamp(input: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, input));
}

function toStringSafe(input: unknown, fallback = ""): string {
  return typeof input === "string" ? input.trim() : fallback;
}

function normalizeArray<T>(input: unknown, fallback: T[] = []): T[] {
  return Array.isArray(input) ? (input as T[]) : fallback;
}

function normalizeModel(input: unknown, fallback: ImageModel): ImageModel {
  if (input === "v2") return "v2";
  if (input === "pro") return "pro";
  return fallback;
}

function dedupeTrimmed(values: string[], max = 6): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const next = value.trim();
    if (!next || seen.has(next)) continue;
    seen.add(next);
    result.push(next);
    if (result.length >= max) break;
  }
  return result;
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    // no-op
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function makeTask(params: {
  id: string;
  title: string;
  prompt: string;
  aspectRatio: string;
  imageSize: string;
  model: ImageModel;
  referenceImages: string[];
}): ImageTaskSpec {
  return {
    id: params.id,
    title: params.title,
    prompt: params.prompt,
    aspectRatio: params.aspectRatio,
    imageSize: params.imageSize,
    model: params.model,
    status: "queued",
    imageUrl: null,
    error: null,
    jobId: null,
    referenceImages: params.referenceImages,
  };
}

function nextAngle(idx: number, angles: LookbookAngle[]): LookbookAngle {
  if (angles.length === 0) return idx % 3 === 0 ? "front" : idx % 3 === 1 ? "side" : "back";
  return angles[idx % angles.length];
}

function resolveLookbookPlan(input: LookbookInput): {
  selectedAngles: LookbookAngle[];
  targetCount: number;
  angleDriven: boolean;
} {
  const lookbookMode = input.lookbookMode === "count_input" ? "count_input" : "angle_preset";
  const selectedAngles = lookbookMode === "angle_preset" ? Array.from(new Set(input.selectedAngles)) : [];
  if (lookbookMode === "angle_preset") {
    return {
      selectedAngles,
      targetCount: Math.max(1, selectedAngles.length || 1),
      angleDriven: true,
    };
  }
  const manualCountRaw = Number(input.requestedCount ?? input.imageTaskCount ?? 6);
  const targetCount = Number.isFinite(manualCountRaw) ? clamp(Math.floor(manualCountRaw), 1, 6) : 6;
  return {
    selectedAngles,
    targetCount,
    angleDriven: false,
  };
}

function generateEditCommerceDraft(request: CommerceGenerateRequest): CommerceDraft {
  const input = request.input;
  const prompt = typeof input.descriptionPrompt === "string" ? input.descriptionPrompt.trim() : "";
  const title =
    request.mode === "lookbook"
      ? "lookbook edit"
      : request.mode === "try_on"
        ? "try-on edit"
        : request.mode === "flatlay"
          ? "flatlay edit"
          : request.mode === "invisible_mannequin_3d"
            ? "3d edit"
            : "detail edit";

  return {
    copyBlocks: [],
    titleCandidates: [],
    keywords: [request.mode, "edit"],
    qualityWarnings: [],
    imageTasks: [
      makeTask({
        id: `${request.mode}-edit-1`,
        title,
        prompt,
        aspectRatio: input.aspectRatio,
        imageSize: input.imageSize,
        model: input.model,
        referenceImages: dedupeTrimmed(input.referenceImages || [], 12),
      }),
    ],
  };
}

function buildLookbookReferenceImages(input: LookbookInput, angle: LookbookAngle): string[] {
  const refs = dedupeTrimmed([...(input.referenceImages || []), input.baseModelImage || ""], 12);
  if (input.lookbookMode === "angle_preset" && angle === "back" && input.backReferenceImage) {
    return dedupeTrimmed([...refs, input.backReferenceImage], 12);
  }
  return refs;
}

function buildLookbookAnglePrompt(
  angle: LookbookAngle,
  idx: number,
  descriptionPrompt?: string,
): string {
  const angleInstruction =
    angle === "front"
      ? "Camera angle: front view, full-body framing, balanced symmetry."
      : angle === "side"
        ? "Camera angle: side profile view, full-body framing, clear body line silhouette."
        : "Camera angle: back view, full-body framing, show garment rear details clearly.";

  const prompt = [
    "Generate coherent ecommerce fashion lookbook image.",
    angleInstruction,
    "Keep the same environment and model identity as reference image.",
    "Preserve garment color, texture, logos, and fit details accurately.",
    "Use natural fashion pose and clean composition with non-duplicate body language.",
    `Variation index: ${idx + 1}.`,
  ];

  if (descriptionPrompt?.trim()) {
    prompt.push(`Additional direction: ${descriptionPrompt.trim()}`);
  }

  return prompt.join("\n");
}

function generateLookbookDraftFromTemplates(input: LookbookInput): CommerceDraft {
  if (!input.baseModelImage) throw new Error("Lookbook requires one base model image");

  const { selectedAngles, angleDriven } = resolveLookbookPlan(input);
  if (!angleDriven || selectedAngles.length < 1) {
    throw new Error("Lookbook template mode requires at least one selected angle");
  }

  const imageTasks = selectedAngles.map((angle, idx) =>
    makeTask({
      id: `lookbook-${idx + 1}`,
      title: `${angle} pose ${idx + 1}`,
      prompt: buildLookbookAnglePrompt(angle, idx, input.descriptionPrompt),
      aspectRatio: input.aspectRatio,
      imageSize: input.imageSize,
      model: input.model,
      referenceImages: buildLookbookReferenceImages(input, angle),
    }),
  );

  return {
    copyBlocks: [],
    titleCandidates: [],
    keywords: selectedAngles,
    qualityWarnings: [],
    imageTasks,
  };
}

type LaunchPagePlanItem = {
  pageType: string;
  pageRole: string;
  goal: string;
  sellingPoint: string;
  visualFocus: string;
  assetStrategy: string;
  layoutDirection: string;
  copyDirection: string;
  needsTypography: boolean;
  allowColorMix: boolean;
  specialDirection?: string;
};

function parseLaunchSellingPoints(descriptionPrompt?: string): string[] {
  const raw = (descriptionPrompt ?? "").trim();
  if (!raw) return [];

  const normalized = raw
    .replace(/\r/g, "\n")
    .replace(/[?;]+/g, "\n")
    .replace(/[??]+/g, "\n")
    .replace(/\d+[.)?]\s*/g, "\n")
    .replace(/[??]+/g, "\n");

  return dedupeTrimmed(
    normalized
      .split(/\n+/)
      .map((value) => value.trim())
      .filter((value) => value.length >= 2),
    8,
  );
}

function resolveLaunchCount(input: LaunchPackInput): number {
  return [2, 4, 6, 8, 10].includes(input.requestedCount) ? input.requestedCount : 4;
}

function getLaunchPlatformLabel(input: LaunchPackInput): string {
  if (input.platform === "douyin") return "Douyin ecommerce";
  if (input.platform === "amazon") return `Amazon (${input.amazonMarketplace})`;
  return "Taobao ecommerce";
}

function getLaunchPlatformDirection(input: LaunchPackInput): string {
  if (input.platform === "douyin") {
    return "Use a faster rhythm with stronger first-screen impact, shorter copy blocks, and conversion-first page hooks.";
  }
  if (input.platform === "amazon") {
    return "Use structured benefits, clear feature hierarchy, and concise English-ready ecommerce composition.";
  }
  return "Use a full Taobao-style detail-page rhythm with a clear progression from hero page to selling points, details, material, fit, and closing pages.";
}

function getLaunchStyleLabel(style: LaunchPackInput["photographyStyle"]): string {
  switch (style) {
    case "lifestyle_light":
      return "light lifestyle ecommerce";
    case "premium_texture":
      return "premium texture";
    case "promo_impact":
      return "promotional high-impact";
    default:
      return "minimal white background";
  }
}

function buildLaunchPagePlan(input: LaunchPackInput, count: number): LaunchPagePlanItem[] {
  const sellingPoints = parseLaunchSellingPoints(input.descriptionPrompt);
  const fallbackPoints = [
    `${input.productName} core value`,
    `${input.productName} wearing experience`,
    `${input.productName} craftsmanship details`,
    `${input.productName} fabric story`,
    `${input.productName} silhouette and fit`,
    `${input.productName} styling scene`,
  ];
  const pointAt = (index: number): string => sellingPoints[index] || fallbackPoints[index] || fallbackPoints[fallbackPoints.length - 1];

  const taobaoPlan: LaunchPagePlanItem[] = [
    {
      pageType: "封面页",
      pageRole: "hero",
      goal: "Build first impression with one hero visual and a concise overall value proposition.",
      sellingPoint: sellingPoints.slice(0, 2).join(" / ") || pointAt(0),
      visualFocus: "Hero full-garment visual in the lead color, showing silhouette and strongest style identity.",
      assetStrategy: "Use the cleanest and most representative full product image from the asset pool.",
      layoutDirection: "Large hero composition with a small headline area or light selling-point strip.",
      copyDirection: "One strong headline and one short supporting statement. Do not dump the full selling-point list.",
      needsTypography: true,
      allowColorMix: false,
      specialDirection: "This page must feel like the visual anchor of the whole set.",
    },
    {
      pageType: "卖点页",
      pageRole: "selling-point-primary",
      goal: "Focus on the single strongest purchase reason and make it clearly different from the cover page.",
      sellingPoint: pointAt(0),
      visualFocus: "Use a visual that directly supports the top selling point with one clear focal area.",
      assetStrategy: "Prefer the product angle, detail crop, or composition that best proves this selling point.",
      layoutDirection: "Single-selling-point composition such as left image right copy or top image bottom copy.",
      copyDirection: "One main title with one short explanatory block. Keep copy concentrated.",
      needsTypography: true,
      allowColorMix: false,
    },
    {
      pageType: "卖点页",
      pageRole: "selling-point-secondary",
      goal: "Carry the second important selling point without repeating the structure of the previous page.",
      sellingPoint: pointAt(1),
      visualFocus: "Highlight function, fit, warmth, breathability, softness, or another secondary differentiator.",
      assetStrategy: "Use an alternate angle or a second colorway if it helps this page feel distinct.",
      layoutDirection: "Use a contrasting layout such as split cards, comparison-style blocks, or offset composition.",
      copyDirection: "Stay focused on one selling point, optionally pairing one tightly related supporting message.",
      needsTypography: true,
      allowColorMix: true,
    },
    {
      pageType: "细节页",
      pageRole: "detail",
      goal: "Build trust by showing construction, sewing, trims, and other tangible details.",
      sellingPoint: pointAt(2),
      visualFocus: "Neckline, cuff, zipper, placket, pocket, drawstring, stitching, and structural closeups.",
      assetStrategy: "Use detail shots, macro crops, or zoomable local areas from the asset pool.",
      layoutDirection: "Multi-panel detail collage or zoom-in composition with limited text.",
      copyDirection: "Use short labels or tiny callouts rather than long paragraphs.",
      needsTypography: true,
      allowColorMix: true,
    },
    {
      pageType: "面料页",
      pageRole: "material",
      goal: "Explain fabric feel, texture, thickness, and functional comfort in a believable way.",
      sellingPoint: pointAt(3),
      visualFocus: "Fabric texture, thickness cues, softness cues, or technical property storytelling.",
      assetStrategy: "Use fabric closeups and texture imagery; if assets are weak, downgrade to a lighter information page.",
      layoutDirection: "Closeup-led layout with small info cards or controlled data-style callouts.",
      copyDirection: "Mention only fabric-related benefits. Avoid repeating fit or styling claims here.",
      needsTypography: true,
      allowColorMix: true,
    },
    {
      pageType: "版型页",
      pageRole: "fit-size",
      goal: "Show silhouette, length, structure, and who this garment suits best.",
      sellingPoint: pointAt(4),
      visualFocus: "Body line, proportion, drape, looseness, cropped length, or oversized structure.",
      assetStrategy: "Prefer model or full-length visuals that clearly communicate fit and proportion.",
      layoutDirection: "Hero image first with light annotations about fit or wearer suitability.",
      copyDirection: "Use short fit notes or wearing guidance. Do not overload with technical material content.",
      needsTypography: true,
      allowColorMix: false,
    },
    {
      pageType: "场景页",
      pageRole: "scene",
      goal: "Create styling imagination and emotional context to support purchase desire.",
      sellingPoint: pointAt(5),
      visualFocus: "Atmosphere, outfit styling, lifestyle association, and visual mood.",
      assetStrategy: "Use model or contextual imagery when available; otherwise generate a lighter styled composition.",
      layoutDirection: "Visual-first scene page with very light text and stronger mood.",
      copyDirection: "Use one short emotional or styling line only.",
      needsTypography: false,
      allowColorMix: true,
    },
    {
      pageType: "总结页",
      pageRole: "summary",
      goal: "Close the set by summarizing purchase reasons and restoring a full-product overview.",
      sellingPoint: sellingPoints.slice(0, 3).join(" / ") || pointAt(0),
      visualFocus: "Return to clean full-product visibility with optional supporting mini-views.",
      assetStrategy: "Use the strongest full-product image plus lightweight supporting blocks.",
      layoutDirection: "Summary layout with balanced image and small information modules.",
      copyDirection: "Recap two or three key reasons without reusing the full copy from earlier pages.",
      needsTypography: true,
      allowColorMix: true,
    },
  ];

  const douyinPlan: LaunchPagePlanItem[] = [
    { ...taobaoPlan[0], pageType: "首屏页", pageRole: "hook", goal: "Hook attention immediately with the strongest visual and strongest conversion reason.", layoutDirection: "Big hero image with almost no text and strong first-screen impact." },
    { ...taobaoPlan[1], pageType: "爆点页", pageRole: "explosive-selling", goal: "Drive conversion with one highly perceptible selling point.", layoutDirection: "Impact-heavy layout with bold callouts or contrast blocks." },
    { ...taobaoPlan[3], pageType: "细节页", pageRole: "detail-fast", goal: "Show product quality quickly through tangible details." },
    { ...taobaoPlan[6], pageType: "氛围页", pageRole: "atmosphere", goal: "Increase desire through styling, mood, and lifestyle association." },
    { ...taobaoPlan[7], pageType: "收尾页", pageRole: "closing", goal: "Wrap up the conversion logic and close with a concise purchase summary.", copyDirection: "Short conversion summary with limited text density." },
  ];

  const amazonPlan: LaunchPagePlanItem[] = [
    { ...taobaoPlan[0], pageType: "Hero Page", pageRole: "hero", goal: "Present the main product identity and top value proposition in an Amazon-friendly hero layout.", copyDirection: "English-ready concise headline plus short support line." },
    { ...taobaoPlan[1], pageType: "Benefit Page", pageRole: "benefit", goal: "Focus on one clear customer benefit with structured hierarchy.", copyDirection: "Short benefit headline and clean supporting bullets." },
    { ...taobaoPlan[3], pageType: "Feature Detail", pageRole: "feature-detail", goal: "Show craftsmanship and concrete product features with clean explanation.", copyDirection: "Use concise labels instead of dense paragraphs." },
    { ...taobaoPlan[4], pageType: "Material Page", pageRole: "material", goal: "Explain fabric, touch, warmth, stretch, or breathability with a structured visual story." },
    { ...taobaoPlan[5], pageType: "Fit Page", pageRole: "fit", goal: "Show fit logic, silhouette, and wearer suitability in a clean ecommerce composition." },
    { ...taobaoPlan[6], pageType: "Lifestyle Page", pageRole: "lifestyle", goal: "End with a lifestyle-driven image that keeps product identity consistent and aspirational." },
  ];

  const source = input.platform === "douyin" ? douyinPlan : input.platform === "amazon" ? amazonPlan : taobaoPlan;
  return source.slice(0, count);
}

function normalizeLaunchPagePlan(input: LaunchPackInput, rawPlan: unknown, count: number): LaunchPagePlanItem[] {
  const fallbackPlan = buildLaunchPagePlan(input, count);
  const rawItems = normalizeArray<any>(rawPlan).slice(0, count);
  if (rawItems.length === 0) return fallbackPlan;

  return Array.from({ length: count }).map((_, index) => {
    const fallbackItem = fallbackPlan[index] || fallbackPlan[fallbackPlan.length - 1];
    const item = rawItems[index] ?? {};
    return {
      pageType: sanitizeLaunchPageType(toStringSafe(item.pageType, fallbackItem.pageType), fallbackItem.pageType),
      pageRole: toStringSafe(item.pageRole, fallbackItem.pageRole),
      goal: toStringSafe(item.goal, fallbackItem.goal),
      sellingPoint: toStringSafe(item.sellingPoint, fallbackItem.sellingPoint),
      visualFocus: toStringSafe(item.visualFocus, fallbackItem.visualFocus),
      assetStrategy: toStringSafe(item.assetStrategy, fallbackItem.assetStrategy),
      layoutDirection: toStringSafe(item.layoutDirection, fallbackItem.layoutDirection),
      copyDirection: toStringSafe(item.copyDirection, fallbackItem.copyDirection),
      needsTypography: typeof item.needsTypography === "boolean" ? item.needsTypography : fallbackItem.needsTypography,
      allowColorMix: typeof item.allowColorMix === "boolean" ? item.allowColorMix : fallbackItem.allowColorMix,
      specialDirection: toStringSafe(item.specialDirection, fallbackItem.specialDirection || ""),
    };
  });
}

function sanitizeLaunchPageType(pageType: string, fallback: string): string {
  const next = pageType.trim();
  if (!next) return fallback;
  if (/^[??]+$/.test(next)) return fallback;
  if (next.toLowerCase() === "unknown") return fallback;
  return next;
}

function isLaunchPlanDiverse(plan: LaunchPagePlanItem[]): boolean {
  if (plan.length <= 1) return true;
  const roleCount = new Set(plan.map((item) => item.pageRole)).size;
  const layoutCount = new Set(plan.map((item) => item.layoutDirection)).size;
  const focusCount = new Set(plan.map((item) => item.visualFocus)).size;
  const sellingPointCount = new Set(plan.map((item) => item.sellingPoint)).size;
  return roleCount >= Math.min(3, plan.length)
    && layoutCount >= Math.min(2, plan.length)
    && focusCount >= Math.min(2, plan.length)
    && sellingPointCount >= Math.min(2, plan.length);
}

function buildLaunchPageRelevantNotes(input: LaunchPackInput, page: LaunchPagePlanItem): string[] {
  const extracted = parseLaunchSellingPoints(input.descriptionPrompt);
  if (extracted.length === 0) return [];

  const pageKeywords = dedupeTrimmed([
    page.pageType,
    page.pageRole,
    page.sellingPoint,
    page.visualFocus,
    page.assetStrategy,
  ], 12)
    .join(" ")
    .toLowerCase();

  const scored = extracted
    .map((entry, index) => {
      const normalized = entry.toLowerCase();
      let score = 0;
      if (page.sellingPoint && normalized.includes(page.sellingPoint.toLowerCase())) score += 4;
      const tokens = normalized.split(/\s+/).filter(Boolean);
      for (const token of tokens) {
        if (token.length >= 2 && pageKeywords.includes(token)) score += 1;
      }
      if (index === 0) score += 0.2;
      return { entry, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((item) => item.entry);

  if (scored.length > 0) return scored;
  return extracted.slice(0, 1);
}

function buildLaunchPromptFromPlan(input: LaunchPackInput, page: LaunchPagePlanItem, index: number, count: number): string {
  const relevantNotes = buildLaunchPageRelevantNotes(input, page);
  const lines = [
    `Generate an apparel ecommerce detail image for ${getLaunchPlatformLabel(input)}.`,
    `Product identity: ${input.productName}. Audience: ${input.gender}, ${input.agePreset}. Photography style: ${getLaunchStyleLabel(input.photographyStyle)}.`,
    `Page role: ${page.pageType}.`,
    `Unique objective: ${page.goal}.`,
    `Primary selling point: ${page.sellingPoint}.`,
    `Visual focus: ${page.visualFocus}.`,
    `Asset usage strategy: ${page.assetStrategy}.`,
    `Layout direction: ${page.layoutDirection}.`,
    `Copy and typography direction: ${page.copyDirection}. ${page.needsTypography ? "This image should clearly feel like a designed ecommerce detail page with controlled text composition." : "Keep typography minimal and let the visual carry the message."}`,
    page.allowColorMix
      ? "Color strategy: different colorways may be used only when they improve SKU coverage and page rhythm."
      : "Color strategy: keep the lead color or the most representative color consistent on this page.",
    `Platform direction: ${getLaunchPlatformDirection(input)}`,
    "Only express the information assigned to this page. Do not repeat the full product brief or the full selling-point list from the rest of the set.",
  ];

  if (relevantNotes.length > 0) {
    lines.push(`Relevant user notes for this page only: ${relevantNotes.join(" | ")}.`);
  } else {
    lines.push("If the uploaded material is limited, simplify the page into a believable focused detail or light-layout ecommerce page.");
  }

  if (page.specialDirection) {
    lines.push(`Special direction: ${page.specialDirection}.`);
  }

  return lines.join("\n");
}

function buildLaunchCopyBlocks(input: LaunchPackInput, plan: LaunchPagePlanItem[]): CopyBlock[] {
  return [
    {
      id: "launch-analysis",
      title: "商品分析",
      content: `${input.productName} 面向 ${input.gender}/${input.agePreset} 人群，适配 ${getLaunchPlatformLabel(input)}，视觉风格为 ${getLaunchStyleLabel(input.photographyStyle)}，系统会先分析商品素材池，再按整组详情页节奏拆分每一页任务。`,
    },
    {
      id: "asset-plan",
      title: "素材策略",
      content: "Uploaded product images are treated as one asset pool. The system will identify hero shots, detail shots, fabric closeups, multi-color SKUs, and model or context imagery before assigning them to different pages.",
    },
    {
      id: "storyboard",
      title: "页面规划",
      content: plan.map((page, index) => `${index + 1}. ${page.pageType}: ${page.goal}`).join("\n"),
    },
  ];
}

function fallbackLaunchPack(input: LaunchPackInput): CommerceDraft {
  const count = resolveLaunchCount(input);
  const plan = buildLaunchPagePlan(input, count);
  const imageTasks = plan.map((page, index) =>
    makeTask({
      id: `launch-${index + 1}`,
      title: `第${index + 1}页 · ${page.pageType}`,
      prompt: buildLaunchPromptFromPlan(input, page, index, count),
      aspectRatio: input.aspectRatio,
      imageSize: input.imageSize,
      model: input.model,
      referenceImages: input.referenceImages,
    }),
  );

  return {
    copyBlocks: buildLaunchCopyBlocks(input, plan),
    titleCandidates: [
      `${input.productName} 详情页套组`,
      `${input.productName} 电商详情图`,
      `${input.productName} 商品卖点详情页`,
    ].slice(0, clamp(input.titleCount, 3, 10)),
    keywords: dedupeTrimmed([
      input.productName,
      getLaunchPlatformLabel(input),
      getLaunchStyleLabel(input.photographyStyle),
      input.gender,
      input.agePreset,
      ...parseLaunchSellingPoints(input.descriptionPrompt),
    ], 24),
    qualityWarnings: input.referenceImages.length > 0
      ? []
      : [
          {
            code: "missing_reference_images",
            message: "At least one product image is recommended for better consistency.",
            severity: "warning",
          },
        ],
    imageTasks,
  };
}

async function generateLaunchPackDraftStrict(input: LaunchPackInput): Promise<CommerceDraft> {
  const fallback = fallbackLaunchPack(input);
  const lingkeApiBaseUrl = process.env.LINGKE_API_BASE_URL || "https://api.link-ai.tech";
  const lingkeApiKey = process.env.LINGKE_API_KEY ?? process.env.GEMINI_API_KEY;
  const lingkeBearerToken = process.env.LINGKE_BEARER_TOKEN ?? lingkeApiKey;
  if (!lingkeApiKey) return fallback;

  const requestedCount = resolveLaunchCount(input);
  const fallbackPlan = buildLaunchPagePlan(input, requestedCount);
  const instruction = [
    "You are a senior apparel ecommerce detail-page strategist.",
    "Return strict JSON only.",
    `Plan exactly ${requestedCount} pages for one coherent detail-image set.`,
    "This is a single whole-set planning task, not separate isolated images.",
    "First design the overall page rhythm for the entire set, then assign one distinct image mission to each page.",
    "Every page must have a unique role. Do not repeat all selling points on every page.",
    "The final per-page prompt must not start with page numbering such as page 2 of 6.",
    "The final per-page prompt must not include the user's full raw description or the full brief verbatim. Only keep short page-relevant notes.",
    "Use uploaded product images as one shared asset pool and decide which pages should use hero shots, details, fabric closeups, silhouette views, mixed colorways, or light-layout information pages.",
    input.platform === "taobao"
      ? "Platform template: Taobao detail page. Prefer a real ecommerce rhythm such as hero page, focused selling-point pages, detail page, material page, fit/size page, scene or closing page."
      : input.platform === "douyin"
        ? "Platform template: Douyin ecommerce. Prefer fast hooks, stronger first-screen impact, shorter information rhythm, strong visual conversion logic."
        : `Platform template: Amazon detail page for ${input.amazonMarketplace}. Prefer structured benefits, feature hierarchy, concise English-friendly composition, and clear customer benefit flow.`,
    "If the asset pool is insufficient for a specific page type, merge tasks sensibly or switch that page into a lighter information page. Never invent fake detail pages unsupported by the assets.",
    "Output schema:",
    JSON.stringify({
      copyBlocks: [{ id: "launch-analysis", title: "string", content: "string" }],
      titleCandidates: ["string"],
      keywords: ["string"],
      qualityWarnings: [{ code: "string", message: "string", severity: "info|warning" }],
      pagePlan: [{
        pageType: "string",
        pageRole: "string",
        goal: "string",
        sellingPoint: "string",
        visualFocus: "string",
        assetStrategy: "string",
        layoutDirection: "string",
        copyDirection: "string",
        needsTypography: true,
        allowColorMix: false,
        specialDirection: "string",
      }],
    }),
    "Input:",
    JSON.stringify(input),
    "FallbackPlan:",
    JSON.stringify(fallbackPlan),
  ].join("\n");

  const parsed = await callTextLlm({
    apiBaseUrl: lingkeApiBaseUrl,
    apiKey: lingkeApiKey,
    bearerToken: lingkeBearerToken,
    body: {
      contents: [{ role: "user", parts: [{ text: instruction }] }],
      generationConfig: { temperature: 0.35, responseModalities: ["TEXT"] },
    },
  });
  if (!parsed) return fallback;

  const rawImageTasks = normalizeArray<any>(parsed.imageTasks);
  const pagePlan = normalizeLaunchPagePlan(input, parsed.pagePlan, requestedCount);
  const effectivePlan = isLaunchPlanDiverse(pagePlan) ? pagePlan : fallbackPlan;

  const imageTasks = effectivePlan.map((page, index) => {
    const fallbackTask = fallback.imageTasks[index % fallback.imageTasks.length];
    const rawTask = rawImageTasks[index] ?? {};
    return makeTask({
      id: toStringSafe(rawTask?.id, fallbackTask.id),
      title: toStringSafe(rawTask?.title, `第${index + 1}页 · ${page.pageType}`),
      prompt: buildLaunchPromptFromPlan(input, page, index, requestedCount),
      aspectRatio: toStringSafe(rawTask?.aspectRatio, fallbackTask.aspectRatio),
      imageSize: toStringSafe(rawTask?.imageSize, fallbackTask.imageSize),
      model: normalizeModel(rawTask?.model, fallbackTask.model),
      referenceImages: dedupeTrimmed(normalizeArray<string>(rawTask?.referenceImages, input.referenceImages), 12),
    });
  });

  const copyBlocks = normalizeArray<any>(parsed.copyBlocks)
    .map((block, index) => ({
      id: toStringSafe(block?.id, `copy-${index + 1}`),
      title: toStringSafe(block?.title, `Block ${index + 1}`),
      content: toStringSafe(block?.content),
    }))
    .filter((block) => block.content);
  const titleCandidates = normalizeArray<any>(parsed.titleCandidates)
    .map((title) => toStringSafe(title))
    .filter(Boolean)
    .slice(0, 12);
  const keywords = normalizeArray<any>(parsed.keywords)
    .map((keyword) => toStringSafe(keyword))
    .filter(Boolean)
    .slice(0, 24);
  const qualityWarnings: QualityWarning[] = normalizeArray<any>(parsed.qualityWarnings).map((warning, index) => ({
    code: toStringSafe(warning?.code, `warning-${index + 1}`),
    message: toStringSafe(warning?.message, "Check launch-pack inputs"),
    severity: warning?.severity === "info" ? "info" : "warning",
  }));

  return {
    copyBlocks: copyBlocks.length > 0 ? copyBlocks : buildLaunchCopyBlocks(input, effectivePlan),
    titleCandidates: titleCandidates.length > 0 ? titleCandidates : fallback.titleCandidates,
    keywords: keywords.length > 0 ? keywords : fallback.keywords,
    qualityWarnings: qualityWarnings.length > 0 ? qualityWarnings : fallback.qualityWarnings,
    imageTasks: imageTasks.length > 0 ? imageTasks : fallback.imageTasks,
  };
}

function fallbackTryOn(input: TryOnInput): CommerceDraft {
  const productRefs = dedupeTrimmed(input.productImages);
  const sceneRefs = dedupeTrimmed(input.sceneReferenceImages);
  const modelRefs = dedupeTrimmed(input.modelReferenceImages);
  const extraRefs = dedupeTrimmed(input.referenceImages || []);
  const hasModelReference = modelRefs.length > 0;
  const count = sceneRefs.length > 0 ? sceneRefs.length : clamp(input.imageTaskCount, 1, 6);

  const imageTasks = Array.from({ length: count }).map((_, idx) => {
    const sceneRef = sceneRefs.length > 0 ? sceneRefs[idx] : null;
    const sceneTitle = sceneRef ? `Try On - Scene ${idx + 1}` : `Try On ${idx + 1}`;
    const prompt = [
      "Perform apparel try-on and preserve garment realism, fit, and length.",
      `Gender category: ${input.genderCategory}; age group: ${input.ageGroup}.`,
      hasModelReference
        ? "Use model reference images as primary identity source (face, hairstyle, and body identity)."
        : "If scene reference contains a person, use that person as identity source.",
      sceneRef
        ? "Replicate scene reference for background, camera angle, lighting, and composition."
        : "No fixed scene reference, keep clean ecommerce framing.",
      "Garment must come from product reference images and replace current outfit.",
      input.descriptionPrompt || "Keep garment details accurate and identity coherent.",
      `Variation index: ${idx + 1}.`,
    ].join("\n");

    const taskRefs = sceneRef
      ? dedupeTrimmed([...productRefs, sceneRef, ...modelRefs, ...extraRefs])
      : dedupeTrimmed([...productRefs, ...modelRefs, ...extraRefs]);

    return makeTask({
      id: `tryon-${idx + 1}`,
      title: sceneTitle,
      prompt,
      aspectRatio: input.aspectRatio,
      imageSize: input.imageSize,
      model: input.model,
      referenceImages: taskRefs,
    });
  });

  return {
    copyBlocks: [],
    titleCandidates: [],
    keywords: [input.genderCategory, input.ageGroup, input.modelStyle || "", input.modelEthnicity || ""].filter(Boolean),
    qualityWarnings: input.productImages.length > 0
      ? []
      : [{ code: "missing_product_images", message: "Try-on requires product images.", severity: "warning" }],
    imageTasks,
  };
}

function fallbackLookbook(input: LookbookInput): CommerceDraft {
  const { selectedAngles, targetCount, angleDriven } = resolveLookbookPlan(input);
  const imageTasks = Array.from({ length: targetCount }).map((_, idx) => {
    const angle = selectedAngles[idx] ?? nextAngle(idx, selectedAngles);
    return makeTask({
      id: `lookbook-${idx + 1}`,
      title: angleDriven ? `${angle} pose ${idx + 1}` : `lookbook pose ${idx + 1}`,
      prompt: [
        "Generate coherent lookbook set.",
        angleDriven
          ? `Camera angle: ${angle}.`
          : "No fixed angle constraint. Keep same environment while varying pose, body orientation, and framing.",
        input.descriptionPrompt || "Ensure each image uses clearly different pose and framing.",
        `Frame index: ${idx + 1}, enforce non-duplicate body language.`,
      ].join("\n"),
      aspectRatio: input.aspectRatio,
      imageSize: input.imageSize,
      model: input.model,
      referenceImages: buildLookbookReferenceImages(input, angle),
    });
  });
  return {
    copyBlocks: [],
    titleCandidates: [],
    keywords: angleDriven ? selectedAngles : ["lookbook", "pose_variation", "framing_variation"],
    qualityWarnings: input.baseModelImage
      ? []
      : [{ code: "missing_base_model_image", message: "Lookbook requires a base model image.", severity: "warning" }],
    imageTasks,
  };
}

function fallbackFlatLike(
  input: FlatlayInput | InvisibleMannequinInput,
  mode: "flatlay" | "invisible_mannequin_3d",
): CommerceDraft {
  const hasReferenceGuide = (input.referenceImages || []).length > 0;
  const count = clamp(input.imageTaskCount, 1, 6);
  const sides = [
    { side: "front" as const, image: input.frontImage },
    { side: "back" as const, image: input.backImage },
  ].filter((item): item is { side: "front" | "back"; image: string } => Boolean(item.image));
  const imageTasks = sides.flatMap((item) =>
    Array.from({ length: count }).map((_, idx) =>
      makeTask({
        id: `${mode}-${item.side}-${idx + 1}`,
        title: `${item.side} ${mode === "flatlay" ? "flatlay" : "3d display"} ${idx + 1}`,
        prompt: [
          mode === "flatlay"
            ? "Generate apparel flatlay image with clean ecommerce quality."
            : "Generate apparel invisible-mannequin 3D display image with ecommerce quality.",
          `View side: ${item.side}.`,
          `Garment type: ${input.customGarmentType || input.garmentSubCategory || input.garmentMainCategory}.`,
          hasReferenceGuide
            ? "Use reference images as scene/composition/lighting guide. Replace the garment in reference scene with the uploaded product image while preserving reference style and framing."
            : mode === "flatlay"
              ? "Use clean white background, centered composition, accurate folds, and clear product silhouette."
              : "Use clean white background, realistic invisible-mannequin structure, and accurate fabric drape/volume.",
          "Preserve product identity from uploaded side image: exact color, logo, texture, stitching, and proportions.",
          `Variation index: ${idx + 1}.`,
          input.descriptionPrompt || "",
        ]
          .filter(Boolean)
          .join("\n"),
        aspectRatio: input.aspectRatio,
        imageSize: input.imageSize,
        model: input.model,
        referenceImages: dedupeTrimmed([item.image, ...(input.referenceImages || [])]),
      }),
    ),
  );
  return {
    copyBlocks: [],
    titleCandidates: [],
    keywords: [input.garmentMainCategory, input.garmentSubCategory || "", input.customGarmentType || ""].filter(Boolean),
    qualityWarnings: sides.length
      ? []
      : [{ code: "missing_side_image", message: "At least one side image is required.", severity: "warning" }],
    imageTasks,
  };
}

function fallbackDraft(request: CommerceGenerateRequest): CommerceDraft {
  switch (request.mode) {
    case "launch_pack":
      return fallbackLaunchPack(request.input as LaunchPackInput);
    case "try_on":
      return fallbackTryOn(request.input as TryOnInput);
    case "lookbook":
      return fallbackLookbook(request.input as LookbookInput);
    case "flatlay":
      return fallbackFlatLike(request.input as FlatlayInput, "flatlay");
    case "invisible_mannequin_3d":
      return fallbackFlatLike(request.input as InvisibleMannequinInput, "invisible_mannequin_3d");
    default:
      return fallbackLaunchPack(request.input as LaunchPackInput);
  }
}

function llmSchemaHint() {
  return {
    copyBlocks: [{ id: "string", title: "string", content: "string" }],
    titleCandidates: ["string"],
    keywords: ["string"],
    qualityWarnings: [{ code: "string", message: "string", severity: "info|warning" }],
    imageTasks: [
      {
        id: "string",
        title: "string",
        prompt: "string",
        aspectRatio: "string",
        imageSize: "1K|2K|4K",
        model: "pro|v2",
        referenceImages: ["data:image/..."],
      },
    ],
  };
}

function modeInstruction(mode: CommerceMode): string {
  if (mode === "launch_pack") return "Generate launch-package copy and image tasks.";
  if (mode === "try_on") return "Generate try-on tasks with high garment/body consistency.";
  if (mode === "lookbook") return "Generate lookbook tasks with angle-first and pose diversity.";
  if (mode === "flatlay") return "Generate flatlay tasks on clean white background.";
  return "Generate invisible-mannequin 3D display tasks on white background.";
}

function dataUrlToInlinePart(dataUrl: string): { inline_data: { data: string; mime_type: string } } {
  const [header, data] = dataUrl.split(",");
  if (!header || !data || !header.startsWith("data:")) {
    throw new Error("Invalid lookbook base image format");
  }
  const mimeType = header.split(";")[0].replace("data:", "");
  if (!mimeType) {
    throw new Error("Invalid lookbook base image mime type");
  }
  return {
    inline_data: {
      data,
      mime_type: mimeType,
    },
  };
}

async function callTextLlm(params: {
  apiBaseUrl: string;
  apiKey: string;
  bearerToken?: string;
  body: Record<string, unknown>;
}): Promise<Record<string, unknown> | null> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (params.bearerToken) headers.Authorization = `Bearer ${params.bearerToken}`;
  const endpoint = `${params.apiBaseUrl.replace(/\/$/, "")}/v1beta/models/gemini-3-pro-preview:generateContent?key=${encodeURIComponent(params.apiKey)}`;
  const startedAt = Date.now();
  logLlm("request.start", { endpoint: sanitizeEndpoint(endpoint) });
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(params.body),
    });
  } catch (error) {
    logLlm("request.network_error", {
      endpoint: sanitizeEndpoint(endpoint),
      elapsedMs: Date.now() - startedAt,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    logLlm("request.http_error", {
      endpoint: sanitizeEndpoint(endpoint),
      status: response.status,
      elapsedMs: Date.now() - startedAt,
      detail: detail.slice(0, 200),
    });
    return null;
  }

  const payload = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  logLlm("request.success", {
    endpoint: sanitizeEndpoint(endpoint),
    status: response.status,
    elapsedMs: Date.now() - startedAt,
  });
  const text = normalizeArray(payload.candidates?.[0]?.content?.parts)
    .map((part: any) => part?.text ?? "")
    .join("\n");
  return extractJsonObject(text);
}

async function generateLookbookDraftStrict(input: LookbookInput): Promise<CommerceDraft> {
  if (!input.baseModelImage) throw new Error("Lookbook requires one base model image");
  const baseModelImage = input.baseModelImage;
  const lingkeApiBaseUrl = process.env.LINGKE_API_BASE_URL ?? "https://lingkeapi.com";
  const lingkeApiKey = process.env.LINGKE_API_KEY ?? process.env.GEMINI_API_KEY;
  const lingkeBearerToken = process.env.LINGKE_BEARER_TOKEN ?? lingkeApiKey;
  if (!lingkeApiKey) throw new Error("Lookbook prompt generation failed: missing LINGKE_API_KEY");

  const { selectedAngles, targetCount, angleDriven } = resolveLookbookPlan(input);

  const instruction = [
    "You are an ecommerce fashion lookbook prompt planner.",
    "Return strict JSON only.",
    `Generate exactly ${targetCount} image tasks.`,
    angleDriven
      ? `Angles to prioritize: ${selectedAngles.join(",")}.`
      : "No fixed angle constraint: keep same environment and lighting while varying pose, camera distance, and body orientation.",
    "Every task prompt must be clearly different in pose and framing.",
    "All images must be from one coherent set: same environment, same styling language, same model identity.",
    "Do not repeat pose, limb arrangement, or camera framing across tasks.",
    "Keep outfit identity and model identity aligned to reference image.",
    input.lookbookMode === "angle_preset" && input.backReferenceImage
      ? "When angle is back, align garment rear details with the provided back reference image."
      : "Do not use back-only reference constraints.",
    "Output schema:",
    JSON.stringify({
      imageTasks: [{ id: "string", title: "string", prompt: "string", angle: "front|side|back(optional)" }],
      qualityWarnings: [{ code: "string", message: "string", severity: "info|warning" }],
      keywords: ["string"],
    }),
    "Input parameters:",
    JSON.stringify({
      selectedAngles: input.selectedAngles,
      angleDriven,
      requestedCount: input.requestedCount,
      descriptionPrompt: input.descriptionPrompt || "",
      aspectRatio: input.aspectRatio,
      imageSize: input.imageSize,
      model: input.model,
    }),
  ].join("\n");

  const parsed = await callTextLlm({
    apiBaseUrl: lingkeApiBaseUrl,
    apiKey: lingkeApiKey,
    bearerToken: lingkeBearerToken,
    body: {
      contents: [
        {
          role: "user",
          parts: [
            { text: instruction },
            dataUrlToInlinePart(baseModelImage),
            ...(input.lookbookMode === "angle_preset" && input.backReferenceImage ? [dataUrlToInlinePart(input.backReferenceImage)] : []),
          ],
        },
      ],
      generationConfig: {
        temperature: 0.4,
        responseModalities: ["TEXT"],
      },
    },
  });

  if (!parsed) throw new Error("Lookbook prompt generation failed, please retry");

  const rawTasks = normalizeArray<any>(parsed.imageTasks);
  if (rawTasks.length !== targetCount) {
    throw new Error("Lookbook prompt generation failed, please retry");
  }

  const imageTasks: ImageTaskSpec[] = rawTasks.map((task, idx) => {
    const fallbackAngle = selectedAngles[idx] ?? nextAngle(idx, selectedAngles);
    const angleRaw = toStringSafe(task?.angle, fallbackAngle);
    const angle = angleRaw === "side" || angleRaw === "back" ? angleRaw : "front";
    const prompt = toStringSafe(task?.prompt);
    if (!prompt) throw new Error("Lookbook prompt generation failed, please retry");
    return makeTask({
      id: toStringSafe(task?.id, `lookbook-${idx + 1}`),
      title: toStringSafe(task?.title, angleDriven ? `${angle} pose ${idx + 1}` : `lookbook pose ${idx + 1}`),
      prompt,
      aspectRatio: input.aspectRatio,
      imageSize: input.imageSize,
      model: input.model,
      referenceImages: buildLookbookReferenceImages(input, angle),
    });
  });

  return {
    copyBlocks: [],
    titleCandidates: [],
    keywords: normalizeArray<any>(parsed.keywords)
      .map((kw) => toStringSafe(kw))
      .filter(Boolean)
      .slice(0, 24),
    qualityWarnings: normalizeArray<any>(parsed.qualityWarnings).map((warning, idx) => ({
      code: toStringSafe(warning?.code, `warning-${idx + 1}`),
      message: toStringSafe(warning?.message, "Lookbook quality warning"),
      severity: warning?.severity === "info" ? "info" : "warning",
    })),
    imageTasks,
  };
}

export async function generateCommerceDraft(request: CommerceGenerateRequest): Promise<CommerceDraft> {
  if (request.editMode) {
    logLlm("draft.mode", { mode: request.mode, source: "edit_mode" });
    return generateEditCommerceDraft(request);
  }

  if (request.mode === "launch_pack") {
    logLlm("draft.mode", { mode: request.mode, source: "llm_launch_pack" });
    return generateLaunchPackDraftStrict(request.input as LaunchPackInput);
  }
  if (request.mode === "lookbook") {
    const lookbookInput = request.input as LookbookInput;
    if (lookbookInput.lookbookMode !== "count_input") {
      logLlm("draft.mode", { mode: request.mode, source: "lookbook_templates" });
      return generateLookbookDraftFromTemplates(lookbookInput);
    }
    logLlm("draft.mode", { mode: request.mode, source: "llm_strict" });
    return generateLookbookDraftStrict(lookbookInput);
  }
  if (request.mode === "try_on") {
    logLlm("draft.mode", { mode: request.mode, source: "fallback_only" });
    return fallbackTryOn(request.input as TryOnInput);
  }
  if (request.mode === "flatlay") {
    logLlm("draft.mode", { mode: request.mode, source: "fixed_templates" });
    return fallbackFlatLike(request.input as FlatlayInput, "flatlay");
  }
  if (request.mode === "invisible_mannequin_3d") {
    logLlm("draft.mode", { mode: request.mode, source: "fixed_templates" });
    return fallbackFlatLike(request.input as InvisibleMannequinInput, "invisible_mannequin_3d");
  }

  const fallback = fallbackDraft(request);
  const lingkeApiBaseUrl = process.env.LINGKE_API_BASE_URL ?? "https://lingkeapi.com";
  const lingkeApiKey = process.env.LINGKE_API_KEY ?? process.env.GEMINI_API_KEY;
  const lingkeBearerToken = process.env.LINGKE_BEARER_TOKEN ?? lingkeApiKey;
  if (!lingkeApiKey) {
    logLlm("draft.fallback", { mode: request.mode, reason: "missing_api_key" });
    return fallback;
  }

  const prompt = [
    "You are an apparel ecommerce generation planner.",
    "Return strict JSON only.",
    modeInstruction(request.mode),
    "Output schema:",
    JSON.stringify(llmSchemaHint()),
    "Rules:",
    "1) imageTasks must be executable prompts for image model.",
    "2) Keep provided reference images whenever possible.",
    "3) Only output qualityWarnings when necessary.",
    "Input request:",
    JSON.stringify(request),
    "Fallback draft for reference:",
    JSON.stringify(fallback),
  ].join("\n");

  const parsed = await callTextLlm({
    apiBaseUrl: lingkeApiBaseUrl,
    apiKey: lingkeApiKey,
    bearerToken: lingkeBearerToken,
    body: {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.35,
        responseModalities: ["TEXT"],
      },
    },
  });
  if (!parsed) {
    logLlm("draft.fallback", { mode: request.mode, reason: "llm_response_invalid_or_failed" });
    return fallback;
  }

  const rawCopyBlocks = normalizeArray<any>(parsed.copyBlocks);
  const copyBlocks: CopyBlock[] =
    rawCopyBlocks.length > 0
      ? rawCopyBlocks.map((block, idx) => ({
          id: toStringSafe(block?.id, `copy-${idx + 1}`),
          title: toStringSafe(block?.title, `Block ${idx + 1}`),
          content: toStringSafe(block?.content, ""),
        }))
      : fallback.copyBlocks;

  const titleCandidates = normalizeArray<any>(parsed.titleCandidates)
    .map((title) => toStringSafe(title))
    .filter(Boolean)
    .slice(0, 12);
  const keywords = normalizeArray<any>(parsed.keywords)
    .map((kw) => toStringSafe(kw))
    .filter(Boolean)
    .slice(0, 24);
  const qualityWarnings: QualityWarning[] = normalizeArray<any>(parsed.qualityWarnings).map((warning, idx) => ({
    code: toStringSafe(warning?.code, `warning-${idx + 1}`),
    message: toStringSafe(warning?.message, "Check input quality"),
    severity: warning?.severity === "info" ? "info" : "warning",
  }));

  const rawTasks = normalizeArray<any>(parsed.imageTasks);
  const imageTasksRaw: ImageTaskSpec[] =
    rawTasks.length > 0
      ? rawTasks.slice(0, Math.max(1, fallback.imageTasks.length)).map((task, idx) => {
          const fallbackTask = fallback.imageTasks[idx % fallback.imageTasks.length];
          return makeTask({
            id: toStringSafe(task?.id, fallbackTask.id),
            title: toStringSafe(task?.title, fallbackTask.title),
            prompt: toStringSafe(task?.prompt, fallbackTask.prompt),
            aspectRatio: toStringSafe(task?.aspectRatio, fallbackTask.aspectRatio),
            imageSize: toStringSafe(task?.imageSize, fallbackTask.imageSize),
            model: normalizeModel(task?.model, fallbackTask.model),
            referenceImages: dedupeTrimmed(
              normalizeArray<string>(task?.referenceImages, fallbackTask.referenceImages || []),
            ),
          });
        })
      : fallback.imageTasks;

  const imageTasks = imageTasksRaw;

  return {
    copyBlocks,
    titleCandidates: titleCandidates.length > 0 ? titleCandidates : fallback.titleCandidates,
    keywords: keywords.length > 0 ? keywords : fallback.keywords,
    qualityWarnings: qualityWarnings.length > 0 ? qualityWarnings : fallback.qualityWarnings,
    imageTasks,
  };
}
