
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Image as ImageIcon, Loader2, Sparkles, Upload } from "lucide-react";
import { api } from "../lib/api";
import ImageModal from "./ImageModal";
import type {
  CommerceGenerateRequest,
  LookbookAngle,
  LookbookMode,
  CommerceMode,
  CommerceModuleInput,
  CommercePack,
  LaunchPackInput,
  LookbookInput,
  TryOnInput,
  FlatlayInput,
  InvisibleMannequinInput,
} from "../types";
import {
  PREVIEW_GRID_GAP_CLASS,
  PREVIEW_SIZE_MIN_CARD_WIDTH,
  PREVIEW_SIZE_LABEL,
  PREVIEW_SIZE_ORDER,
  type PreviewSize,
} from "./previewSizeConfig";
import { buildPreviewMapFromUploads, resolveImagePreviewUrl, type ImagePreviewMap } from "../lib/imageUploads";

const MODE_ORDER: CommerceMode[] = [
  "launch_pack",
  "try_on",
  "lookbook",
  "flatlay",
  "invisible_mannequin_3d",
];

const MODE_LABEL: Record<CommerceMode, string> = {
  launch_pack: "服装详情页",
  try_on: "试穿",
  lookbook: "Lookbook",
  flatlay: "平铺",
  invisible_mannequin_3d: "3D 展示",
};

const GARMENT_MAIN = ["上装", "下装", "套装", "功能服"];
const ASPECT_RATIO_OPTIONS = ["1:1", "3:4", "4:3", "9:16", "16:9", "2:3", "3:2"];
const LOOKBOOK_ANGLE_OPTIONS: Array<{ value: LookbookAngle; label: string }> = [
  { value: "front", label: "正面" },
  { value: "side", label: "侧面" },
  { value: "back", label: "背面" },
];
const LAUNCH_COUNT_OPTIONS = [2, 4, 6, 8, 10] as const;
const LAUNCH_PLATFORM_LABEL: Record<LaunchPackInput["platform"], string> = { taobao: "淘宝", douyin: "抖音", amazon: "亚马逊" };
const LAUNCH_PHOTO_STYLE_LABEL: Record<LaunchPackInput["photographyStyle"], string> = { minimal_white: "极简白底", lifestyle_light: "轻场景电商", premium_texture: "高级质感", promo_impact: "强促销信息感" };

type UploadField =
  | "referenceImages"
  | "productImages"
  | "sceneReferenceImages"
  | "modelReferenceImages"
  | "baseModelImage"
  | "backReferenceImage"
  | "frontImage"
  | "backImage";

type ModalState = {
  kind: "single";
  url: string;
  title?: string;
  prompt?: string;
  mode?: CommerceMode;
  referenceImages?: string[];
} | {
  kind: "gallery";
  mode: CommerceMode;
  selectedCardId: string;
};

type ActiveTaskCard = {
  cardId: string;
  stableId?: string;
  resolvedId?: string | null;
  createdAt: string;
  title: string;
  prompt: string;
  aspectRatio: string;
  imageSize: string;
  imageUrl: string | null;
  placeholderSourceUrl?: string | null;
  anchorCardId?: string | null;
  localOnly?: boolean;
  status: string;
  model: "pro" | "v2";
  error: string | null;
  referenceImages: string[];
};

type PollErrorState = Record<string, string>;

function estimateTaskCount(mode: CommerceMode, input: CommerceModuleInput): number {
  if (mode === "launch_pack") {
    const launchInput = input as LaunchPackInput;
    return Math.max(1, Math.min(10, Number(launchInput.requestedCount ?? launchInput.imageTaskCount) || 1));
  }
  if (mode === "try_on") {
    const tryOnInput = input as TryOnInput;
    const count = tryOnInput.sceneReferenceImages.length > 0
      ? tryOnInput.sceneReferenceImages.length
      : Number(tryOnInput.imageTaskCount) || 1;
    return Math.max(1, Math.min(6, count));
  }
  if (mode === "lookbook") {
    const lookbookInput = input as LookbookInput;
    const count = lookbookInput.lookbookMode === "angle_preset"
      ? Math.max(1, lookbookInput.selectedAngles.length || 1)
      : Number(lookbookInput.requestedCount ?? lookbookInput.imageTaskCount) || 1;
    return Math.max(1, Math.min(6, count));
  }
  const garmentInput = input as FlatlayInput | InvisibleMannequinInput;
  const sideCount = [garmentInput.frontImage, garmentInput.backImage].filter(Boolean).length || 1;
  return sideCount * Math.max(1, Math.min(6, Number(garmentInput.imageTaskCount) || 1));
}

function buildPendingTaskCards(mode: CommerceMode, input: CommerceModuleInput, requestId: string): ActiveTaskCard[] {
  const createdAt = new Date().toISOString();
  const count = estimateTaskCount(mode, input);
  const model = input.model;
  const prompt = "提示词生成中，稍后将自动进入正式排队。";

  return Array.from({ length: count }).map((_, index) => ({
    cardId: `pending-${requestId}-${index + 1}`,
    createdAt,
    title: `${MODE_LABEL[mode]} ${index + 1}`,
    prompt,
    aspectRatio: input.aspectRatio,
    imageSize: input.imageSize,
    imageUrl: null,
    status: "queued",
    model,
    error: null,
    referenceImages: [],
    localOnly: true,
  }));
}

function defaultForm(mode: CommerceMode): CommerceModuleInput {
  const common = {
    imageSize: "1K",
    aspectRatio: "3:4",
    model: "pro" as const,
    imageTaskCount: 4,
  };

  if (mode === "launch_pack") {
    return {
      mode,
      ...common,
      platform: "taobao",
      amazonMarketplace: "amazon_us",
      templateType: "taobao_detail",
      heroStyle: "white_background",
      detailDepth: "standard",
      productName: "",
      gender: "womenswear",
      agePreset: "adult",
      photographyStyle: "minimal_white",
      descriptionPrompt: "",
      referenceImages: [],
      requestedCount: 4,
      titleCount: 6,
    };
  }

  if (mode === "try_on") {
    return {
      mode,
      ...common,
      productImages: [],
      descriptionPrompt: "",
      genderCategory: "womenswear",
      ageGroup: "adult",
      sceneReferenceImages: [],
      modelReferenceImages: [],
      useModelReference: false,
      modelEthnicity: "",
      modelStyle: "",
      keepBackground: true,
      useSceneAsTextReference: false,
    };
  }

  if (mode === "lookbook") {
    return {
      mode,
      ...common,
      lookbookMode: "angle_preset",
      baseModelImage: null,
      backReferenceImage: null,
      selectedAngles: ["front", "side", "back"],
      requestedCount: 3,
      descriptionPrompt: "",
      imageTaskCount: 3,
    };
  }

  return {
    mode,
    ...common,
    frontImage: null,
    backImage: null,
    generationMode: "smart",
    referenceImages: [],
    garmentMainCategory: "上装",
    garmentSubCategory: "",
    customGarmentType: "",
    descriptionPrompt: "",
    imageTaskCount: 1,
  };
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).slice(0, 6);
}

function insertTaskCardsAfter(items: ActiveTaskCard[], inserted: ActiveTaskCard[]): ActiveTaskCard[] {
  const merged = [...items];
  for (const card of inserted) {
    const anchorId = card.anchorCardId;
    if (!anchorId) {
      merged.unshift(card);
      continue;
    }
    const anchorIndex = merged.findIndex((item) => item.cardId === anchorId);
    if (anchorIndex < 0) {
      merged.unshift(card);
      continue;
    }
    let insertIndex = anchorIndex;
    while (insertIndex + 1 < merged.length && merged[insertIndex + 1].anchorCardId === anchorId) {
      insertIndex += 1;
    }
    merged.splice(insertIndex + 1, 0, card);
  }
  return merged;
}

function statusLabel(status: string): string {
  if (status === "queued") return "排队中";
  if (status === "processing") return "处理中";
  if (status === "succeeded") return "已完成";
  return "失败";
}

function statusBadgeClass(status: string): string {
  if (status === "succeeded") return "bg-emerald-500/20 border-emerald-300/40 text-emerald-300";
  if (status === "failed") return "bg-red-500/20 border-red-300/40 text-red-200";
  if (status === "processing") return "bg-white/10 border-white/30 text-white";
  return "bg-white/5 border-white/20 text-white/80";
}

function modelLabel(model: "pro" | "v2"): string {
  return model === "v2" ? "v2" : "Pro";
}

function isTerminal(status: string): boolean {
  return status === "succeeded" || status === "failed";
}

function arePackTasksEqual(left: CommercePack, right: CommercePack): boolean {
  if (left.imageTasks.length !== right.imageTasks.length) return false;

  return left.imageTasks.every((task, index) => {
    const other = right.imageTasks[index];
    if (!other) return false;

    return (
      task.id === other.id &&
      task.status === other.status &&
      task.imageUrl === other.imageUrl &&
      task.error === other.error &&
      task.title === other.title &&
      task.prompt === other.prompt
    );
  });
}

function mergePackWithStableSucceededUrls(current: CommercePack, incoming: CommercePack): CommercePack {
  if (current.imageTasks.length === 0 || incoming.imageTasks.length === 0) return incoming;

  const currentByTaskId = new Map(current.imageTasks.map((task) => [task.id, task]));
  const mergedTasks = incoming.imageTasks.map((nextTask) => {
    const currentTask = currentByTaskId.get(nextTask.id);
    if (!currentTask) return nextTask;

    const shouldKeepCurrentSucceededUrl =
      currentTask.status === "succeeded" &&
      Boolean(currentTask.imageUrl) &&
      nextTask.status === "succeeded";

    if (!shouldKeepCurrentSucceededUrl) return nextTask;

    return {
      ...nextTask,
      imageUrl: currentTask.imageUrl,
    };
  });

  return {
    ...incoming,
    imageTasks: mergedTasks,
  };
}

function HelpLabel({ title, tip }: { title: string; tip: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="flex items-center gap-1 text-[11px] uppercase tracking-wide opacity-80"
        aria-label={`${title} 说明`}
      >
        <span>{title}</span>
        <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full border text-[10px] transition-colors ${open ? "border-white/70 bg-white/15" : "border-white/30"}`}>?</span>
      </button>
      {open ? (
        <div className="pointer-events-none absolute left-0 top-full z-30 mt-2 w-[240px] max-w-[min(280px,calc(100vw-48px))] rounded-xl border border-white/15 bg-[#1A242B]/98 px-3 py-2.5 text-[11px] normal-case leading-5 text-white/90 shadow-[0_10px_30px_rgba(0,0,0,0.35)] backdrop-blur-md">
          {tip}
        </div>
      ) : null}
    </div>
  );
}

function UploadZone({ zoneId, label, hint, dragOver, onPick, onDragOver, onDragLeave, onDrop }: { zoneId: string; label: string; hint?: string; dragOver: string | null; onPick: () => void; onDragOver: (e: React.DragEvent<HTMLButtonElement>, zoneId: string) => void; onDragLeave: (e: React.DragEvent<HTMLButtonElement>, zoneId: string) => void; onDrop: (e: React.DragEvent<HTMLButtonElement>, zoneId: string) => void; }) {
  const active = dragOver === zoneId;
  return (
    <button
      type="button"
      onClick={onPick}
      onDragOver={(e) => onDragOver(e, zoneId)}
      onDragLeave={(e) => onDragLeave(e, zoneId)}
      onDrop={(e) => onDrop(e, zoneId)}
      className={`w-full rounded-xl border border-dashed min-h-[168px] px-4 py-5 flex flex-col items-center justify-center gap-2 transition-colors ${active ? "border-white/80 bg-white/10" : "border-white/30 hover:bg-white/5"}`}
    >
      <Upload className="w-5 h-5" />
      <span className="text-[11px] uppercase tracking-wide">{label}</span>
      {hint ? <span className="text-[10px] text-white/45 normal-case text-center">{hint}</span> : null}
    </button>
  );
}
function PreviewCard({ title, image, onOpen, onRemove, hideMeta = false, previewUrlByRef = {} }: { title: string; image?: string | null; onOpen: (url: string) => void; onRemove?: () => void; hideMeta?: boolean; previewUrlByRef?: ImagePreviewMap; }) {
  if (!image) return null;
  return (
    <div className={hideMeta ? "" : "space-y-2"}>
      {!hideMeta ? (
        <div className="flex items-center justify-between">
          <p className="text-[11px] uppercase tracking-wide opacity-80">{title}</p>
          <p className="font-mono text-[10px] uppercase opacity-70">1/1</p>
        </div>
      ) : null}
      <div className="relative rounded-xl overflow-hidden border border-white/10">
        <button type="button" onClick={() => onOpen(resolveImagePreviewUrl(image, previewUrlByRef))} className="block w-full aspect-[3/4] bg-[#0a0f14]"><img src={resolveImagePreviewUrl(image, previewUrlByRef)} alt={title} className="w-full h-full object-cover" /></button>
        {onRemove ? <button type="button" onClick={onRemove} className="absolute top-1 right-1 px-1.5 py-0.5 rounded bg-black/60 text-[10px] border border-white/30">移除</button> : null}
      </div>
    </div>
  );
}

function ImagePreviewGrid({ title, images, onRemove, onOpen, onAdd, showAddSlot = false, maxCount = 6, addLabel = "添加图片", addZoneId, dragOver, onDragOver, onDragLeave, onDrop, previewUrlByRef = {} }: { title: string; images: string[]; onRemove: (index: number) => void; onOpen: (url: string) => void; onAdd?: () => void; showAddSlot?: boolean; maxCount?: number; addLabel?: string; addZoneId?: string; dragOver?: string | null; onDragOver?: (e: React.DragEvent<HTMLButtonElement>, zoneId: string) => void; onDragLeave?: (e: React.DragEvent<HTMLButtonElement>, zoneId: string) => void; onDrop?: (e: React.DragEvent<HTMLButtonElement>, zoneId: string) => void; previewUrlByRef?: ImagePreviewMap; }) {
  const canAdd = Boolean(showAddSlot && onAdd && images.length < maxCount && addZoneId);
  if (!images.length && !canAdd) return null;
  const addActive = canAdd && dragOver === addZoneId;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between"><p className="text-[11px] uppercase tracking-wide opacity-80">{title}</p><p className="font-mono text-[10px] uppercase opacity-70">{images.length}/{maxCount}</p></div>
      <div className="grid grid-cols-3 gap-2">
        {images.map((image, index) => (
          <div key={`${title}-${index}`} className="relative rounded-lg border border-white/10 overflow-hidden">
            <button type="button" onClick={() => onOpen(resolveImagePreviewUrl(image, previewUrlByRef))} className="block w-full aspect-[3/4] bg-[#0a0f14]"><img src={resolveImagePreviewUrl(image, previewUrlByRef)} alt={`${title}-${index + 1}`} className="w-full h-full object-cover" /></button>
            <button type="button" onClick={() => onRemove(index)} className="absolute top-1 right-1 px-1.5 py-0.5 rounded bg-black/60 text-[10px] border border-white/30">移除</button>
          </div>
        ))}
        {canAdd ? <button type="button" onClick={onAdd} onDragOver={(e) => onDragOver?.(e, addZoneId as string)} onDragLeave={(e) => onDragLeave?.(e, addZoneId as string)} onDrop={(e) => onDrop?.(e, addZoneId as string)} className={`aspect-[3/4] rounded-lg border border-dashed flex flex-col items-center justify-center gap-2 text-[11px] uppercase tracking-wide transition-colors ${addActive ? "border-white/80 bg-white/10" : "border-white/30 hover:bg-white/5"}`}><Upload className="w-4 h-4" /><span>{addLabel}</span></button> : null}
      </div>
    </div>
  );
}

function SectionToggle({ title, count, open, onToggle }: { title: string; count: number; open: boolean; onToggle: () => void; }) {
  const Icon = open ? ChevronUp : ChevronDown;
  return <button type="button" onClick={onToggle} className="w-full flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-left"><div><p className="text-[11px] uppercase tracking-wide opacity-80">{title}</p><p className="font-mono text-[10px] uppercase opacity-55 mt-1">已上传 {count} 张</p></div><Icon className="w-4 h-4 opacity-70" /></button>;
}

function GarmentInputs({ activeMode, garment, dragOver, setDragOver, openPicker, handleDrop, removeSingleImage, setField, setModal, previewUrlByRef }: any) {
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {garment.frontImage ? <PreviewCard title="正面图" image={garment.frontImage} hideMeta onOpen={(url) => setModal({ kind: "single", url: resolveImagePreviewUrl(url, previewUrlByRef) })} onRemove={() => removeSingleImage(activeMode, "frontImage")} /> : <UploadZone zoneId={`${activeMode}-front`} label="上传正面图" hint="支持点击或拖拽上传" dragOver={dragOver} onPick={() => openPicker(activeMode, "frontImage", true)} onDragOver={(e, z) => { e.preventDefault(); setDragOver(z); }} onDragLeave={(e, z) => { e.preventDefault(); setDragOver((prev: string | null) => prev === z ? null : prev); }} onDrop={(e, z) => void handleDrop(e, activeMode, "frontImage", true, z)} />}
        {garment.backImage ? <PreviewCard title="背面图" image={garment.backImage} hideMeta onOpen={(url) => setModal({ kind: "single", url: resolveImagePreviewUrl(url, previewUrlByRef) })} onRemove={() => removeSingleImage(activeMode, "backImage")} /> : <UploadZone zoneId={`${activeMode}-back`} label="上传背面图" hint="支持点击或拖拽上传" dragOver={dragOver} onPick={() => openPicker(activeMode, "backImage", true)} onDragOver={(e, z) => { e.preventDefault(); setDragOver(z); }} onDragLeave={(e, z) => { e.preventDefault(); setDragOver((prev: string | null) => prev === z ? null : prev); }} onDrop={(e, z) => void handleDrop(e, activeMode, "backImage", true, z)} />}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <select aria-label="生成模式" value={garment.generationMode} onChange={(e) => setField(activeMode, "generationMode", e.target.value)} className="bg-[#3A4A54]/30 border border-white/20 rounded-lg p-2 text-xs"><option value="smart">智能模式</option><option value="reference">参考模式</option></select>
        <select aria-label="服装主类目" value={garment.garmentMainCategory} onChange={(e) => setField(activeMode, "garmentMainCategory", e.target.value)} className="bg-[#3A4A54]/30 border border-white/20 rounded-lg p-2 text-xs">{GARMENT_MAIN.map((value) => <option key={value} value={value}>{value}</option>)}</select>
      </div>
      <textarea aria-label="补充描述" value={garment.descriptionPrompt || ""} onChange={(e) => setField(activeMode, "descriptionPrompt", e.target.value)} placeholder="补充工艺细节、轮廓、拍摄要求或修图方向（可选）" className="w-full bg-[#3A4A54]/30 border border-white/20 rounded-lg p-2 min-h-[90px] text-sm" />
      {garment.generationMode === "reference" ? <UploadZone zoneId={`${activeMode}-ref`} label="上传参考图" hint="最多 6 张" dragOver={dragOver} onPick={() => openPicker(activeMode, "referenceImages")} onDragOver={(e, z) => { e.preventDefault(); setDragOver(z); }} onDragLeave={(e, z) => { e.preventDefault(); setDragOver((prev: string | null) => prev === z ? null : prev); }} onDrop={(e, z) => void handleDrop(e, activeMode, "referenceImages", false, z)} /> : null}
    </>
  );
}

function LaunchPackInputs({ launch, dragOver, setDragOver, openPicker, handleDrop, removeArrayImage, setField, setModal, previewUrlByRef }: { launch: LaunchPackInput; dragOver: string | null; setDragOver: React.Dispatch<React.SetStateAction<string | null>>; openPicker: (mode: CommerceMode, field: UploadField, single?: boolean) => void; handleDrop: (e: React.DragEvent<HTMLButtonElement>, mode: CommerceMode, field: UploadField, single?: boolean, zoneId?: string) => Promise<void>; removeArrayImage: (mode: CommerceMode, field: UploadField, index: number) => void; setField: (mode: CommerceMode, key: string, value: unknown) => void; setModal: React.Dispatch<React.SetStateAction<ModalState | null>>; previewUrlByRef: ImagePreviewMap; }) {
  const platformTip = launch.platform === "douyin"
    ? "抖音电商模板优先强调前几页的节奏感、强卖点和高转化视觉。"
    : launch.platform === "amazon"
      ? "亚马逊模板默认按美区英文详情逻辑生成，强调结构化卖点与功能说明。"
      : "淘宝模板会优先生成更完整的详情页叙事，包含封面、卖点、细节、面料和尺码等页面。";

  return (
    <>
      <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-3 text-xs text-white/75 leading-6">
        <div className="font-mono text-[10px] uppercase tracking-widest text-white/55">系统会先分析你上传的全部商品素材，再结合平台模板与自由描述，拆成多张详情页提示词逐页出图。</div>
        <div>{platformTip}</div>
      </div>
      <HelpLabel title="商品名称" tip="只保留一个产品名称输入即可，例如羽绒服、打底衫、牛仔外套。系统会把它同时理解为商品名称和类目。" />
      <input aria-label="商品名称" value={launch.productName} onChange={(e) => setField("launch_pack", "productName", e.target.value)} placeholder="输入产品名称，例如羽绒服 / 打底衫 / 牛仔外套" className="w-full bg-[#3A4A54]/30 border border-white/20 rounded-lg p-2 text-xs" />
      <HelpLabel title="平台模板" tip="平台决定详情页的内容结构与文案语气。淘宝偏完整叙事，抖音偏高转化节奏，亚马逊偏结构化表达。" />
      <div className="grid grid-cols-3 gap-2">
        {(["taobao", "douyin", "amazon"] as const).map((platform) => (
          <button key={platform} type="button" onClick={() => setField("launch_pack", "platform", platform)} className={`rounded-lg border px-2 py-2 text-[11px] uppercase ${launch.platform === platform ? "bg-white text-[#647B8C]" : "border-white/20"}`}>{LAUNCH_PLATFORM_LABEL[platform]}</button>
        ))}
      </div>
      {launch.platform === "amazon" ? <select aria-label="亚马逊站点" value={launch.amazonMarketplace} onChange={(e) => setField("launch_pack", "amazonMarketplace", e.target.value)} className="w-full bg-[#3A4A54]/30 border border-white/20 rounded-lg p-2 text-xs"><option value="amazon_us">Amazon US / English</option></select> : null}
      <div className="grid grid-cols-2 gap-2">
        <select aria-label="目标性别" value={launch.gender} onChange={(e) => setField("launch_pack", "gender", e.target.value)} className="bg-[#3A4A54]/30 border border-white/20 rounded-lg p-2 text-xs"><option value="menswear">男装</option><option value="womenswear">女装</option><option value="unisex">中性</option></select>
        <select aria-label="目标年龄" value={launch.agePreset} onChange={(e) => setField("launch_pack", "agePreset", e.target.value)} className="bg-[#3A4A54]/30 border border-white/20 rounded-lg p-2 text-xs"><option value="adult">成人</option><option value="teen">青少年</option><option value="kids">儿童</option></select>
      </div>
      <HelpLabel title="摄影风格" tip="选择详情页整体视觉方向。系统会将其融合进逐页提示词中。" />
      <div className="grid grid-cols-2 gap-2">
        {(Object.keys(LAUNCH_PHOTO_STYLE_LABEL) as Array<LaunchPackInput["photographyStyle"]>).map((style) => (
          <button key={style} type="button" onClick={() => setField("launch_pack", "photographyStyle", style)} className={`rounded-lg border px-2 py-2 text-[11px] uppercase ${launch.photographyStyle === style ? "bg-white text-[#647B8C]" : "border-white/20"}`}>{LAUNCH_PHOTO_STYLE_LABEL[style]}</button>
        ))}
      </div>
      <HelpLabel title="输出数量" tip="系统会按你指定的张数拆解详情页。张数越多，对素材与卖点覆盖要求越高。建议 4–10 张。" />
      <div className="grid grid-cols-5 gap-2">
        {LAUNCH_COUNT_OPTIONS.map((count) => <button key={count} type="button" onClick={() => { setField("launch_pack", "requestedCount", count); setField("launch_pack", "imageTaskCount", count); }} className={`rounded-lg border px-2 py-2 text-[11px] uppercase ${launch.requestedCount === count ? "bg-white text-[#647B8C]" : "border-white/20"}`}>{count} 张</button>)}
      </div>
      <HelpLabel title="自由描述" tip="在这里直接输入卖点、风格要求、页面重点、文案语气或其他补充信息。系统会自动拆解理解，不需要逐条填写卖点。" />
      <textarea aria-label="自由描述" value={launch.descriptionPrompt || ""} onChange={(e) => setField("launch_pack", "descriptionPrompt", e.target.value)} placeholder="例如：轻薄保暖、领口贴合、不臃肿；希望前两页突出显瘦和面料质感，整体更像淘宝爆款详情页。" className="w-full bg-[#3A4A54]/30 border border-white/20 rounded-lg p-2 min-h-[96px] text-sm" />
      <HelpLabel title="商品素材池" tip="素材上传和商品素材池是同一个概念。请把你手上现有的全部商品图都传进来，系统会自动整合颜色、角度、细节图、上身图和可用于不同详情页的素材角色。" />
      {launch.referenceImages.length > 0 ? (
        <ImagePreviewGrid title="商品素材池" images={launch.referenceImages} onRemove={(i) => removeArrayImage("launch_pack", "referenceImages", i)} onOpen={(url) => setModal({ kind: "single", url: resolveImagePreviewUrl(url, previewUrlByRef), title: "商品素材图" })} onAdd={() => openPicker("launch_pack", "referenceImages")} showAddSlot addZoneId="launch-main-add" dragOver={dragOver} onDragOver={(e, z) => { e.preventDefault(); setDragOver(z); }} onDragLeave={(e, z) => { e.preventDefault(); setDragOver((prev: string | null) => prev === z ? null : prev); }} onDrop={(e, z) => void handleDrop(e, "launch_pack", "referenceImages", false, z)} addLabel="补充素材" previewUrlByRef={previewUrlByRef} />
      ) : (
        <UploadZone zoneId="launch-main" label="上传商品素材" hint="支持多图 / 多色 / 多角度，最多 6 张" dragOver={dragOver} onPick={() => openPicker("launch_pack", "referenceImages")} onDragOver={(e, z) => { e.preventDefault(); setDragOver(z); }} onDragLeave={(e, z) => { e.preventDefault(); setDragOver((prev: string | null) => prev === z ? null : prev); }} onDrop={(e, z) => void handleDrop(e, "launch_pack", "referenceImages", false, z)} />
      )}
    </>
  );
}

function CommerceWorkspace({ onRefreshProfile, previewSize, onPreviewSizeChange }: { onRefreshProfile: () => Promise<void>; previewSize: PreviewSize; onPreviewSizeChange: (next: PreviewSize) => void; }) {
  const [activeMode, setActiveMode] = useState<CommerceMode>("launch_pack");
  const [forms, setForms] = useState<Record<CommerceMode, CommerceModuleInput>>({ launch_pack: defaultForm("launch_pack"), try_on: defaultForm("try_on"), lookbook: defaultForm("lookbook"), flatlay: defaultForm("flatlay"), invisible_mannequin_3d: defaultForm("invisible_mannequin_3d") });
  const [packByMode, setPackByMode] = useState<Partial<Record<CommerceMode, CommercePack[]>>>({});
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [regenerateError, setRegenerateError] = useState<string | null>(null);
  const [pollErrors, setPollErrors] = useState<PollErrorState>({});
  const [insertedTasks, setInsertedTasks] = useState<Record<CommerceMode, ActiveTaskCard[]>>({
    launch_pack: [],
    try_on: [],
    lookbook: [],
    flatlay: [],
    invisible_mannequin_3d: [],
  });
  const [modal, setModal] = useState<ModalState | null>(null);
  const [tryOnSceneOpen, setTryOnSceneOpen] = useState(false);
  const [tryOnModelOpen, setTryOnModelOpen] = useState(false);
  const [previewUrlByRef, setPreviewUrlByRef] = useState<ImagePreviewMap>({});
  const mountedRef = useRef(true);
  const activeModeRef = useRef<CommerceMode>("launch_pack");
  const runningPackIdsRef = useRef<string[]>([]);
  const modalOpenRef = useRef(false);

  const form = forms[activeMode];
  const launch = form as Extract<CommerceModuleInput, { mode: "launch_pack" }>;
  const tryOn = form as TryOnInput;
  const lookbook = form as LookbookInput;
  const garment = form as Extract<CommerceModuleInput, { mode: "flatlay" }> | Extract<CommerceModuleInput, { mode: "invisible_mannequin_3d" }>;
  const activePacks = useMemo(() => packByMode[activeMode] ?? [], [packByMode, activeMode]);
  const mergedTasksByMode = useMemo<Record<CommerceMode, ActiveTaskCard[]>>(() => {
    const next = {} as Record<CommerceMode, ActiveTaskCard[]>;
    for (const mode of MODE_ORDER) {
      const packs = packByMode[mode] ?? [];
      const baseTasks = packs.flatMap((pack) =>
        pack.imageTasks.map((task, index) => ({
          cardId: `${pack.id}-${task.id || index}`,
          stableId: `${pack.id}-${task.id || index}`,
          resolvedId: `${pack.id}-${task.id || index}`,
          createdAt: pack.createdAt,
          title: task.title,
          prompt: task.prompt,
          aspectRatio: task.aspectRatio,
          imageSize: task.imageSize,
          imageUrl: task.imageUrl,
          status: task.status,
          model: task.model,
          error: task.error,
          referenceImages: task.referenceImages ?? [],
        })),
      );
      const localCards = insertedTasks[mode] ?? [];
      if (!localCards.length) {
        next[mode] = baseTasks;
        continue;
      }
      const hiddenIds = new Set(localCards.map((card) => card.cardId));
      next[mode] = insertTaskCardsAfter(
        baseTasks.filter((card) => !hiddenIds.has(card.cardId)),
        localCards,
      );
    }
    return next;
  }, [insertedTasks, packByMode]);
  const activeTasks = useMemo<ActiveTaskCard[]>(() => mergedTasksByMode[activeMode] ?? [], [activeMode, mergedTasksByMode]);
  const runningPackIds = useMemo(() => activePacks.filter((pack) => pack.imageTasks.some((task) => !isTerminal(task.status))).map((pack) => pack.id), [activePacks]);
  const activePollErrorCount = Object.keys(pollErrors).filter((packId) => runningPackIds.includes(packId)).length;
  const isModalOpen = modal !== null;
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  useEffect(() => { activeModeRef.current = activeMode; }, [activeMode]);
  useEffect(() => { runningPackIdsRef.current = runningPackIds; }, [runningPackIds]);
  useEffect(() => { modalOpenRef.current = isModalOpen; }, [isModalOpen]);
  useEffect(() => {
    setInsertedTasks((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const mode of MODE_ORDER) {
        const realTasks = (packByMode[mode] ?? []).flatMap((pack) =>
          pack.imageTasks.map((task, index) => ({
            cardId: `${pack.id}-${task.id || index}`,
            createdAt: pack.createdAt,
            title: task.title,
            prompt: task.prompt,
            aspectRatio: task.aspectRatio,
            imageSize: task.imageSize,
            imageUrl: task.imageUrl,
            status: task.status,
            model: task.model,
            error: task.error,
            referenceImages: task.referenceImages ?? [],
          })),
        );
        const realMap = new Map<string, ActiveTaskCard>(realTasks.map((task) => [task.cardId, task]));
        const current = prev[mode] ?? [];
        const updated = current.map((card) => {
          const real = realMap.get(card.cardId);
          return real
            ? {
                ...card,
                ...real,
                stableId: card.stableId ?? card.cardId,
                resolvedId: real.cardId,
                placeholderSourceUrl: card.placeholderSourceUrl,
                anchorCardId: card.anchorCardId,
                localOnly: true,
              }
            : card;
        });
        if (JSON.stringify(updated) !== JSON.stringify(current)) {
          next[mode] = updated;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [packByMode]);

  const pollPacks = useCallback((ids: string[], mode: CommerceMode) => {
    if (ids.length === 0) return;
    void Promise.all(
      ids.map(async (packId) => {
        try {
          const pack = await api.getCommercePack(packId);
          return { packId, pack };
        } catch (err) {
          return {
            packId,
            error: err instanceof Error ? err.message : "结果同步失败，正在重试",
          };
        }
      }),
    ).then((results) => {
      if (!mountedRef.current) return;
      const valid = results.filter((result): result is { packId: string; pack: CommercePack } => "pack" in result);
      const nextErrors: PollErrorState = {};
      for (const result of results) {
        if ("error" in result) {
          nextErrors[result.packId] = result.error;
        }
      }
      setPackByMode((prev) => {
        if (!valid.length) return prev;
        const map = new Map<string, CommercePack>(valid.map((result) => [result.pack.id, result.pack]));
        const current = prev[mode] ?? [];
        let changed = false;
        const nextModePacks = current.map((pack) => {
          const rawNextPack = map.get(pack.id);
          if (!rawNextPack) return pack;
          const nextPack = mergePackWithStableSucceededUrls(pack, rawNextPack);
          if (arePackTasksEqual(pack, nextPack)) return pack;
          changed = true;
          return nextPack;
        });
        if (!changed) return prev;
        return { ...prev, [mode]: nextModePacks };
      });
      setPollErrors((prev) => {
        const merged = { ...prev };
        for (const result of valid) {
          delete merged[result.packId];
        }
        for (const [packId, message] of Object.entries(nextErrors)) {
          merged[packId] = message;
        }
        for (const [packId] of Object.entries(merged)) {
          if (!ids.includes(packId)) {
            delete merged[packId];
          }
        }
        const prevEntries = Object.entries(prev);
        const mergedEntries = Object.entries(merged);
        if (prevEntries.length === mergedEntries.length && prevEntries.every(([key, value]) => merged[key] === value)) {
          return prev;
        }
        return merged;
      });
    });
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const ids = runningPackIdsRef.current;
      const mode = activeModeRef.current;
      if (modalOpenRef.current) return;
      if (ids.length === 0) return;
      pollPacks(ids, mode);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [pollPacks]);

  useEffect(() => {
    if (isModalOpen) return;
    const ids = runningPackIdsRef.current;
    const mode = activeModeRef.current;
    if (ids.length === 0) return;
    pollPacks(ids, mode);
  }, [isModalOpen, pollPacks]);

  const cyclePreviewSize = useCallback(() => { const i = PREVIEW_SIZE_ORDER.indexOf(previewSize); onPreviewSizeChange(PREVIEW_SIZE_ORDER[(i + 1) % PREVIEW_SIZE_ORDER.length]); }, [onPreviewSizeChange, previewSize]);
  const setField = useCallback((mode: CommerceMode, key: string, value: unknown) => setForms((prev) => ({ ...prev, [mode]: { ...prev[mode], [key]: value } as CommerceModuleInput })), []);
  const pushImages = useCallback((mode: CommerceMode, field: UploadField, urls: string[], single = false) => setForms((prev) => { const next = { ...(prev[mode] as Record<string, unknown>) }; next[field] = single ? urls[0] ?? next[field] : dedupe([...(Array.isArray(next[field]) ? next[field] as string[] : []), ...urls]); return { ...prev, [mode]: next as unknown as CommerceModuleInput }; }), []);
  const addFiles = useCallback(async (mode: CommerceMode, field: UploadField, files: File[], single = false) => {
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (!images.length) return setError("仅支持图片文件");
    try {
      const uploaded = await api.uploadImages(images);
      setPreviewUrlByRef((prev) => ({ ...prev, ...buildPreviewMapFromUploads(uploaded) }));
      pushImages(mode, field, uploaded.map((item) => item.ref), single);
    } catch (error) {
      setError(error instanceof Error ? error.message : "上传图片失败");
    }
  }, [pushImages]);
  const openPicker = useCallback((mode: CommerceMode, field: UploadField, single = false) => { const input = document.createElement("input"); input.type = "file"; input.accept = "image/*"; input.multiple = !single; input.onchange = () => void addFiles(mode, field, Array.from(input.files ?? []) as File[], single); input.click(); }, [addFiles]);
  const handleDrop = useCallback(async (e: React.DragEvent<HTMLButtonElement>, mode: CommerceMode, field: UploadField, single = false, zoneId?: string) => { e.preventDefault(); if (zoneId) setDragOver((prev) => prev === zoneId ? null : prev); const files = Array.from(e.dataTransfer.files ?? []) as File[]; if (!files.length) return; await addFiles(mode, field, files, single); }, [addFiles]);
  const removeArrayImage = useCallback((mode: CommerceMode, field: UploadField, index: number) => setForms((prev) => { const next = { ...(prev[mode] as Record<string, unknown>) }; const list = [...(Array.isArray(next[field]) ? next[field] as string[] : [])]; list.splice(index, 1); next[field] = list; return { ...prev, [mode]: next as unknown as CommerceModuleInput }; }), []);
  const removeSingleImage = useCallback((mode: CommerceMode, field: UploadField) => setForms((prev) => ({ ...prev, [mode]: { ...prev[mode], [field]: null } as CommerceModuleInput })), []);
  const insertPack = useCallback((mode: CommerceMode, pack: CommercePack) => setPackByMode((prev) => ({ ...prev, [mode]: [pack, ...(prev[mode] ?? []).filter((item) => item.id !== pack.id)] })), []);
  const appendInsertedTasks = useCallback((mode: CommerceMode, cards: ActiveTaskCard[]) => {
    if (!cards.length) return;
    setInsertedTasks((prev) => ({ ...prev, [mode]: [...(prev[mode] ?? []), ...cards] }));
  }, []);
  const removeInsertedTasksByIds = useCallback((mode: CommerceMode, cardIds: string[]) => {
    if (!cardIds.length) return;
    setInsertedTasks((prev) => ({
      ...prev,
      [mode]: (prev[mode] ?? []).filter((card) => !cardIds.includes(card.cardId)),
    }));
  }, []);

  const normalizeInput = useCallback((mode: CommerceMode, baseForm: CommerceModuleInput): CommerceModuleInput => {
    if (mode === "launch_pack") {
      const input = baseForm as LaunchPackInput;
      const requestedCount = LAUNCH_COUNT_OPTIONS.includes(input.requestedCount as typeof LAUNCH_COUNT_OPTIONS[number]) ? input.requestedCount : 4;
      return { ...input, productName: input.productName.trim(), descriptionPrompt: input.descriptionPrompt?.trim() || undefined, requestedCount, imageTaskCount: requestedCount };
    }
    if (mode === "try_on") {
      const input = baseForm as TryOnInput;
      const count = input.sceneReferenceImages.length;
      return {
        ...input,
        descriptionPrompt: input.descriptionPrompt?.trim() || undefined,
        imageTaskCount: Math.max(1, Math.min(6, Number(count) || 1)),
        useModelReference: input.modelReferenceImages.length > 0,
        useSceneAsTextReference: input.useSceneAsTextReference === true,
      };
    }
    if (mode === "lookbook") {
      const input = baseForm as LookbookInput;
      const lookbookMode: LookbookMode = input.lookbookMode === "count_input" ? "count_input" : "angle_preset";
      const selectedAngles = Array.from(new Set((input.selectedAngles || []).filter((angle): angle is LookbookAngle => angle === "front" || angle === "side" || angle === "back")));
      if (lookbookMode === "count_input") {
        const count = Math.max(1, Math.min(6, Number(input.requestedCount) || 1));
        return { ...input, lookbookMode, requestedCount: count, imageTaskCount: count, selectedAngles: [] };
      }
      const count = Math.max(1, selectedAngles.length || 1);
      return { ...input, lookbookMode, requestedCount: count, imageTaskCount: count, selectedAngles: selectedAngles.length > 0 ? selectedAngles : ["front"] };
    }
    if (mode === "flatlay" || mode === "invisible_mannequin_3d") return { ...(baseForm as typeof garment), imageTaskCount: Math.max(1, Math.min(6, Number((baseForm as typeof garment).imageTaskCount) || 1)) };
    return baseForm;
  }, [garment]);

  const validate = useCallback((mode: CommerceMode, target: CommerceModuleInput) => {
    if (mode === "launch_pack") { const input = target as LaunchPackInput; if (!input.productName) return "服装详情页需要填写商品名称"; if (!input.referenceImages.length) return "服装详情页至少需要 1 张商品素材图"; return null; }
    if (mode === "try_on") { const input = target as TryOnInput; if (!input.productImages.length) return "试穿至少需要 1 张服装图"; if (!input.sceneReferenceImages.length) return "试穿至少需要 1 张场景参考图"; return null; }
    if (mode === "lookbook") { const input = target as LookbookInput; if (!input.baseModelImage) return "Lookbook 需要 1 张基础模特图"; return null; }
    const input = target as typeof garment; if (!input.frontImage && !input.backImage) return "请至少上传一张：正面或背面"; if (input.generationMode === "reference" && !input.referenceImages.length) return "参考模式至少需要 1 张参考图"; return null;
  }, [garment, launch]);

  const submitPack = useCallback(async (mode: CommerceMode, baseForm: CommerceModuleInput, editMode = false) => {
    const input = normalizeInput(mode, baseForm);
    const validation = validate(mode, input);
    if (validation) throw new Error(validation);

    const placeholderIds = !editMode
      ? (() => {
          const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const placeholders = buildPendingTaskCards(mode, input, requestId);
          appendInsertedTasks(mode, placeholders);
          return placeholders.map((card) => card.cardId);
        })()
      : [];

    try {
      const created = await api.generateCommercePack({ mode, input, editMode } as CommerceGenerateRequest);
      const pack = created.pack ?? await api.getCommercePack(created.packId);
      insertPack(mode, pack);
      await onRefreshProfile();
      return pack;
    } finally {
      removeInsertedTasksByIds(mode, placeholderIds);
    }
  }, [appendInsertedTasks, insertPack, normalizeInput, onRefreshProfile, removeInsertedTasksByIds, validate]);
  const submit = async () => { setError(""); setIsSubmitting(true); try { await submitPack(activeMode, form); } catch (err) { setError(err instanceof Error ? err.message : "创建任务失败"); } finally { if (mountedRef.current) setIsSubmitting(false); } };
  const handleRegenerate = useCallback(async ({ prompt, referenceImages, model, imageSize, aspectRatio }: { prompt: string; referenceImages: string[]; model: "pro" | "v2"; imageSize: string; aspectRatio: string }) => {
    const targetMode = modal?.kind === "gallery" ? modal.mode : activeMode;
    const targetForm = forms[targetMode];
    const anchorCardId = modal?.kind === "gallery" ? modal.selectedCardId : null;
    const anchorCard = modal?.kind === "gallery" ? activeTasks.find((task) => task.cardId === modal.selectedCardId) ?? null : null;
    const nextPrompt = prompt.trim() || undefined;
    const mergedRefs = dedupe(referenceImages);
    let nextInput: CommerceModuleInput;

    if (targetMode === "launch_pack") {
      const input = targetForm as LaunchPackInput;
      nextInput = {
        ...input,
        model,
        imageSize,
        aspectRatio,
        requestedCount: 1,
        imageTaskCount: 1,
        descriptionPrompt: nextPrompt,
        referenceImages: mergedRefs,
      };
    } else if (targetMode === "try_on") {
      const input = targetForm as TryOnInput;
      nextInput = {
        ...input,
        model,
        imageSize,
        aspectRatio,
        imageTaskCount: 1,
        descriptionPrompt: nextPrompt,
        referenceImages: mergedRefs,
      };
    } else if (targetMode === "lookbook") {
      const input = targetForm as LookbookInput;
      nextInput = {
        ...input,
        model,
        imageSize,
        aspectRatio,
        requestedCount: 1,
        imageTaskCount: 1,
        descriptionPrompt: nextPrompt,
        referenceImages: mergedRefs,
      };
    } else {
      const input = targetForm as Extract<CommerceModuleInput, { mode: "flatlay" }> | Extract<CommerceModuleInput, { mode: "invisible_mannequin_3d" }>;
      nextInput = {
        ...input,
        model,
        imageSize,
        aspectRatio,
        imageTaskCount: 1,
        descriptionPrompt: nextPrompt,
        referenceImages: mergedRefs,
      } as CommerceModuleInput;
    }

    setIsRegenerating(true);
    setRegenerateError(null);
    try {
      const pack = await submitPack(targetMode, nextInput, true);
      if (anchorCardId && anchorCard) {
        const nextCards = pack.imageTasks.map((task, index) => ({
          cardId: `${pack.id}-${task.id || index}`,
          stableId: `${pack.id}-${task.id || index}`,
          resolvedId: `${pack.id}-${task.id || index}`,
          createdAt: pack.createdAt,
          title: task.title,
          prompt: task.prompt,
          aspectRatio: task.aspectRatio,
          imageSize: task.imageSize,
          imageUrl: task.imageUrl,
          placeholderSourceUrl: anchorCard.imageUrl ?? anchorCard.placeholderSourceUrl ?? null,
          anchorCardId,
          localOnly: true,
          status: task.status,
          model: task.model,
          error: task.error,
          referenceImages: task.referenceImages ?? mergedRefs,
        }));
        setInsertedTasks((prev) => ({
          ...prev,
          [targetMode]: [...(prev[targetMode] ?? []), ...nextCards],
        }));
        if (nextCards[0]) {
          setModal({ kind: "gallery", mode: targetMode, selectedCardId: nextCards[0].cardId });
        }
      }
    } catch (err) {
      setRegenerateError(err instanceof Error ? err.message : "提交重生成失败");
    } finally {
      if (mountedRef.current) setIsRegenerating(false);
    }
  }, [activeMode, activeTasks, forms, modal, submitPack]);

  const modalGalleryItems = useMemo(() => {
    if (!modal || modal.kind !== "gallery") return [];
    const tasks = mergedTasksByMode[modal.mode] ?? [];
    return tasks
      .filter((task) => Boolean(task.imageUrl || task.placeholderSourceUrl))
      .map((task) => ({
        id: task.cardId,
        stableId: task.stableId ?? task.cardId,
        resolvedId: task.resolvedId ?? task.cardId,
        url: (task.imageUrl ?? task.placeholderSourceUrl) as string,
        title: task.title,
        prompt: task.prompt,
        model: task.model,
        imageSize: task.imageSize,
        aspectRatio: task.aspectRatio,
        referenceImages: task.referenceImages ?? [],
        mode: modal.mode,
        status: task.status as "queued" | "processing" | "succeeded" | "failed",
        error: task.error,
      }));
  }, [mergedTasksByMode, modal]);

  const modalSelectedIndex = useMemo(() => {
    if (!modal || modal.kind !== "gallery") return 0;
    const index = modalGalleryItems.findIndex((item) => item.id === modal.selectedCardId);
    return index >= 0 ? index : 0;
  }, [modal, modalGalleryItems]);
  const modalSelectedItem = useMemo(() => {
    if (!modal || modal.kind !== "gallery") return null;
    return modalGalleryItems.find((item) => item.id === modal.selectedCardId) ?? null;
  }, [modal, modalGalleryItems]);
  const switchLookbookMode = (mode: LookbookMode) => {
    if (mode === "count_input") {
      const count = Math.max(1, Math.min(6, Number(lookbook.requestedCount) || 1));
      setField("lookbook", "lookbookMode", "count_input");
      setField("lookbook", "selectedAngles", []);
      setField("lookbook", "requestedCount", count);
      setField("lookbook", "imageTaskCount", count);
      return;
    }
    const fallbackAngles = (lookbook.selectedAngles || []).length > 0 ? lookbook.selectedAngles : ["front", "side", "back"];
    const selectedAngles = Array.from(new Set(fallbackAngles.filter((item): item is LookbookAngle => item === "front" || item === "side" || item === "back")));
    setField("lookbook", "lookbookMode", "angle_preset");
    setField("lookbook", "selectedAngles", selectedAngles);
    setField("lookbook", "requestedCount", Math.max(1, selectedAngles.length || 1));
    setField("lookbook", "imageTaskCount", Math.max(1, selectedAngles.length || 1));
  };
  const toggleLookbookAngle = (angle: LookbookAngle) => {
    const current = Array.from(new Set((lookbook.selectedAngles || []).filter((item): item is LookbookAngle => item === "front" || item === "side" || item === "back")));
    const next = current.includes(angle)
      ? (current.length > 1 ? current.filter((item) => item !== angle) : current)
      : [...current, angle];
    setField("lookbook", "lookbookMode", "angle_preset");
    setField("lookbook", "selectedAngles", next);
    setField("lookbook", "requestedCount", Math.max(1, next.length || 1));
    setField("lookbook", "imageTaskCount", Math.max(1, next.length || 1));
  };
  const handleLookbookCountChange = (countRaw: number) => {
    const count = Math.max(1, Math.min(6, Number(countRaw) || 1));
    setField("lookbook", "lookbookMode", "count_input");
    setField("lookbook", "selectedAngles", []);
    setField("lookbook", "requestedCount", count);
    setField("lookbook", "imageTaskCount", count);
  };

  const activeCount = activeTasks.filter((task) => !isTerminal(task.status)).length;
  const queuedCount = activeTasks.filter((task) => task.status === "queued").length;
  const processingCount = activeTasks.filter((task) => task.status === "processing").length;
  return (
    <div className="w-full h-full min-h-0 flex flex-col overflow-hidden p-4 md:p-6 xl:p-8">
      <header className="mb-5 shrink-0"><h1 className="font-display text-4xl md:text-5xl uppercase mb-2">商业工作台</h1><p className="font-mono text-xs opacity-60 uppercase tracking-widest">[ Fashion Commerce Workspace ]</p></header>
      <div className="mb-4 flex flex-wrap gap-2 shrink-0">{MODE_ORDER.map((mode) => <button key={mode} onClick={() => { setActiveMode(mode); setError(""); setRegenerateError(null); }} className={`px-3 py-2 rounded-lg border font-mono text-[11px] uppercase ${activeMode === mode ? "bg-white text-[#647B8C]" : "border-white/20 hover:bg-white/10"}`}>{MODE_LABEL[mode]}</button>)}</div>
      {error ? <div className="mb-4 p-3 border rounded-lg text-xs bg-red-500/20 border-red-300/40 text-red-200 shrink-0">{error}</div> : null}
      <div className="min-h-0 flex-1 grid grid-cols-1 xl:grid-cols-12 gap-5 overflow-hidden">
        <section className="xl:col-span-4 2xl:col-span-3 min-h-0 flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#3A4A54]/20 workspace-scroll-lock">
          <div className="sticky top-0 z-10 border-b border-white/10 bg-[#202d35]/95 px-4 py-4"><div className="flex items-start justify-between gap-4"><div><h3 className="font-display text-xl uppercase">{MODE_LABEL[activeMode]}</h3></div><button onClick={() => void submit()} disabled={isSubmitting} className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-3 font-mono text-xs uppercase text-[#647B8C] disabled:opacity-60">{isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}{isSubmitting ? "提交中..." : "开始生成"}</button></div></div>
          <div className="min-h-0 flex-1 overflow-y-auto workspace-scroll-area p-4 space-y-4">
            {activeMode === "launch_pack" ? <LaunchPackInputs launch={launch} dragOver={dragOver} setDragOver={setDragOver} openPicker={openPicker} handleDrop={handleDrop} removeArrayImage={removeArrayImage} setField={setField} setModal={setModal} previewUrlByRef={previewUrlByRef} /> : null}
            {activeMode === "try_on" ? (
              <>
                <ImagePreviewGrid
                  title="服装图"
                  images={tryOn.productImages}
                  onRemove={(i) => removeArrayImage(activeMode, "productImages", i)}
                  onOpen={(url) => setModal({ kind: "single", url: resolveImagePreviewUrl(url, previewUrlByRef) })}
                  onAdd={() => openPicker(activeMode, "productImages")}
                  showAddSlot
                  previewUrlByRef={previewUrlByRef}
                  addZoneId="try-product-add"
                  dragOver={dragOver}
                  onDragOver={(e, z) => {
                    e.preventDefault();
                    setDragOver(z);
                  }}
                  onDragLeave={(e, z) => {
                    e.preventDefault();
                    setDragOver((prev) => prev === z ? null : prev);
                  }}
                  onDrop={(e, z) => void handleDrop(e, activeMode, "productImages", false, z)}
                />
                <textarea
                  aria-label="试穿补充描述"
                  value={tryOn.descriptionPrompt || ""}
                  onChange={(e) => setField(activeMode, "descriptionPrompt", e.target.value)}
                  placeholder="描述服装细节、穿搭方向或背景要求（可选）"
                  className="w-full bg-[#3A4A54]/30 border border-white/20 rounded-lg p-2 min-h-[88px] text-sm"
                />
                <div className="grid grid-cols-2 gap-2">
                  <select
                    aria-label="试穿目标性别"
                    value={tryOn.genderCategory}
                    onChange={(e) => setField(activeMode, "genderCategory", e.target.value)}
                    className="bg-[#3A4A54]/30 border border-white/20 rounded-lg p-2 text-xs"
                  >
                    <option value="menswear">男装</option>
                    <option value="womenswear">女装</option>
                    <option value="unisex">中性</option>
                  </select>
                  <select
                    aria-label="试穿目标年龄"
                    value={tryOn.ageGroup}
                    onChange={(e) => setField(activeMode, "ageGroup", e.target.value)}
                    className="bg-[#3A4A54]/30 border border-white/20 rounded-lg p-2 text-xs"
                  >
                    <option value="adult">成人</option>
                    <option value="teen">青少年</option>
                    <option value="older_kids">大童</option>
                    <option value="middle_kids">中童</option>
                    <option value="younger_kids">小童</option>
                    <option value="toddlers">幼童</option>
                  </select>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-white/70 leading-6">
                  系统会用你上传的服装图替换参考人物当前穿着。上传场景参考图时优先复用场景、构图与姿态；上传模特参考图时优先复用人物身份；两类都不传时会随机生成适合该服装展示的环境。
                </div>
                <SectionToggle
                  title="场景参考图"
                  count={tryOn.sceneReferenceImages.length}
                  open={tryOnSceneOpen}
                  onToggle={() => setTryOnSceneOpen((prev) => !prev)}
                />
                {tryOnSceneOpen ? (
                  <>
                    <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-mono text-[10px] uppercase tracking-widest text-white/65">场景图使用方式</p>
                          <p className="mt-1 text-xs text-white/55 leading-5">
                            开启后会先结合产品图反推替换后的场景提示词，再去生图；场景图本身不再直接传给生图模型。
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setField(activeMode, "useSceneAsTextReference", !tryOn.useSceneAsTextReference)}
                          className={`shrink-0 rounded-lg border px-3 py-2 font-mono text-[11px] uppercase transition-colors ${
                            tryOn.useSceneAsTextReference
                              ? "bg-white text-[#647B8C]"
                              : "border-white/20 text-white/75 hover:bg-white/10"
                          }`}
                        >
                          仅作为文本参考
                        </button>
                      </div>
                      <div className="rounded-lg border border-white/10 bg-black/10 px-3 py-2 text-[11px] leading-5 text-white/55">
                        {tryOn.sceneReferenceImages.length > 0
                          ? tryOn.useSceneAsTextReference
                            ? "当前已开启：会先让语言模型读取场景图和产品图，直接描述替换后的最终画面。"
                            : "当前已关闭：场景参考图会继续直接作为生图参考图输入模型。"
                          : "当前没有上传场景参考图；开启后也不会生效，直到你上传场景图。"}
                      </div>
                    </div>
                    <ImagePreviewGrid
                      title="场景参考图"
                      images={tryOn.sceneReferenceImages}
                      onRemove={(i) => removeArrayImage(activeMode, "sceneReferenceImages", i)}
                      onOpen={(url) => setModal({ kind: "single", url: resolveImagePreviewUrl(url, previewUrlByRef) })}
                      onAdd={() => openPicker(activeMode, "sceneReferenceImages")}
                      showAddSlot
                      previewUrlByRef={previewUrlByRef}
                      addZoneId="try-scene-add"
                      dragOver={dragOver}
                      onDragOver={(e, z) => {
                        e.preventDefault();
                        setDragOver(z);
                      }}
                      onDragLeave={(e, z) => {
                        e.preventDefault();
                        setDragOver((prev) => prev === z ? null : prev);
                      }}
                      onDrop={(e, z) => void handleDrop(e, activeMode, "sceneReferenceImages", false, z)}
                    />
                  </>
                ) : null}
                <SectionToggle
                  title="模特参考图"
                  count={tryOn.modelReferenceImages.length}
                  open={tryOnModelOpen}
                  onToggle={() => setTryOnModelOpen((prev) => !prev)}
                />
                {tryOnModelOpen ? (
                  <ImagePreviewGrid
                    title="模特参考图"
                    images={tryOn.modelReferenceImages}
                    onRemove={(i) => removeArrayImage(activeMode, "modelReferenceImages", i)}
                    onOpen={(url) => setModal({ kind: "single", url: resolveImagePreviewUrl(url, previewUrlByRef) })}
                    onAdd={() => openPicker(activeMode, "modelReferenceImages")}
                    showAddSlot
                    previewUrlByRef={previewUrlByRef}
                    addZoneId="try-model-add"
                    dragOver={dragOver}
                    onDragOver={(e, z) => {
                      e.preventDefault();
                      setDragOver(z);
                    }}
                    onDragLeave={(e, z) => {
                      e.preventDefault();
                      setDragOver((prev) => prev === z ? null : prev);
                    }}
                    onDrop={(e, z) => void handleDrop(e, activeMode, "modelReferenceImages", false, z)}
                  />
                ) : null}
              </>
            ) : null}
            {activeMode === "lookbook" ? (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {lookbook.baseModelImage ? (
                    <PreviewCard title="基础模特图" image={lookbook.baseModelImage} previewUrlByRef={previewUrlByRef} onOpen={(url) => setModal({ kind: "single", url: resolveImagePreviewUrl(url, previewUrlByRef) })} onRemove={() => removeSingleImage(activeMode, "baseModelImage")} />
                  ) : (
                    <UploadZone zoneId="lookbook-base" label="上传基础模特图" hint="1 张即可；系统会据此生成多动作图" dragOver={dragOver} onPick={() => openPicker(activeMode, "baseModelImage", true)} onDragOver={(e, z) => { e.preventDefault(); setDragOver(z); }} onDragLeave={(e, z) => { e.preventDefault(); setDragOver((prev) => prev === z ? null : prev); }} onDrop={(e, z) => void handleDrop(e, activeMode, "baseModelImage", true, z)} />
                  )}
                  {lookbook.backReferenceImage ? (
                    <PreviewCard title="产品背面参考图（可选）" image={lookbook.backReferenceImage} previewUrlByRef={previewUrlByRef} onOpen={(url) => setModal({ kind: "single", url: resolveImagePreviewUrl(url, previewUrlByRef) })} onRemove={() => removeSingleImage(activeMode, "backReferenceImage")} />
                  ) : (
                    <UploadZone zoneId="lookbook-back-ref" label="上传产品背面参考图（可选）" hint="仅在背面任务中引用" dragOver={dragOver} onPick={() => openPicker(activeMode, "backReferenceImage", true)} onDragOver={(e, z) => { e.preventDefault(); setDragOver(z); }} onDragLeave={(e, z) => { e.preventDefault(); setDragOver((prev) => prev === z ? null : prev); }} onDrop={(e, z) => void handleDrop(e, activeMode, "backReferenceImage", true, z)} />
                  )}
                </div>
                <textarea aria-label="Lookbook 补充描述" value={lookbook.descriptionPrompt || ""} onChange={(e) => setField(activeMode, "descriptionPrompt", e.target.value)} placeholder="补充动作风格、镜头要求、场景方向（可选）" className="w-full bg-[#3A4A54]/30 border border-white/20 rounded-lg p-2 min-h-[88px] text-sm" />
                <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => switchLookbookMode("angle_preset")} className={`rounded-lg border px-3 py-2 text-[11px] uppercase ${lookbook.lookbookMode !== "count_input" ? "bg-white text-[#647B8C]" : "border-white/20"}`}>
                      角度预设
                    </button>
                    <button type="button" onClick={() => switchLookbookMode("count_input")} className={`rounded-lg border px-3 py-2 text-[11px] uppercase ${lookbook.lookbookMode === "count_input" ? "bg-white text-[#647B8C]" : "border-white/20"}`}>
                      输入数量
                    </button>
                  </div>
                  {lookbook.lookbookMode === "count_input" ? (
                    <input aria-label="Lookbook 输出数量" type="number" min={1} max={6} value={lookbook.requestedCount} onChange={(e) => handleLookbookCountChange(Number(e.target.value))} className="w-full bg-[#3A4A54]/30 border border-white/20 rounded-lg p-2 text-xs" />
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      {LOOKBOOK_ANGLE_OPTIONS.map((item) => {
                        const selected = (lookbook.selectedAngles || []).includes(item.value);
                        return (
                          <button key={item.value} type="button" onClick={() => toggleLookbookAngle(item.value)} className={`rounded-lg border px-2 py-2 text-[11px] uppercase ${selected ? "bg-white text-[#647B8C]" : "border-white/20"}`}>
                            {item.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            ) : null}
            {(activeMode === "flatlay" || activeMode === "invisible_mannequin_3d") ? <GarmentInputs activeMode={activeMode} garment={garment} dragOver={dragOver} setDragOver={setDragOver} openPicker={openPicker} handleDrop={handleDrop} removeSingleImage={removeSingleImage} setField={setField} setModal={setModal} previewUrlByRef={previewUrlByRef} /> : null}
            <HelpLabel title="模型" tip="选择图像模型。Pro 更稳，v2 通常更快。" />
            <select aria-label="模型" value={form.model} onChange={(e) => setField(activeMode, "model", e.target.value)} className="w-full bg-[#3A4A54]/30 border border-white/20 rounded-lg p-2 text-xs"><option value="pro">Pro</option><option value="v2">v2</option></select>
            <HelpLabel title="图像尺寸" tip="输出分辨率等级：1K / 2K / 4K。" />
            <select aria-label="图像尺寸" value={form.imageSize} onChange={(e) => setField(activeMode, "imageSize", e.target.value)} className="w-full bg-[#3A4A54]/30 border border-white/20 rounded-lg p-2 text-xs"><option value="1K">1K</option><option value="2K">2K</option><option value="4K">4K</option></select>
            <HelpLabel title="宽高比" tip="输出宽高比，例如 3:4 竖图。" />
            <select aria-label="宽高比" value={form.aspectRatio} onChange={(e) => setField(activeMode, "aspectRatio", e.target.value)} className="w-full bg-[#3A4A54]/30 border border-white/20 rounded-lg p-2 text-xs">{ASPECT_RATIO_OPTIONS.map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}</select>
          </div>
        </section>
        <section className="xl:col-span-8 2xl:col-span-9 min-h-0 flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#3A4A54]/10 relative workspace-scroll-lock">
          <div className="relative z-10 min-h-0 h-full flex flex-col">
              <div className="sticky top-0 z-10 px-4 md:px-6 py-4 border-b border-white/10 flex items-center justify-between gap-4 bg-[#162028]/95">
              <div>
                <h3 className="font-display text-2xl uppercase">任务队列</h3>
                <p className="font-mono text-[10px] uppercase opacity-60 tracking-widest">点击结果图可放大 / 编辑重生成</p>
              </div>
              {activePollErrorCount > 0 ? <p className="font-mono text-[10px] uppercase text-orange-200/90 tracking-wide">结果同步失败，正在重试…</p> : null}
              <div className="font-mono text-[10px] uppercase opacity-70 text-right">
                <div>活跃: {activeCount}</div>
                <div>排队: {queuedCount}</div>
                <div>处理中: {processingCount}</div>
                <button onClick={cyclePreviewSize} className="mt-2 px-2 py-1 rounded-md border border-white/30 hover:bg-white/10">预览：{PREVIEW_SIZE_LABEL[previewSize]}</button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto workspace-scroll-area p-4 md:p-6">
              {activeTasks.length === 0 ? (
                <div className="h-full min-h-[420px] flex flex-col items-center justify-center gap-4 opacity-35">
                  <ImageIcon className="w-16 h-16" />
                  <p className="font-mono text-xs uppercase tracking-widest text-center max-w-xs">等待输入。<br />生成结果会显示在这里。</p>
                </div>
              ) : (
                <div className={`grid ${PREVIEW_GRID_GAP_CLASS}`} style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${PREVIEW_SIZE_MIN_CARD_WIDTH[previewSize]}, 1fr))` }}>
                  {activeTasks.map((task) => (
                    <div key={task.cardId} className="group render-isolate bg-[#3A4A54]/20 border border-white/10 rounded-lg overflow-hidden hover:border-white/30 transition-colors flex flex-col">
                      <div className="aspect-[3/4] relative overflow-hidden bg-[#0a0f14]">
                        {task.status === "succeeded" && task.imageUrl ? (
                          <img src={task.imageUrl} alt={task.title || "generated"} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.02] cursor-zoom-in" referrerPolicy="no-referrer" loading="lazy" decoding="async" onClick={() => { setRegenerateError(null); setModal({ kind: "gallery", mode: activeMode, selectedCardId: task.cardId }); }} />
                        ) : task.status === "succeeded" && !task.imageUrl ? (
                          <div className="w-full h-full p-3 flex items-center justify-center text-center"><p className="font-mono text-[10px] uppercase text-amber-200">结果已完成，图片链接同步中</p></div>
                        ) : task.status === "failed" ? (
                          <div className="w-full h-full p-3 flex items-center justify-center text-center"><p className="font-mono text-[10px] uppercase text-red-200">{task.error ?? "生成失败"}</p></div>
                        ) : task.placeholderSourceUrl ? (
                          <>
                            <img src={task.placeholderSourceUrl} alt={task.title || "generating"} className="w-full h-full scale-[1.02] object-cover blur-sm opacity-60" referrerPolicy="no-referrer" />
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/25"><Loader2 className="w-5 h-5 animate-spin" /><p className="font-mono text-[10px] uppercase tracking-widest text-center px-3">生成中</p></div>
                          </>
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center gap-2 opacity-70"><Loader2 className="w-5 h-5 animate-spin" /><p className="font-mono text-[10px] uppercase tracking-widest text-center px-3">{task.status === "queued" ? "排队中..." : "生成中..."}</p></div>
                        )}
                        <div className="absolute top-2 left-2 flex items-center gap-2"><span className={`px-2 py-1 rounded-full border font-mono text-[10px] uppercase tracking-widest bg-black/55 ${statusBadgeClass(task.status)}`}>{statusLabel(task.status)}</span><span className="px-2 py-1 rounded-full border border-white/30 bg-black/40 font-mono text-[10px] uppercase tracking-widest">{modelLabel(task.model)}</span></div>
                        {task.status === "succeeded" && task.imageUrl ? <div className="absolute inset-x-2 bottom-2 rounded-md bg-black/55 px-2 py-1 text-[10px] uppercase tracking-widest text-white/85 text-center border border-white/10">点击放大 / 编辑重生成</div> : null}
                      </div>
                      <div className="p-2.5 flex-1 flex flex-col justify-between gap-2"><div className="space-y-1"><p className="font-mono text-[10px] uppercase tracking-wide text-white/75 line-clamp-1" title={task.title || "未命名页面"}>{task.title || "未命名页面"}</p><p className="font-sans text-xs line-clamp-2 opacity-80" title={task.prompt || task.title || "未填写提示词"}>{task.prompt || task.title || "未填写提示词"}</p></div><div className="flex items-center justify-between gap-2 font-mono text-[9px] uppercase opacity-50"><span>{new Date(task.createdAt).toLocaleString()}</span><span>{task.referenceImages.length > 0 ? `参考图 ${task.referenceImages.length}` : "无参考图"}</span></div></div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
      {modal && (modal.kind === "single" || modalSelectedItem) ? <ImageModal url={modal.kind === "single" ? modal.url : modalSelectedItem!.url} title={modal.kind === "single" ? modal.title : modalSelectedItem!.title} prompt={modal.kind === "single" ? modal.prompt : modalSelectedItem!.prompt} mode={modal.kind === "single" ? modal.mode : modal.mode} referenceImages={modal.kind === "single" ? modal.referenceImages : modalSelectedItem!.referenceImages} items={modal.kind === "gallery" ? modalGalleryItems : undefined} selectedIndex={modal.kind === "gallery" ? modalSelectedIndex : undefined} onSelect={modal.kind === "gallery" ? (index) => { const item = modalGalleryItems[index]; if (item) { setRegenerateError(null); setModal({ kind: "gallery", mode: modal.mode, selectedCardId: item.id }); } } : undefined} isSubmitting={isRegenerating} error={regenerateError} onRegenerate={modal.kind === "gallery" ? handleRegenerate : undefined} onClose={() => { setModal(null); setRegenerateError(null); }} /> : null}
    </div>
  );
}

export default CommerceWorkspace;
