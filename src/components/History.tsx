import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Trash2, Loader2, RotateCcw } from "lucide-react";
import { api } from "../lib/api";
import { downloadImageFile } from "../lib/download";
import { requestGeneratorSubmit } from "../lib/generatorSubmission";
import ImageModal from "./ImageModal";
import type { GenerationRecord } from "../types";
import {
  PREVIEW_GRID_GAP_CLASS,
  PREVIEW_SIZE_MIN_CARD_WIDTH,
  PREVIEW_SIZE_LABEL,
  PREVIEW_SIZE_ORDER,
  type PreviewSize,
} from "./previewSizeConfig";
import { useDeleteGenerationMutation, useHistoryList } from "../hooks/useHistoryQuery";

interface ImageLoadState {
  retryCount: number;
  retrying: boolean;
  error: string | null;
}

type DisplayHistoryItem = GenerationRecord & {
  stableId?: string;
  resolvedId?: string | null;
  jobId?: string | null;
  anchorId?: string | null;
  placeholderSourceUrl?: string | null;
  localOnly?: boolean;
};

const IMAGE_RETRY_DELAYS_MS = [600, 1200, 2000];
const IMAGE_RETRY_MAX = IMAGE_RETRY_DELAYS_MS.length;

function modelLabel(model: GenerationRecord["model"]): string {
  return model === "v2" ? "v2" : "Pro";
}

export default function History({
  previewSize,
  onPreviewSizeChange,
}: {
  previewSize: PreviewSize;
  onPreviewSizeChange: (next: PreviewSize) => void;
}) {
  const [enlargedId, setEnlargedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [downloadStates, setDownloadStates] = useState<Record<string, "downloading" | "failed">>({});
  const [imageLoadState, setImageLoadState] = useState<Record<string, ImageLoadState>>({});
  const [imageUrlOverrides, setImageUrlOverrides] = useState<Record<string, string>>({});
  const [localError, setLocalError] = useState<string | null>(null);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [regenerateError, setRegenerateError] = useState<string | null>(null);
  const [pendingItems, setPendingItems] = useState<DisplayHistoryItem[]>([]);

  const retryTimersRef = useRef<Map<string, number>>(new Map());
  const downloadResetTimersRef = useRef<Map<string, number>>(new Map());
  const imageReloadInFlightRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);

  const { data, isLoading, isError, error } = useHistoryList(60, 0);
  const deleteMutation = useDeleteGenerationMutation();

  const baseItems = data?.items ?? [];
  const history = useMemo<DisplayHistoryItem[]>(
    () =>
      baseItems.map((item) => ({
        ...item,
        imageUrl: imageUrlOverrides[item.id] ?? item.imageUrl,
      })),
    [baseItems, imageUrlOverrides],
  );

  useEffect(() => {
    if (!baseItems.length) return;
    const persistedMap = new Map(baseItems.map((item) => [item.id, item]));
    setPendingItems((prev) =>
      prev.map((item) => {
        if (!item.jobId) return item;
        const persisted = persistedMap.get(item.jobId);
        if (!persisted) return item;
        return {
          ...item,
          prompt: persisted.prompt,
          aspectRatio: persisted.aspectRatio,
          imageSize: persisted.imageSize,
          model: persisted.model,
          lane: persisted.lane,
          status: persisted.status,
          error: persisted.error,
          imageUrl: imageUrlOverrides[persisted.id] ?? persisted.imageUrl,
          createdAt: persisted.createdAt,
          completedAt: persisted.completedAt,
          resolvedId: persisted.id,
          localOnly: true,
        };
      }),
    );
  }, [baseItems, imageUrlOverrides]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      pendingItems.forEach((item) => {
        if (!item.jobId) return;
        if (item.status !== "queued" && item.status !== "processing" && !(item.status === "succeeded" && !item.imageUrl)) {
          return;
        }
        void api.getGenerationJob(item.jobId).then((job) => {
          if (!mountedRef.current) return;
          setPendingItems((prev) =>
            prev.map((pending) =>
              pending.id === item.id
                ? {
                    ...pending,
                    status: job.status,
                    imageUrl: job.imageUrl ?? pending.imageUrl,
                    error: job.error,
                  }
                : pending,
            ),
          );
        }).catch(() => {
          // Keep local optimistic item until next poll.
        });
      });
    }, 2500);

    return () => window.clearInterval(timer);
  }, [pendingItems]);

  const displayHistory = useMemo<DisplayHistoryItem[]>(() => {
    const hiddenRealIds = new Set(pendingItems.map((item) => item.jobId).filter(Boolean));
    const merged = history.filter((item) => !hiddenRealIds.has(item.id));
    for (const pending of pendingItems) {
      if (pending.jobId && merged.some((item) => item.id === pending.jobId)) continue;
      const anchorIndex = merged.findIndex((item) => item.id === pending.anchorId);
      if (anchorIndex < 0) {
        merged.unshift(pending);
        continue;
      }
      let insertIndex = anchorIndex;
      while (insertIndex + 1 < merged.length && merged[insertIndex + 1].anchorId === pending.anchorId) {
        insertIndex += 1;
      }
      merged.splice(insertIndex + 1, 0, pending);
    }
    return merged;
  }, [history, pendingItems]);

  useEffect(() => {
    const validIds = new Set(baseItems.map((item) => item.id));
    setImageUrlOverrides((prev) => {
      let changed = false;
      const next: Record<string, string> = {};
      Object.entries(prev as Record<string, string>).forEach(([id, url]) => {
        if (validIds.has(id)) {
          next[id] = url;
        } else {
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [baseItems]);

  const enlargedItem = useMemo(
    () => displayHistory.find((item) => item.id === enlargedId) ?? null,
    [displayHistory, enlargedId],
  );

  const modalGalleryItems = useMemo(
    () =>
      displayHistory
        .filter((item) => Boolean(item.imageUrl || item.placeholderSourceUrl))
        .map((item) => ({
          id: item.id,
          stableId: item.stableId ?? item.id,
          resolvedId: item.resolvedId ?? item.jobId ?? item.id,
          url: (item.imageUrl ?? item.placeholderSourceUrl) as string,
          prompt: item.prompt,
          model: item.model,
          imageSize: item.imageSize,
          aspectRatio: item.aspectRatio,
          mode: item.lane,
          referenceImages: [],
          status: item.status,
          error: item.error,
        })),
    [displayHistory],
  );

  const modalSelectedIndex = useMemo(() => {
    if (!enlargedId) return 0;
    const index = modalGalleryItems.findIndex((item) => item.id === enlargedId);
    return index >= 0 ? index : 0;
  }, [enlargedId, modalGalleryItems]);
  const modalSelectedItem = useMemo(
    () => modalGalleryItems.find((item) => item.id === enlargedId) ?? null,
    [enlargedId, modalGalleryItems],
  );

  const clearRetryTimer = useCallback((id: string) => {
    const timer = retryTimersRef.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      retryTimersRef.current.delete(id);
    }
  }, []);

  const clearDownloadResetTimer = useCallback((id: string) => {
    const timer = downloadResetTimersRef.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      downloadResetTimersRef.current.delete(id);
    }
  }, []);

  const clearDownloadState = useCallback((id: string) => {
    setDownloadStates((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const refreshHistoryItemUrl = useCallback(async (jobId: string) => {
    if (imageReloadInFlightRef.current.has(jobId)) return;
    imageReloadInFlightRef.current.add(jobId);
    try {
      const job = await api.getGenerationJob(jobId);
      if (!mountedRef.current) return;
      if (job.imageUrl) {
        setImageUrlOverrides((prev) => {
          if (prev[jobId] === job.imageUrl) return prev;
          return { ...prev, [jobId]: job.imageUrl };
        });
      }
    } catch {
      // Keep retry loop in UI state.
    } finally {
      imageReloadInFlightRef.current.delete(jobId);
    }
  }, []);

  const markRetrying = useCallback((jobId: string, retryCount: number, message: string | null) => {
    setImageLoadState((prev) => ({
      ...prev,
      [jobId]: {
        retryCount,
        retrying: true,
        error: message,
      },
    }));
  }, []);

  const markRetryFinished = useCallback((jobId: string, retryCount: number, errorMessage: string | null) => {
    setImageLoadState((prev) => ({
      ...prev,
      [jobId]: {
        retryCount,
        retrying: false,
        error: errorMessage,
      },
    }));
  }, []);

  const retryImageLoad = useCallback(
    async (item: GenerationRecord, retryCount: number, isManual = false) => {
      clearRetryTimer(item.id);
      const delay = isManual ? 0 : IMAGE_RETRY_DELAYS_MS[Math.max(0, retryCount - 1)] ?? 2000;
      markRetrying(item.id, retryCount, isManual ? null : "图片加载失败，正在重试...");

      const timer = window.setTimeout(async () => {
        await refreshHistoryItemUrl(item.id);
        if (!mountedRef.current) return;
        markRetryFinished(item.id, retryCount, null);
      }, delay);

      retryTimersRef.current.set(item.id, timer);
    },
    [clearRetryTimer, markRetryFinished, markRetrying, refreshHistoryItemUrl],
  );

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      retryTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      retryTimersRef.current.clear();
      downloadResetTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      downloadResetTimersRef.current.clear();
      imageReloadInFlightRef.current.clear();
    };
  }, []);

  const cyclePreviewSize = useCallback(() => {
    const idx = PREVIEW_SIZE_ORDER.indexOf(previewSize);
    const next = PREVIEW_SIZE_ORDER[(idx + 1) % PREVIEW_SIZE_ORDER.length];
    onPreviewSizeChange(next);
  }, [onPreviewSizeChange, previewSize]);

  const handleImageLoad = useCallback(
    (id: string) => {
      clearRetryTimer(id);
      setImageLoadState((prev) => {
        if (!prev[id]) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    },
    [clearRetryTimer],
  );

  const handleImageError = useCallback(
    (item: GenerationRecord) => {
      if (!item.imageUrl) return;
      clearRetryTimer(item.id);
      const currentRetry = imageLoadState[item.id]?.retryCount ?? 0;
      const nextRetry = currentRetry + 1;

      if (nextRetry <= IMAGE_RETRY_MAX) {
        void retryImageLoad(item, nextRetry);
        return;
      }

      setImageLoadState((prev) => ({
        ...prev,
        [item.id]: {
          retryCount: currentRetry,
          retrying: false,
          error: "Image failed to load. Click retry.",
        },
      }));
    },
    [clearRetryTimer, imageLoadState, retryImageLoad],
  );

  const handleManualRetry = useCallback(
    (e: React.MouseEvent, item: GenerationRecord) => {
      e.stopPropagation();
      void retryImageLoad(item, 1, true);
    },
    [retryImageLoad],
  );

  const handleDownload = useCallback(
    async (e: React.MouseEvent, item: DisplayHistoryItem) => {
      e.stopPropagation();
      if (!item.imageUrl || downloadStates[item.id] === "downloading") return;

      clearDownloadResetTimer(item.id);
      clearDownloadState(item.id);
      setDownloadStates((prev) => ({ ...prev, [item.id]: "downloading" }));

      try {
        await downloadImageFile({
          url: item.imageUrl,
          resolvedId: item.resolvedId ?? item.jobId ?? item.id,
          stableId: item.stableId ?? item.id,
          id: item.id,
          defaultBaseName: "genesis-image",
        });
        if (!mountedRef.current) return;
        clearDownloadState(item.id);
      } catch {
        if (!mountedRef.current) return;
        setDownloadStates((prev) => ({ ...prev, [item.id]: "failed" }));
        const timer = window.setTimeout(() => {
          if (!mountedRef.current) return;
          clearDownloadState(item.id);
          downloadResetTimersRef.current.delete(item.id);
        }, 1600);
        downloadResetTimersRef.current.set(item.id, timer);
      }
    },
    [clearDownloadResetTimer, clearDownloadState, downloadStates],
  );

  const deleteItem = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setDeletingId(id);
    setLocalError(null);
    clearRetryTimer(id);

    try {
      await deleteMutation.mutateAsync(id);
      setImageLoadState((prev) => {
        if (!prev[id]) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setImageUrlOverrides((prev) => {
        if (!prev[id]) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      if (enlargedId === id) setEnlargedId(null);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "删除记录失败");
    } finally {
      setDeletingId(null);
    }
  };

  const errorMessage = localError ?? (isError ? (error instanceof Error ? error.message : "加载历史记录失败") : null);

  const handleRegenerate = useCallback(
    async ({ prompt, referenceImages, model, imageSize, aspectRatio }: { prompt: string; referenceImages: string[]; model: GenerationRecord["model"]; imageSize: string; aspectRatio: string }) => {
      if (!enlargedItem) {
        setRegenerateError("未找到当前图片对应的历史记录");
        return;
      }

      setIsRegenerating(true);
      setRegenerateError(null);
      const result = await requestGeneratorSubmit(
        {
          prompt: prompt.trim(),
          referenceImages,
          aspectRatio,
          imageSize,
          model,
        },
        {
          anchorJobId: enlargedItem.jobId ?? enlargedItem.id,
          sourceImageUrl: enlargedItem.imageUrl ?? enlargedItem.placeholderSourceUrl,
          sourcePrompt: enlargedItem.prompt,
          onOptimistic: ({ localId, sourceImageUrl }) => {
            if (!mountedRef.current) return;
            setPendingItems((prev) => [
              ...prev,
              {
                id: localId,
                stableId: localId,
                resolvedId: null,
                jobId: null,
                anchorId: enlargedItem.id,
                placeholderSourceUrl: sourceImageUrl ?? enlargedItem.imageUrl ?? enlargedItem.placeholderSourceUrl ?? null,
                imageUrl: null,
                prompt: prompt.trim(),
                aspectRatio,
                imageSize,
                model,
                lane: "generator",
                status: "submitting",
                error: null,
                createdAt: new Date().toISOString(),
                completedAt: null,
                localOnly: true,
              },
            ]);
            setEnlargedId(localId);
          },
        },
      );
      if (!result.ok) {
        setRegenerateError(result.error ?? "???????");
      } else if (result.localId) {
        setPendingItems((prev) =>
          prev.map((item) =>
            item.id === result.localId
              ? {
                  ...item,
                  jobId: result.jobId ?? item.jobId,
                  resolvedId: result.jobId ?? item.resolvedId ?? null,
                  status: result.jobId ? "queued" : item.status,
                }
              : item,
          ),
        );
      }
      if (mountedRef.current) {
        setIsRegenerating(false);
      }
    },
    [enlargedItem],
  );

  const handleImageDragStart = (e: React.DragEvent<HTMLImageElement>, imageUrl: string) => {
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("application/x-genesis-image-url", imageUrl);
    e.dataTransfer.setData("text/uri-list", imageUrl);
    e.dataTransfer.setData("text/plain", imageUrl);
  };

  return (
    <div className="h-full min-h-0 w-full flex flex-col p-6 md:p-10 overflow-hidden">
      <header className="mb-10 shrink-0">
        <h1 className="font-display text-4xl md:text-5xl uppercase mb-2">历史记录</h1>
        <p className="font-mono text-xs opacity-60 uppercase tracking-widest">[ 历史生成结果 ]</p>
        <div className="mt-4">
          <button
            onClick={cyclePreviewSize}
            className="px-3 py-1.5 rounded-md border border-white/30 hover:bg-white/10 transition-colors font-mono text-[10px] uppercase tracking-widest"
          >
            预览尺寸：{PREVIEW_SIZE_LABEL[previewSize]}
          </button>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto workspace-scroll-area pr-1">
        {isLoading ? (
        <div className="text-center py-20 opacity-60 font-mono text-sm uppercase flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> 正在加载历史记录...
        </div>
      ) : errorMessage ? (
        <div className="text-center py-20 font-mono text-sm text-red-200">{errorMessage}</div>
      ) : displayHistory.length === 0 ? (
        <div className="text-center py-20 opacity-50 font-mono text-sm uppercase">暂无历史记录。</div>
      ) : (
        <div
          className={`grid ${PREVIEW_GRID_GAP_CLASS}`}
          style={{
            gridTemplateColumns: `repeat(auto-fill, minmax(${PREVIEW_SIZE_MIN_CARD_WIDTH[previewSize]}, 1fr))`,
          }}
        >
          {displayHistory.map((item) => (
            <div
              key={item.id}
              className="group render-isolate bg-[#3A4A54]/20 border border-white/10 rounded-xl overflow-hidden hover:border-white/30 transition-colors flex flex-col"
            >
              <div className="aspect-[3/4] relative overflow-hidden bg-[#0a0f14]">
                {item.imageUrl ? (
                  <img
                    src={item.imageUrl}
                    alt={item.prompt}
                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.02] cursor-zoom-in"
                    referrerPolicy="no-referrer"
                    loading="lazy"
                    decoding="async"
                    draggable
                    onDragStart={(e) => handleImageDragStart(e, item.imageUrl!)}
                    onClick={() => setEnlargedId(item.id)}
                    onLoad={() => handleImageLoad(item.id)}
                    onError={() => handleImageError(item)}
                  />
                ) : item.placeholderSourceUrl ? (
                  <>
                    <img
                      src={item.placeholderSourceUrl}
                      alt={item.prompt}
                      className="w-full h-full scale-[1.02] object-cover blur-sm opacity-60"
                      referrerPolicy="no-referrer"
                    />
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/25">
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <p className="font-mono text-[10px] uppercase tracking-widest text-center px-3">???</p>
                    </div>
                  </>
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-xs font-mono opacity-60 px-4 text-center">
                    {item.status === "failed" ? "生成失败" : item.status}
                  </div>
                )}

                <div className="absolute top-2 left-2 px-2 py-1 rounded-full border border-white/30 bg-black/40 font-mono text-[10px] uppercase tracking-widest">
                  {modelLabel(item.model)}
                </div>

                {imageLoadState[item.id]?.error && (
                  <div className="absolute left-2 bottom-2 right-24 text-[10px] font-mono text-amber-200/90 bg-black/45 border border-amber-200/30 rounded-md px-2 py-1">
                    {imageLoadState[item.id]?.error}
                  </div>
                )}

                {imageLoadState[item.id]?.retrying && (
                  <div className="absolute bottom-2 left-2 inline-flex items-center gap-1 px-2 py-1 rounded-md border border-white/20 bg-black/35 font-mono text-[10px] uppercase">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    恢复中...
                  </div>
                )}

                <div className="absolute top-2 right-2 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                  {imageLoadState[item.id]?.error && (
                    <button
                      onClick={(e) => handleManualRetry(e, item)}
                      className="pointer-events-auto p-2 bg-white/90 text-black rounded-full hover:scale-110 transition-transform"
                      title="重试"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                  )}

                  {item.imageUrl && !item.localOnly && (
                    <button
                      type="button"
                      className="pointer-events-auto p-2 bg-white/90 text-black rounded-full hover:scale-110 transition-transform disabled:cursor-not-allowed disabled:opacity-60"
                      onClick={(e) => void handleDownload(e, item)}
                      disabled={downloadStates[item.id] === "downloading"}
                      title={downloadStates[item.id] === "failed" ? "下载失败" : downloadStates[item.id] === "downloading" ? "下载中" : "下载"}
                    >
                      {downloadStates[item.id] === "downloading" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                    </button>
                  )}

                  {!item.localOnly ? (
                    <button
                      onClick={(e) => void deleteItem(e, item.id)}
                      disabled={deletingId === item.id || deleteMutation.isPending}
                      className="pointer-events-auto p-2 bg-red-500 text-white rounded-full hover:scale-110 transition-transform disabled:opacity-60"
                      title="??"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="p-4 flex-1 flex flex-col justify-between">
                <p className="font-sans text-sm line-clamp-2 opacity-80 mb-3" title={item.prompt}>
                  {item.prompt || "未填写提示词"}
                </p>
                <p className="font-mono text-[10px] opacity-50 uppercase">{new Date(item.createdAt).toLocaleString()}</p>
              </div>
            </div>
          ))}
          </div>
        )}
      </div>

      {enlargedId && modalSelectedItem && (
        <ImageModal
          url={modalSelectedItem.url}
          prompt={modalSelectedItem.prompt}
          mode="generator"
          referenceImages={modalSelectedItem.referenceImages}
          items={modalGalleryItems}
          selectedIndex={modalSelectedIndex}
          onSelect={(index) => {
            const item = modalGalleryItems[index];
            if (item) {
              setRegenerateError(null);
              setEnlargedId(item.id);
            }
          }}
          isSubmitting={isRegenerating}
          error={regenerateError}
          onRegenerate={handleRegenerate}
          onClose={() => {
            setEnlargedId(null);
            setRegenerateError(null);
          }}
        />
      )}
    </div>
  );
}
