import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import { api } from "../lib/api";
import { downloadImageFile } from "../lib/download";
import {
  buildPreviewMapFromUploads,
  MAX_UPLOADED_IMAGE_COUNT,
  resolveImagePreviewUrl,
  type ImagePreviewMap,
} from "../lib/imageUploads";
import type { GenerationLane, ImageModel } from "../types";

const COMMON_ASPECT_RATIO_PRESETS = ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3"] as const;
const ASPECT_RATIO_PRESETS_BY_MODEL: Record<ImageModel, readonly string[]> = {
  v2: [...COMMON_ASPECT_RATIO_PRESETS, "1:4", "4:1", "1:8", "8:1"],
  pro: COMMON_ASPECT_RATIO_PRESETS,
};
const IMAGE_SIZE_OPTIONS = ["1K", "2K", "4K"] as const;

type GalleryItem = {
  id: string;
  stableId?: string;
  resolvedId?: string;
  url: string;
  title?: string;
  prompt?: string;
  model?: ImageModel;
  imageSize?: string;
  aspectRatio?: string;
  referenceImages?: string[];
  mode?: GenerationLane;
  status?: "submitting" | "queued" | "processing" | "succeeded" | "failed";
  error?: string | null;
};

interface ImageModalProps {
  url: string;
  title?: string;
  prompt?: string;
  onClose: () => void;
  returnFocusElement?: HTMLElement | null;
  showEditor?: boolean;
  mode?: GenerationLane;
  model?: ImageModel;
  imageSize?: string;
  aspectRatio?: string;
  referenceImages?: string[];
  items?: GalleryItem[];
  selectedIndex?: number;
  onSelect?: (index: number) => void;
  isSubmitting?: boolean;
  error?: string | null;
  onRegenerate?: (input: {
    prompt: string;
    referenceImages: string[];
    model: ImageModel;
    imageSize: string;
    aspectRatio: string;
  }) => Promise<void> | void;
}

const MODE_LABEL: Record<GenerationLane, string> = {
  generator: "生成",
  launch_pack: "服装详情页",
  try_on: "试穿",
  lookbook: "Lookbook",
  flatlay: "平铺",
  invisible_mannequin_3d: "3D 展示",
};

function uniqueImages(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).slice(0, 6);
}

export default function ImageModal({
  url,
  title,
  prompt,
  onClose,
  returnFocusElement,
  showEditor,
  mode,
  model = "v2",
  imageSize = "1K",
  aspectRatio = "1:1",
  referenceImages = [],
  items,
  selectedIndex = 0,
  onSelect,
  isSubmitting = false,
  error,
  onRegenerate,
}: ImageModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const galleryItems = items ?? [];
  const hasGallery = galleryItems.length > 0;
  const safeIndex = hasGallery ? Math.max(0, Math.min(selectedIndex, galleryItems.length - 1)) : 0;
  const currentItem = hasGallery ? galleryItems[safeIndex] : null;
  const currentUrl = currentItem?.url ?? url;
  const currentTitle = currentItem?.title ?? title;
  const currentPrompt = currentItem?.prompt ?? prompt;
  const currentMode = currentItem?.mode ?? mode;
  const currentModel = currentItem?.model ?? model;
  const currentImageSize = currentItem?.imageSize ?? imageSize;
  const currentAspectRatio = currentItem?.aspectRatio ?? aspectRatio;
  const currentStatus = currentItem?.status ?? "succeeded";
  const currentError = currentItem?.error ?? error ?? null;
  const isPendingCurrent = currentStatus !== "succeeded";
  const [draftPrompt, setDraftPrompt] = useState("");
  const [draftImages, setDraftImages] = useState<string[]>(uniqueImages([currentUrl]));
  const [draftImagePreviews, setDraftImagePreviews] = useState<ImagePreviewMap>({});
  const [draftModel, setDraftModel] = useState<ImageModel>(currentModel);
  const [draftImageSize, setDraftImageSize] = useState(currentImageSize);
  const [draftAspectRatio, setDraftAspectRatio] = useState(currentAspectRatio);
  const [copyState, setCopyState] = useState<"idle" | "done" | "failed">("idle");
  const [downloadState, setDownloadState] = useState<"idle" | "downloading" | "failed">("idle");
  const [localError, setLocalError] = useState<string | null>(null);
  const aspectRatioOptions = useMemo(() => ASPECT_RATIO_PRESETS_BY_MODEL[draftModel], [draftModel]);

  useEffect(() => {
    setDraftPrompt("");
    setDraftModel(currentModel);
    setDraftImageSize(currentImageSize);
    setDraftAspectRatio(currentAspectRatio);
  }, [currentAspectRatio, currentImageSize, currentModel, currentUrl, safeIndex]);

  useEffect(() => {
    setDraftImages(uniqueImages([currentUrl]));
    setDraftImagePreviews({});
    setLocalError(null);
  }, [currentUrl, safeIndex, referenceImages]);

  useEffect(() => {
    if (!aspectRatioOptions.includes(draftAspectRatio)) {
      setDraftAspectRatio(aspectRatioOptions[0]);
    }
  }, [aspectRatioOptions, draftAspectRatio]);

  useEffect(() => {
    setDownloadState("idle");
  }, [currentUrl]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTypingTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        Boolean(target?.isContentEditable);

      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (isTypingTarget) return;
      if (!hasGallery || !onSelect) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        onSelect((safeIndex - 1 + galleryItems.length) % galleryItems.length);
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        onSelect((safeIndex + 1) % galleryItems.length);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [galleryItems.length, hasGallery, onClose, onSelect, safeIndex]);

  useEffect(() => {
    document.body.classList.add("modal-scroll-lock");
    const fallback = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    restoreFocusRef.current = returnFocusElement ?? fallback;
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.classList.remove("modal-scroll-lock");
      restoreFocusRef.current?.focus?.();
    };
  }, [returnFocusElement]);

  const resolvedTitle = useMemo(() => {
    if (currentTitle?.trim()) return currentTitle.trim();
    if (!currentMode) return "图片预览";
    return MODE_LABEL[currentMode];
  }, [currentMode, currentTitle]);

  const canRegenerate = showEditor ?? Boolean(onRegenerate);

  const fileToDataUrlLegacy = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("读取图片失败，请重试"));
      reader.readAsDataURL(file);
    });

  const appendFilesLegacy = async (files: File[]) => {
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    if (!imageFiles.length) return;
    const urls = await Promise.all(imageFiles.map(fileToDataUrlLegacy));
    setDraftImages((prev) => uniqueImages([...prev, ...urls]));
  };

  const appendFiles = async (files: File[]) => {
    if (draftImages.length >= MAX_UPLOADED_IMAGE_COUNT) {
      setLocalError(`最多只能添加 ${MAX_UPLOADED_IMAGE_COUNT} 张参考图`);
      return;
    }

    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    if (!imageFiles.length) {
      setLocalError("仅支持上传图片文件");
      return;
    }

    const remainingSlots = Math.max(0, MAX_UPLOADED_IMAGE_COUNT - draftImages.length);
    const acceptedFiles = imageFiles.slice(0, remainingSlots);
    if (!acceptedFiles.length) {
      setLocalError(`最多只能添加 ${MAX_UPLOADED_IMAGE_COUNT} 张参考图`);
      return;
    }

    setLocalError(imageFiles.length > remainingSlots ? `最多只能再添加 ${remainingSlots} 张参考图` : null);
    try {
      const uploaded = await api.uploadImages(acceptedFiles);
      setDraftImagePreviews((prev) => ({
        ...prev,
        ...buildPreviewMapFromUploads(uploaded),
      }));
      setDraftImages((prev) => uniqueImages([...prev, ...uploaded.map((item) => item.ref)]));
    } catch (uploadError) {
      setLocalError(uploadError instanceof Error ? uploadError.message : "上传图片失败");
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []) as File[];
    if (!files.length) return;
    await appendFiles(files);
    event.target.value = "";
  };

  const handleDrop = async (event: React.DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const files = Array.from(event.dataTransfer.files ?? []) as File[];
    if (!files.length) return;
    await appendFiles(files);
  };

  const displayError = localError ?? error ?? null;

  const handlePrev = () => {
    if (!hasGallery || !onSelect) return;
    onSelect((safeIndex - 1 + galleryItems.length) % galleryItems.length);
  };

  const handleNext = () => {
    if (!hasGallery || !onSelect) return;
    onSelect((safeIndex + 1) % galleryItems.length);
  };

  const handleCopyPrompt = async () => {
    if (!currentPrompt?.trim()) return;
    try {
      await navigator.clipboard.writeText(currentPrompt);
      setCopyState("done");
    } catch {
      setCopyState("failed");
    }
    window.setTimeout(() => setCopyState("idle"), 1600);
  };

  const handleDownload = async () => {
    if (downloadState === "downloading") return;
    setDownloadState("downloading");

    try {
      await downloadImageFile({
        url: currentUrl,
        title: currentTitle,
        resolvedId: currentItem?.resolvedId,
        stableId: currentItem?.stableId,
        id: currentItem?.id,
        defaultBaseName: "genesis-image",
      });
      setDownloadState("idle");
    } catch {
      setDownloadState("failed");
      window.setTimeout(() => setDownloadState("idle"), 1600);
    }
  };

  return (
    <div className="fixed inset-0 z-50 p-3 md:p-6">
      <button
        type="button"
        aria-label="关闭预览"
        onClick={onClose}
        className="absolute inset-0 bg-[#0a0f14]/90"
      />
      <button
        type="button"
        aria-label="关闭预览"
        onClick={onClose}
        className="absolute right-3 top-3 z-20 inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/15 bg-black/55 text-white/90 shadow-lg backdrop-blur transition-colors hover:bg-black/75 md:right-6 md:top-6"
      >
        <X className="h-5 w-5" />
      </button>
      <div className="relative z-10 flex h-full min-h-0 w-full items-stretch justify-center">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
          onClick={(event) => event.stopPropagation()}
          className={`flex h-full min-h-0 w-full overflow-hidden rounded-3xl border border-white/10 bg-[#101922]/95 shadow-2xl outline-none ${canRegenerate ? "max-w-[1600px] flex-col lg:flex-row" : "max-w-[1240px] flex-col"}`}
        >
          <div
            className={`relative flex min-h-0 flex-1 flex-col bg-[#0a0f14] ${canRegenerate ? "border-b border-white/10 lg:border-b-0 lg:border-r lg:border-white/10" : ""}`}
          >
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 md:px-5">
              <div className="min-w-0">
                <div className="truncate font-display text-xl uppercase md:text-2xl">{resolvedTitle}</div>
                <div className="mt-1 text-xs uppercase tracking-wide text-white/60">
                  {currentMode ? `${MODE_LABEL[currentMode]}${hasGallery ? ` · ${safeIndex + 1}/${galleryItems.length}` : ""}` : "结果预览"}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleDownload()}
                  disabled={downloadState === "downloading"}
                  className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs uppercase tracking-wide text-white/85 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {downloadState === "downloading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  {downloadState === "downloading" ? "下载中" : downloadState === "failed" ? "下载失败" : "下载"}
                </button>
              </div>
            </div>

            <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4 md:p-6">
              {hasGallery ? (
                <>
                  <button
                    type="button"
                    onClick={handlePrev}
                    className="absolute left-3 top-1/2 z-10 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white transition-colors hover:bg-black/70"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={handleNext}
                    className="absolute right-3 top-1/2 z-10 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white transition-colors hover:bg-black/70"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </>
              ) : null}

              <div className="relative flex h-full w-full min-h-0 min-w-0 items-center justify-center overflow-hidden rounded-2xl">
                <img
                  src={currentUrl}
                  alt={resolvedTitle}
                  className={`max-h-full max-w-full rounded-2xl object-contain shadow-2xl ${isPendingCurrent ? "blur-sm opacity-60" : ""}`}
                  referrerPolicy="no-referrer"
                />
                {isPendingCurrent ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/25 text-white">
                    <Loader2 className="h-8 w-8 animate-spin" />
                    <div className="rounded-full border border-white/20 bg-black/40 px-4 py-1.5 text-xs uppercase tracking-[0.24em]">
                      生成中
                    </div>
                    {currentError ? (
                      <div className="max-w-[80%] rounded-xl border border-red-300/30 bg-red-500/15 px-3 py-2 text-center text-sm text-red-100">
                        {currentError}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>

            {hasGallery ? (
              <div className="border-t border-white/10 px-4 py-3 md:px-5">
                <div className="flex gap-2 overflow-x-auto workspace-scroll-area">
                  {galleryItems.map((item, index) => {
                    const active = index === safeIndex;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => onSelect?.(index)}
                        className={`relative h-20 w-16 shrink-0 overflow-hidden rounded-xl border transition-colors ${active ? "border-white/70" : "border-white/10 hover:border-white/30"}`}
                      >
                        <img
                          src={item.url}
                          alt={item.title || `preview-${index + 1}`}
                          className={`h-full w-full object-cover ${item.status && item.status !== "succeeded" ? "blur-[1px] opacity-70" : ""}`}
                          referrerPolicy="no-referrer"
                        />
                        {item.status && item.status !== "succeeded" ? (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-white" />
                          </div>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>

          {canRegenerate ? (
            <div className="flex min-h-0 max-h-[42vh] w-full max-w-full shrink-0 flex-col bg-[#111b24] lg:max-h-none lg:w-[460px] lg:max-w-[460px]">
              <div className="border-b border-white/10 px-4 py-4 md:px-5">
                <h4 className="font-display text-xl uppercase">编辑图像</h4>
                <p className="mt-1 text-xs leading-5 text-white/60">先查看原图生成提示词，再输入新的修改要求。默认参考图就是当前这张结果图，你也可以继续上传更多参考图。</p>
              </div>

              <div className="flex-1 min-h-0 space-y-4 overflow-auto workspace-scroll-area p-4 md:p-5">
                <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="text-[11px] uppercase tracking-wide text-white/75">当前模块</div>
                  <div className="mt-2 inline-flex rounded-full border border-white/15 bg-white/10 px-3 py-1 font-mono text-[11px] uppercase">
                    {currentMode ? MODE_LABEL[currentMode] : "未指定"}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <label className="text-[11px] uppercase tracking-wide text-white/75">原图生成提示词</label>
                    <button
                      type="button"
                      onClick={() => void handleCopyPrompt()}
                      className="inline-flex items-center gap-1 rounded-md border border-white/15 bg-white/5 px-2 py-1 text-[10px] uppercase tracking-wide text-white/75 transition-colors hover:bg-white/10"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      {copyState === "done" ? "已复制" : copyState === "failed" ? "复制失败" : "复制"}
                    </button>
                  </div>

                  <div className="max-h-[180px] overflow-y-auto rounded-xl border border-white/10 bg-[#0d141b] p-3 text-sm leading-7 text-white/85">
                    {currentPrompt?.trim() || "该图片没有记录到原始提示词。"}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] uppercase tracking-wide text-white/75">编辑图像</label>
                  <textarea
                    value={draftPrompt}
                    onChange={(event) => setDraftPrompt(event.target.value)}
                    onWheel={(event) => event.stopPropagation()}
                    placeholder="输入你想修改的内容，例如构图、姿势、服装细节、背景、灯光、镜头风格等"
                    className="min-h-[160px] w-full resize-y rounded-xl border border-white/15 bg-white/5 p-3 text-sm text-white outline-none focus:border-white/30"
                  />
                </div>


                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="space-y-2">
                    <label className="text-[11px] uppercase tracking-wide text-white/75">模型</label>
                    <select
                      value={draftModel}
                      onChange={(event) => setDraftModel(event.target.value as ImageModel)}
                      className="w-full rounded-xl border border-white/15 bg-white/5 p-3 text-sm text-white outline-none focus:border-white/30"
                    >
                      <option value="pro">Pro</option>
                      <option value="v2">v2</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[11px] uppercase tracking-wide text-white/75">图像尺寸</label>
                    <select
                      value={draftImageSize}
                      onChange={(event) => setDraftImageSize(event.target.value)}
                      className="w-full rounded-xl border border-white/15 bg-white/5 p-3 text-sm text-white outline-none focus:border-white/30"
                    >
                      {IMAGE_SIZE_OPTIONS.map((sizeOption) => (
                        <option key={sizeOption} value={sizeOption}>{sizeOption}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[11px] uppercase tracking-wide text-white/75">宽高比</label>
                    <select
                      value={draftAspectRatio}
                      onChange={(event) => setDraftAspectRatio(event.target.value)}
                      className="w-full rounded-xl border border-white/15 bg-white/5 p-3 text-sm text-white outline-none focus:border-white/30"
                    >
                      {aspectRatioOptions.map((ratio) => (
                        <option key={ratio} value={ratio}>{ratio}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-white/75">
                    <span>参考图</span>
                    <span className="font-mono text-[10px] text-white/55">{draftImages.length}/6</span>
                  </div>

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => void handleDrop(event)}
                    className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/25 bg-white/5 p-4 text-[11px] uppercase tracking-wide text-white/80 transition-colors hover:bg-white/8"
                  >
                    <Upload className="h-4 w-4" />
                    <span>点击或拖拽上传参考图</span>
                    <span className="text-center text-[10px] normal-case text-white/45">默认已使用当前结果图作为参考图。你还可以继续上传额外图片，最多 6 张。</span>
                  </button>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(event) => void handleFileChange(event)}
                  />

                  {draftImages.length > 0 ? (
                    <div className="grid grid-cols-3 gap-2">
                      {draftImages.map((image, index) => {
                        const isCurrentImage = image === currentUrl;
                        const previewUrl = resolveImagePreviewUrl(image, draftImagePreviews);
                        return (
                          <div key={`${image}-${index}`} className="relative overflow-hidden rounded-lg border border-white/10 bg-[#0a0f14]">
                            {previewUrl ? (
                              <img src={previewUrl} alt={`reference-${index + 1}`} className="aspect-[3/4] w-full object-cover" loading="lazy" decoding="async" />
                            ) : (
                              <div className="flex aspect-[3/4] items-center justify-center px-2 text-center text-[10px] text-white/55">预览加载中</div>
                            )}
                            <div className="absolute left-1 top-1 rounded border border-white/20 bg-black/70 px-1.5 py-0.5 text-[10px] text-white/90">
                              {isCurrentImage ? "当前图" : `参考图 ${index + 1}`}
                            </div>
                            <button
                              type="button"
                              onClick={() => setDraftImages((prev) => prev.filter((_, currentIndex) => currentIndex !== index))}
                              className="absolute right-1 top-1 rounded border border-white/20 bg-black/70 px-1.5 py-0.5 text-[10px]"
                            >
                              移除
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-white/55">当前没有参考图。你可以继续上传图片，或直接提交仅依赖编辑输入进行修改。</div>
                  )}
                </div>

                {displayError ? <div className="rounded-xl border border-red-300/40 bg-red-500/15 p-3 text-sm text-red-200">{displayError}</div> : null}
              </div>

              <div className="border-t border-white/10 p-4 md:p-5">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => {
                    const safeReferenceImages = uniqueImages([currentUrl, ...draftImages]);
                    void onRegenerate?.({
                      prompt: draftPrompt,
                      referenceImages: safeReferenceImages,
                      model: draftModel,
                      imageSize: draftImageSize,
                      aspectRatio: draftAspectRatio,
                    });
                  }}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 font-mono text-sm uppercase text-[#647B8C] transition-colors hover:bg-white/90 disabled:opacity-60"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> 提交中...
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4" /> 编辑并重新生成
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
