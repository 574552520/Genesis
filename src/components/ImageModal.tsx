import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Download, Loader2, Upload, X } from "lucide-react";
import type { CommerceMode } from "../types";

type GalleryItem = {
  id: string;
  url: string;
  title?: string;
  prompt?: string;
  referenceImages?: string[];
  mode?: CommerceMode;
};

interface ImageModalProps {
  url: string;
  title?: string;
  prompt?: string;
  onClose: () => void;
  mode?: CommerceMode;
  referenceImages?: string[];
  items?: GalleryItem[];
  selectedIndex?: number;
  onSelect?: (index: number) => void;
  isSubmitting?: boolean;
  error?: string | null;
  onRegenerate?: (input: { prompt: string; referenceImages: string[] }) => Promise<void> | void;
}

const MODE_LABEL: Record<CommerceMode, string> = {
  launch_pack: "服装详情页",
  try_on: "试穿",
  lookbook: "Lookbook",
  flatlay: "平铺",
  invisible_mannequin_3d: "3D 展示",
};

export default function ImageModal({
  url,
  title,
  prompt,
  onClose,
  mode,
  referenceImages = [],
  items,
  selectedIndex = 0,
  onSelect,
  isSubmitting = false,
  error,
  onRegenerate,
}: ImageModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const galleryItems = items ?? [];
  const hasGallery = galleryItems.length > 0;
  const safeIndex = hasGallery ? Math.max(0, Math.min(selectedIndex, galleryItems.length - 1)) : 0;
  const currentItem = hasGallery ? galleryItems[safeIndex] : null;
  const currentUrl = currentItem?.url ?? url;
  const currentTitle = currentItem?.title ?? title;
  const currentPrompt = currentItem?.prompt ?? prompt;
  const currentMode = currentItem?.mode ?? mode;
  const currentReferenceImages = currentItem?.referenceImages ?? referenceImages;
  const [draftPrompt, setDraftPrompt] = useState(currentPrompt ?? "");
  const [draftImages, setDraftImages] = useState<string[]>(currentReferenceImages);

  useEffect(() => {
    setDraftPrompt(currentPrompt ?? "");
  }, [currentPrompt, safeIndex]);

  useEffect(() => {
    setDraftImages(currentReferenceImages);
  }, [currentReferenceImages, safeIndex]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
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
    return () => {
      document.body.classList.remove("modal-scroll-lock");
    };
  }, []);

  const resolvedTitle = useMemo(() => {
    if (currentTitle?.trim()) return currentTitle.trim();
    if (!currentMode) return "图片预览";
    return MODE_LABEL[currentMode];
  }, [currentMode, currentTitle]);

  const canRegenerate = Boolean(onRegenerate && currentMode);

  const fileToDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("读取图片失败，请重试"));
      reader.readAsDataURL(file);
    });

  const appendFiles = async (files: File[]) => {
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    if (!imageFiles.length) return;
    const urls = await Promise.all(imageFiles.map(fileToDataUrl));
    setDraftImages((prev) => Array.from(new Set([...prev, ...urls])).slice(0, 6));
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

  const handlePrev = () => {
    if (!hasGallery || !onSelect) return;
    onSelect((safeIndex - 1 + galleryItems.length) % galleryItems.length);
  };

  const handleNext = () => {
    if (!hasGallery || !onSelect) return;
    onSelect((safeIndex + 1) % galleryItems.length);
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#0a0f14]/92 p-3 backdrop-blur-md md:p-6 workspace-scroll-lock" onClick={onClose}>
      <div className="pointer-events-none absolute inset-0" />
      <div
        className="relative h-full max-h-full overflow-hidden rounded-2xl border border-white/10 bg-[#101920] shadow-[0_0_40px_rgba(0,0,0,0.45)] workspace-scroll-lock"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={`grid h-full ${canRegenerate ? "lg:grid-cols-[minmax(0,1.5fr)_420px]" : "grid-cols-1"}`}>
          <div className={`min-h-0 flex flex-col ${canRegenerate ? "border-b border-white/10 lg:border-b-0 lg:border-r" : ""}`}>
            <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-[#101920]/95 px-4 py-4 md:px-6">
              <div className="flex items-center gap-3 min-w-0">
                <button type="button" onClick={onClose} className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-white/8 text-white transition-colors hover:bg-white/16" aria-label="返回">
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <div className="min-w-0">
                  <h3 className="truncate font-display text-2xl uppercase">{resolvedTitle}</h3>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-white/55">
                    {currentMode ? `${MODE_LABEL[currentMode]}${hasGallery ? ` · ${safeIndex + 1}/${galleryItems.length}` : ""}` : "结果预览"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <a href={currentUrl} download="genesis-generated-image.png" className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 font-mono text-[11px] uppercase text-[#647B8C] shadow-lg transition-colors hover:bg-white/90">
                  <Download className="h-4 w-4" /> 下载
                </a>
                <button type="button" onClick={onClose} className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-white/8 text-white transition-colors hover:bg-white/16" aria-label="关闭">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto workspace-scroll-area bg-[#0a0f14] px-4 py-6 md:px-6">
                {hasGallery && galleryItems.length > 1 ? (
                  <>
                    <button type="button" onClick={handlePrev} className="absolute left-4 top-1/2 z-10 -translate-y-1/2 rounded-full border border-white/15 bg-black/45 p-3 text-white transition-colors hover:bg-black/65" aria-label="上一张">
                      <ChevronLeft className="h-5 w-5" />
                    </button>
                    <button type="button" onClick={handleNext} className="absolute right-4 top-1/2 z-10 -translate-y-1/2 rounded-full border border-white/15 bg-black/45 p-3 text-white transition-colors hover:bg-black/65" aria-label="下一张">
                      <ChevronRight className="h-5 w-5" />
                    </button>
                  </>
                ) : null}
                <img src={currentUrl} alt={resolvedTitle} className="max-h-[68vh] max-w-full rounded-xl object-contain" referrerPolicy="no-referrer" decoding="async" />
              </div>

              {hasGallery && galleryItems.length > 1 ? (
                <div className="border-t border-white/10 bg-[#0d141a]/95 px-4 py-3 md:px-6">
                  <div className="flex gap-3 overflow-x-auto workspace-scroll-area pb-1">
                    {galleryItems.map((item, index) => (
                      <button key={item.id} type="button" onClick={() => onSelect?.(index)} className={`group min-w-[82px] max-w-[82px] rounded-xl border p-1 text-left transition-colors ${index === safeIndex ? "border-white/70 bg-white/10" : "border-white/10 bg-white/5 hover:border-white/30"}`}>
                        <img src={item.url} alt={item.title || `thumbnail-${index + 1}`} className="aspect-[3/4] w-full rounded-lg object-cover" referrerPolicy="no-referrer" loading="lazy" decoding="async" />
                        <div className="px-1 pt-1.5">
                          <div className="truncate font-mono text-[9px] uppercase tracking-wide text-white/85">{item.title || `结果 ${index + 1}`}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {canRegenerate ? (
            <div className="flex min-h-0 flex-col bg-[#0d141a]/95">
              <div className="border-b border-white/10 px-4 py-4 md:px-5">
                <h4 className="font-display text-xl uppercase">编辑图像</h4>
                <p className="mt-1 text-xs leading-5 text-white/60">右侧编辑提示词和参考图，提交后会重新生成，并进入当前模块结果列表。</p>
              </div>

              <div className="flex-1 min-h-0 space-y-4 overflow-auto workspace-scroll-area p-4 md:p-5">
                <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="text-[11px] uppercase tracking-wide text-white/75">当前模块</div>
                  <div className="mt-2 inline-flex rounded-full border border-white/15 bg-white/10 px-3 py-1 font-mono text-[11px] uppercase">
                    {currentMode ? MODE_LABEL[currentMode] : "未指定"}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] uppercase tracking-wide text-white/75">提示词</label>
                  <textarea value={draftPrompt} onChange={(event) => setDraftPrompt(event.target.value)} placeholder="补充你希望调整的构图、灯光、版式、动作、质感或细节方向" className="min-h-[160px] w-full rounded-xl border border-white/15 bg-white/5 p-3 text-sm text-white outline-none focus:border-white/30" />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-white/75">
                    <span>参考图</span>
                    <span className="font-mono text-[10px] text-white/55">{draftImages.length}/6</span>
                  </div>
                  <button type="button" onClick={() => fileInputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => void handleDrop(event)} className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/25 bg-white/5 p-4 text-[11px] uppercase tracking-wide text-white/80 transition-colors hover:bg-white/8">
                    <Upload className="h-4 w-4" />
                    <span>点击或拖拽上传参考图</span>
                    <span className="text-center text-[10px] normal-case text-white/45">会和当前模块已有参考图合并使用，最多保留 6 张。</span>
                  </button>
                  <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(event) => void handleFileChange(event)} />

                  {draftImages.length > 0 ? (
                    <div className="grid grid-cols-3 gap-2">
                      {draftImages.map((image, index) => (
                        <div key={`${image}-${index}`} className="relative overflow-hidden rounded-lg border border-white/10 bg-[#0a0f14]">
                          <img src={image} alt={`reference-${index + 1}`} className="aspect-[3/4] w-full object-cover" loading="lazy" decoding="async" />
                          <button type="button" onClick={() => setDraftImages((prev) => prev.filter((_, currentIndex) => currentIndex !== index))} className="absolute right-1 top-1 rounded border border-white/20 bg-black/70 px-1.5 py-0.5 text-[10px]">移除</button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-white/55">暂未添加额外参考图。你可以直接提交，只使用当前模块已有输入继续重生成。</div>
                  )}
                </div>

                {error ? <div className="rounded-xl border border-red-300/40 bg-red-500/15 p-3 text-sm text-red-200">{error}</div> : null}
              </div>

              <div className="border-t border-white/10 p-4 md:p-5">
                <button type="button" disabled={isSubmitting} onClick={() => void onRegenerate?.({ prompt: draftPrompt, referenceImages: draftImages })} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 font-mono text-sm uppercase text-[#647B8C] transition-colors hover:bg-white/90 disabled:opacity-60">
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
