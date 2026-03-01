import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Upload,
  X,
  Loader2,
  Settings2,
  Sparkles,
  Image as ImageIcon,
  Maximize2,
  RotateCcw,
} from "lucide-react";
import { api } from "../lib/api";
import ImageModal from "./ImageModal";
import type { GenerationRecord, ImageModel, JobStatus } from "../types";

type QueueItemStatus = "submitting" | JobStatus;

interface GenerationQueueItem {
  localId: string;
  jobId: string | null;
  promptSnapshot: string;
  referenceImages: string[];
  createdAt: string;
  status: QueueItemStatus;
  imageUrl: string | null;
  imageRenderFailed: boolean;
  error: string | null;
  syncWarning: string | null;
  aspectRatio: string;
  imageSize: string;
  model: ImageModel;
}

const GENERATION_COST = 50;
const POLL_INTERVAL_MS = 2000;
const SUBMIT_TIMEOUT_MS = 15000;
const MAX_SYNC_RETRY_BEFORE_WARNING = 3;
const URL_PENDING_WARNING_THRESHOLD = 4;
const URL_PENDING_MAX_RETRY = 20;
const IMAGE_RENDER_RETRY_MAX = 3;
const IMAGE_RENDER_RETRY_DELAY_MS = 1200;
const RECOVERY_HISTORY_LIMIT = 40;
const RECOVERY_TIME_WINDOW_MS = 5 * 60 * 1000;
const ASPECT_RATIO_PRESETS = ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "21:9", "9:21"];

function modelLabel(model: ImageModel): string {
  return model === "v2" ? "v2" : "Pro";
}

function makeLocalId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function statusBadgeClass(status: QueueItemStatus): string {
  if (status === "succeeded") return "bg-emerald-500/20 border-emerald-300/40 text-emerald-300";
  if (status === "failed") return "bg-red-500/20 border-red-300/40 text-red-200";
  if (status === "processing") return "bg-white/10 border-white/30 text-white";
  if (status === "queued") return "bg-white/5 border-white/20 text-white/80";
  return "bg-white/10 border-white/20 text-white/80";
}

function statusLabel(status: QueueItemStatus): string {
  if (status === "submitting") return "提交中";
  if (status === "queued") return "排队中";
  if (status === "processing") return "处理中";
  if (status === "succeeded") return "已完成";
  return "失败";
}

function isTerminal(status: QueueItemStatus): boolean {
  return status === "succeeded" || status === "failed";
}

function normalizePrompt(prompt: string): string {
  return prompt.trim();
}

export default function Generator({
  isVisible,
  credits,
  onGenerationDone,
}: {
  isVisible?: boolean;
  credits: number | null;
  onGenerationDone: () => Promise<void>;
}) {
  const [prompt, setPrompt] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [size, setSize] = useState("1K");
  const [model, setModel] = useState<ImageModel>("v2");
  const [queueItems, setQueueItems] = useState<GenerationQueueItem[]>([]);
  const [submittingCount, setSubmittingCount] = useState(0);
  const [reservedCredits, setReservedCredits] = useState(0);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [enlargedImage, setEnlargedImage] = useState<string | null>(null);
  const [enlargedPrompt, setEnlargedPrompt] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);
  const inFlightRef = useRef<Set<string>>(new Set());
  const failureCountsRef = useRef<Map<string, number>>(new Map());
  const urlPendingCountsRef = useRef<Map<string, number>>(new Map());
  const haltedUrlPollingRef = useRef<Set<string>>(new Set());
  const imageLoadRetriesRef = useRef<Map<string, number>>(new Map());
  const imageReloadInFlightRef = useRef<Set<string>>(new Set());
  const lastCreditsRef = useRef<number | null>(credits);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      inFlightRef.current.clear();
      failureCountsRef.current.clear();
      urlPendingCountsRef.current.clear();
      haltedUrlPollingRef.current.clear();
      imageLoadRetriesRef.current.clear();
      imageReloadInFlightRef.current.clear();
    };
  }, []);

  useEffect(() => {
    const previousCredits = lastCreditsRef.current;
    if (typeof credits !== "number") {
      lastCreditsRef.current = credits;
      return;
    }

    if (typeof previousCredits === "number" && credits !== previousCredits) {
      const spent = previousCredits - credits;
      if (spent > 0) {
        setReservedCredits((prev) => Math.max(0, prev - spent));
      }
    }

    lastCreditsRef.current = credits;
  }, [credits]);

  const effectiveCredits = useMemo(
    () => (typeof credits === "number" ? Math.max(0, credits - reservedCredits) : null),
    [credits, reservedCredits],
  );

  const activeCount = useMemo(
    () => queueItems.filter((item) => !isTerminal(item.status)).length,
    [queueItems],
  );
  const queuedCount = useMemo(
    () => queueItems.filter((item) => item.status === "queued" || item.status === "submitting").length,
    [queueItems],
  );
  const processingCount = useMemo(
    () => queueItems.filter((item) => item.status === "processing").length,
    [queueItems],
  );

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach((file: File) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImages((prev) => [...prev, reader.result as string].slice(0, 6));
      };
      reader.readAsDataURL(file);
    });
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  const pollSingleJob = useCallback(
    async (localId: string, jobId: string) => {
      if (inFlightRef.current.has(jobId)) return;
      inFlightRef.current.add(jobId);

      try {
        const next = await api.getGenerationJob(jobId);
        if (!mountedRef.current) return;

        failureCountsRef.current.delete(jobId);
        let successWithoutImageWarning: string | null = null;
        if (next.status === "succeeded" && !next.imageUrl) {
          const pendingCount = (urlPendingCountsRef.current.get(jobId) ?? 0) + 1;
          urlPendingCountsRef.current.set(jobId, pendingCount);
          if (pendingCount >= URL_PENDING_MAX_RETRY) {
            haltedUrlPollingRef.current.add(localId);
            successWithoutImageWarning =
              "图片地址仍不可用，请查看历史记录或点击此卡片重试。";
          } else if (pendingCount >= URL_PENDING_WARNING_THRESHOLD) {
            successWithoutImageWarning = "图片地址返回较慢，正在继续重试。";
          }
        } else {
          urlPendingCountsRef.current.delete(jobId);
          haltedUrlPollingRef.current.delete(localId);
          if (next.imageUrl) {
            imageLoadRetriesRef.current.delete(localId);
            imageReloadInFlightRef.current.delete(localId);
          }
        }

        setQueueItems((prev) =>
          prev.map((item) => {
            if (item.localId !== localId) return item;
            return {
              ...item,
              status: next.status,
              imageUrl: next.imageUrl ?? item.imageUrl,
              imageRenderFailed: next.imageUrl ? false : item.imageRenderFailed,
              error: next.status === "failed" ? (next.error ?? "生成失败") : item.error,
              syncWarning:
                next.status === "succeeded" && !next.imageUrl
                  ? successWithoutImageWarning
                  : next.imageUrl
                    ? null
                    : item.syncWarning,
            };
          }),
        );

        if (next.status === "succeeded" || next.status === "failed") {
          try {
            await onGenerationDone();
          } catch {
            // Ignore profile refresh failures; queue UI still reflects terminal state.
          }
        }
      } catch (error) {
        const retries = (failureCountsRef.current.get(jobId) ?? 0) + 1;
        failureCountsRef.current.set(jobId, retries);
        if (retries >= MAX_SYNC_RETRY_BEFORE_WARNING) {
          const message = error instanceof Error ? error.message : "状态同步异常";
          setQueueItems((prev) =>
            prev.map((item) =>
              item.localId === localId
                ? { ...item, syncWarning: `状态同步延迟：${message}，正在重试...` }
                : item,
            ),
          );
        }
      } finally {
        inFlightRef.current.delete(jobId);
      }
    },
    [onGenerationDone],
  );

  const refreshImageUrl = useCallback(
    async (localId: string, jobId: string) => {
      haltedUrlPollingRef.current.delete(localId);
      urlPendingCountsRef.current.delete(jobId);
      await pollSingleJob(localId, jobId);
    },
    [pollSingleJob],
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      queueItems.forEach((item) => {
        if (!item.jobId) return;
        if (
          item.status !== "queued" &&
          item.status !== "processing" &&
          !(item.status === "succeeded" && !item.imageUrl && !haltedUrlPollingRef.current.has(item.localId))
        ) {
          return;
        }
        void pollSingleJob(item.localId, item.jobId);
      });
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [queueItems, pollSingleJob]);

  const submitTask = useCallback(
    async (input: {
      prompt: string;
      referenceImages: string[];
      aspectRatio: string;
      imageSize: string;
      model: ImageModel;
    }) => {
      const localId = makeLocalId();
      const optimisticItem: GenerationQueueItem = {
        localId,
        jobId: null,
        promptSnapshot: input.prompt,
        referenceImages: input.referenceImages,
        createdAt: new Date().toISOString(),
        status: "submitting",
        imageUrl: null,
        imageRenderFailed: false,
        error: null,
        syncWarning: null,
        aspectRatio: input.aspectRatio,
        imageSize: input.imageSize,
        model: input.model,
      };

      setQueueItems((prev) => [optimisticItem, ...prev]);
      setSubmittingCount((prev) => prev + 1);
      setReservedCredits((prev) => prev + GENERATION_COST);
      setGlobalError(null);

      try {
        const created = await api.createGeneration(input, { timeoutMs: SUBMIT_TIMEOUT_MS });
        if (!mountedRef.current) return;

        setQueueItems((prev) =>
          prev.map((item) =>
            item.localId === localId
              ? {
                  ...item,
                  jobId: created.jobId,
                  status: "queued",
                  error: null,
                  syncWarning: null,
                }
              : item,
          ),
        );

        try {
          await onGenerationDone();
          if (mountedRef.current) {
            setReservedCredits((prev) => Math.max(0, prev - GENERATION_COST));
          }
        } catch {
          // Keep reservation when profile sync fails so local validation remains safe.
        }

        void pollSingleJob(localId, created.jobId);
      } catch (error) {
        let recovered: GenerationRecord | null = null;
        try {
          const history = await api.listHistory(RECOVERY_HISTORY_LIMIT, 0);
          const localCreatedAtMs = Date.parse(optimisticItem.createdAt);
          const targetPrompt = normalizePrompt(input.prompt);
          const candidates = history.items.filter((item) => {
            const createdAtMs = Date.parse(item.createdAt);
            if (!Number.isFinite(createdAtMs) || !Number.isFinite(localCreatedAtMs)) {
              return false;
            }
            if (Math.abs(createdAtMs - localCreatedAtMs) > RECOVERY_TIME_WINDOW_MS) {
              return false;
            }
            return (
              normalizePrompt(item.prompt) === targetPrompt &&
              item.model === input.model &&
              item.aspectRatio === input.aspectRatio &&
              item.imageSize === input.imageSize
            );
          });

          recovered =
            candidates
              .sort(
                (a, b) =>
                  Math.abs(Date.parse(a.createdAt) - localCreatedAtMs) -
                  Math.abs(Date.parse(b.createdAt) - localCreatedAtMs),
              )
              .at(0) ?? null;
        } catch {
          recovered = null;
        }

        if (!mountedRef.current) return;

        if (recovered) {
          imageLoadRetriesRef.current.delete(localId);
          imageReloadInFlightRef.current.delete(localId);
          setQueueItems((prev) =>
            prev.map((item) =>
              item.localId === localId
                ? {
                    ...item,
                    jobId: recovered.id,
                    status: recovered.status,
                    imageUrl: recovered.imageUrl,
                    imageRenderFailed: false,
                    error: recovered.error,
                    createdAt: recovered.createdAt,
                    syncWarning: "提交响应中断，已从历史记录恢复任务。",
                  }
                : item,
            ),
          );

          if (!isTerminal(recovered.status)) {
            void pollSingleJob(localId, recovered.id);
          } else {
            try {
              await onGenerationDone();
              if (mountedRef.current) {
                setReservedCredits((prev) => Math.max(0, prev - GENERATION_COST));
              }
            } catch {
              // Keep reservation when profile sync fails so local validation remains safe.
            }
          }
          return;
        }

        const message = error instanceof Error ? error.message : "加入生成队列失败";
        setQueueItems((prev) =>
          prev.map((item) =>
            item.localId === localId
              ? {
                  ...item,
                  status: "failed",
                  error: message,
                }
              : item,
          ),
        );
        setReservedCredits((prev) => Math.max(0, prev - GENERATION_COST));
        setGlobalError(message);

        try {
          await onGenerationDone();
        } catch {
          // Keep queue item error as primary feedback.
        }
      } finally {
        if (mountedRef.current) {
          setSubmittingCount((prev) => Math.max(0, prev - 1));
        }
      }
    },
    [onGenerationDone, pollSingleJob],
  );

  const handleGenerate = () => {
    if (effectiveCredits === null) {
      setGlobalError("点数仍在加载中，请稍候。");
      return;
    }
    if (effectiveCredits < GENERATION_COST) {
      setGlobalError("点数不足，请先充值再生成。");
      return;
    }
    if (!prompt && images.length === 0) {
      setGlobalError("请填写提示词，或至少上传一张参考图。");
      return;
    }
    void submitTask({
      prompt,
      referenceImages: images,
      aspectRatio,
      imageSize: size,
      model,
    });
  };

  const handleRetry = (item: GenerationQueueItem) => {
    if (effectiveCredits === null) {
      setGlobalError("点数仍在加载中，请稍候。");
      return;
    }
    if (effectiveCredits < GENERATION_COST) {
      setGlobalError("点数不足，无法重试该任务。");
      return;
    }
    void submitTask({
      prompt: item.promptSnapshot,
      referenceImages: item.referenceImages,
      aspectRatio: item.aspectRatio,
      imageSize: item.imageSize,
      model: item.model,
    });
  };

  const handleImageRenderError = (item: GenerationQueueItem) => {
    if (!item.jobId) return;

    const retries = (imageLoadRetriesRef.current.get(item.localId) ?? 0) + 1;
    imageLoadRetriesRef.current.set(item.localId, retries);

    const exceeded = retries >= IMAGE_RENDER_RETRY_MAX;
    setQueueItems((prev) =>
      prev.map((x) =>
        x.localId === item.localId
          ? {
              ...x,
              imageRenderFailed: true,
              syncWarning: exceeded
                ? "浏览器加载图片失败，请点击重试获取新链接。"
                : `图片加载中断（${retries}/${IMAGE_RENDER_RETRY_MAX}），正在重试...`,
            }
          : x,
      ),
    );

    if (exceeded || imageReloadInFlightRef.current.has(item.localId)) {
      return;
    }

    imageReloadInFlightRef.current.add(item.localId);
    const delay = IMAGE_RENDER_RETRY_DELAY_MS * retries;
    window.setTimeout(() => {
      void (async () => {
        try {
          await refreshImageUrl(item.localId, item.jobId!);
        } finally {
          imageReloadInFlightRef.current.delete(item.localId);
        }
      })();
    }, delay);
  };

  return (
    <div
      aria-hidden={!isVisible}
      className="p-6 md:p-10 w-full min-h-full flex flex-col"
    >
      <header className="mb-10">
        <h1 className="font-display text-4xl md:text-5xl uppercase mb-2">生成协议</h1>
        <p className="font-mono text-xs opacity-60 uppercase tracking-widest">
          [ INITIALIZE SYNTHESIS ]
        </p>
      </header>

      {globalError && (
        <div className="mb-6 p-3 border rounded-lg font-mono text-xs bg-red-500/20 border-red-300/40 text-red-200">
          {globalError}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 flex-1">
        <div className="lg:col-span-4 xl:col-span-3 space-y-8">
          <div className="space-y-3">
            <label className="block font-mono text-[10px] uppercase opacity-70">提示词</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="请描述你想生成的内容..."
              className="w-full bg-[#3A4A54]/30 border border-white/20 rounded-xl p-4 font-sans text-sm min-h-[120px] focus:outline-none focus:border-white/50 transition-colors resize-none placeholder:opacity-40"
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="block font-mono text-[10px] uppercase opacity-70">
                参考图片
              </label>
              <span className="font-mono text-[10px] opacity-50">{images.length}/6</span>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {images.map((img, i) => (
                <div
                  key={i}
                  className="relative aspect-square rounded-lg overflow-hidden border border-white/20 group"
                >
                  <img
                    src={img}
                    alt={`参考图 ${i + 1}`}
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                  <button
                    onClick={() => removeImage(i)}
                    className="absolute top-1 right-1 bg-black/50 p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              {images.length < 6 && (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="aspect-square rounded-lg border border-dashed border-white/30 flex flex-col items-center justify-center gap-2 hover:bg-white/5 transition-colors opacity-70 hover:opacity-100"
                >
                  <Upload className="w-4 h-4" />
                  <span className="font-mono text-[8px] uppercase">Upload</span>
                </button>
              )}
            </div>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleImageUpload}
              accept="image/*"
              multiple
              className="hidden"
            />
          </div>

          <div className="space-y-4 border-t border-white/10 pt-6">
            <div className="flex items-center gap-2 mb-4">
              <Settings2 className="w-4 h-4 opacity-70" />
              <h3 className="font-mono text-xs uppercase tracking-widest">Generation settings</h3>
            </div>

            <div>
              <label className="block font-mono text-[10px] uppercase opacity-70 mb-2">Model</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setModel("v2")}
                  className={`rounded-lg border p-2 font-mono text-xs uppercase transition-colors ${
                    model === "v2"
                      ? "bg-white text-[#647B8C] border-white"
                      : "bg-[#3A4A54]/30 border-white/20 hover:bg-white/10"
                  }`}
                >
                  v2
                </button>
                <button
                  onClick={() => setModel("pro")}
                  className={`rounded-lg border p-2 font-mono text-xs uppercase transition-colors ${
                    model === "pro"
                      ? "bg-white text-[#647B8C] border-white"
                      : "bg-[#3A4A54]/30 border-white/20 hover:bg-white/10"
                  }`}
                >
                  Pro
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block font-mono text-[10px] uppercase opacity-70 mb-2">
                  宽高比
                </label>
                <select
                  value={aspectRatio}
                  onChange={(e) => setAspectRatio(e.target.value)}
                  className="w-full bg-[#3A4A54]/30 border border-white/20 rounded-lg p-2 font-mono text-xs focus:outline-none focus:border-white/50 appearance-none"
                >
                  {ASPECT_RATIO_PRESETS.map((ratio) => (
                    <option key={ratio} value={ratio}>
                      {ratio}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-mono text-[10px] uppercase opacity-70 mb-2">
                  质量
                </label>
                <select
                  value={size}
                  onChange={(e) => setSize(e.target.value)}
                  className="w-full bg-[#3A4A54]/30 border border-white/20 rounded-lg p-2 font-mono text-xs focus:outline-none focus:border-white/50 appearance-none"
                >
                  <option value="1K">1K</option>
                  <option value="2K">2K</option>
                  <option value="4K">4K</option>
                </select>
              </div>
            </div>
          </div>

          <button
            onClick={handleGenerate}
            disabled={effectiveCredits === null}
            className="w-full bg-white text-[#647B8C] font-mono text-sm uppercase py-4 rounded-xl hover:bg-opacity-90 transition-colors flex items-center justify-center gap-2 mt-8 shadow-[0_0_20px_rgba(255,255,255,0.2)] disabled:opacity-60"
          >
            {submittingCount > 0 ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                提交中... ({submittingCount})
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" /> 开始生成（-50 点）
              </>
            )}
          </button>

          <div className="font-mono text-[10px] opacity-60 uppercase tracking-widest">
            当前可用：{effectiveCredits ?? "..."} 点
          </div>
        </div>

        <div className="lg:col-span-8 xl:col-span-9 flex flex-col">
          <div className="bg-[#3A4A54]/10 border border-white/10 rounded-2xl flex-1 min-h-[600px] overflow-hidden relative backdrop-blur-sm">
            <div className="absolute inset-0 pointer-events-none">
              <div
                className="w-full h-full"
                style={{
                  backgroundImage:
                    "linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)",
                  backgroundSize: "40px 40px",
                }}
              />
            </div>

            <div className="relative z-10 h-full flex flex-col">
              <div className="px-4 md:px-6 py-4 border-b border-white/10 flex items-center justify-between gap-4">
                <div>
                  <h3 className="font-display text-2xl uppercase">任务队列</h3>
                  <p className="font-mono text-[10px] uppercase opacity-60 tracking-widest">
                    结果与状态将在此实时更新
                  </p>
                  <p className="font-mono text-[10px] uppercase opacity-45 tracking-widest mt-1">
                    你浏览其他标签页时，后台也会持续更新。
                  </p>
                </div>
                <div className="font-mono text-[10px] uppercase opacity-70 text-right">
                  <div>活跃: {activeCount}</div>
                  <div>排队: {queuedCount}</div>
                  <div>处理中: {processingCount}</div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 md:p-6">
                {queueItems.length === 0 ? (
                  <div className="h-full min-h-[420px] flex flex-col items-center justify-center gap-4 opacity-35">
                    <ImageIcon className="w-16 h-16" />
                    <p className="font-mono text-xs uppercase tracking-widest text-center max-w-xs">
                      等待输入。
                      <br />
                      生成结果会显示在这里。
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
                      {queueItems.map((item) => (
                        <div
                          key={item.localId}
                          className="group bg-[#3A4A54]/20 border border-white/10 rounded-lg overflow-hidden hover:border-white/30 transition-colors flex flex-col"
                        >
                          <div className="aspect-square relative overflow-hidden bg-[#0a0f14]">
                            {item.status === "succeeded" && item.imageUrl && !item.imageRenderFailed ? (
                              <>
                                <img
                                  src={item.imageUrl}
                                  alt="已生成图片"
                                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 opacity-90 group-hover:opacity-100"
                                  referrerPolicy="no-referrer"
                                  onError={() => handleImageRenderError(item)}
                                />
                                <button
                                  onClick={() => {
                                    setEnlargedImage(item.imageUrl);
                                    setEnlargedPrompt(item.promptSnapshot);
                                  }}
                                  className="absolute top-3 right-3 bg-black/50 backdrop-blur-md p-2 rounded-full border border-white/20 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white/20"
                                >
                                  <Maximize2 className="w-4 h-4" />
                                </button>
                              </>
                            ) : item.status === "failed" ? (
                              <div className="w-full h-full p-3 flex flex-col items-center justify-center text-center gap-2">
                                <p className="font-mono text-[10px] uppercase text-red-200">
                                  {item.error ?? "生成失败"}
                                </p>
                                <button
                                  onClick={() => handleRetry(item)}
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-white/30 hover:bg-white/10 transition-colors font-mono text-[10px] uppercase"
                                >
                                  <RotateCcw className="w-3 h-3" />
                                  重试
                                </button>
                              </div>
                            ) : item.status === "succeeded" ? (
                              <div className="w-full h-full flex flex-col items-center justify-center gap-2 opacity-80 p-3">
                                <ImageIcon className="w-6 h-6" />
                                <p className="font-mono text-[10px] uppercase tracking-widest text-center px-3">
                                  {item.imageRenderFailed
                                    ? "图片加载中断。"
                                    : "已完成，正在加载图片链接..."}
                                </p>
                                {item.jobId && (
                                  <button
                                    onClick={() => {
                                      imageLoadRetriesRef.current.delete(item.localId);
                                      imageReloadInFlightRef.current.delete(item.localId);
                                      setQueueItems((prev) =>
                                        prev.map((x) =>
                                          x.localId === item.localId
                                            ? { ...x, imageRenderFailed: false, syncWarning: null }
                                            : x,
                                        ),
                                      );
                                      void refreshImageUrl(item.localId, item.jobId);
                                    }}
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-white/30 hover:bg-white/10 transition-colors font-mono text-[10px] uppercase"
                                  >
                                    <RotateCcw className="w-3 h-3" />
                                    重试加载图片
                                  </button>
                                )}
                              </div>
                            ) : (
                              <div className="w-full h-full flex flex-col items-center justify-center gap-2 opacity-70">
                                <Loader2 className="w-5 h-5 animate-spin" />
                                <p className="font-mono text-[10px] uppercase tracking-widest text-center px-3">
                                  {item.status === "submitting"
                                    ? "提交中..."
                                    : item.status === "queued"
                                      ? "排队中..."
                                      : "生成中..."}
                                </p>
                              </div>
                            )}

                            <div className="absolute top-2 left-2 flex items-center gap-2">
                              <span
                                className={`px-2 py-1 rounded-full border font-mono text-[10px] uppercase tracking-widest backdrop-blur-sm ${statusBadgeClass(item.status)}`}
                              >
                                {statusLabel(item.status)}
                              </span>
                              <span className="px-2 py-1 rounded-full border border-white/30 bg-black/40 font-mono text-[10px] uppercase tracking-widest">
                                {modelLabel(item.model)}
                              </span>
                            </div>
                          </div>

                          <div className="p-2.5 flex-1 flex flex-col justify-between">
                            <p
                              className="font-sans text-xs line-clamp-2 opacity-80 mb-1.5"
                              title={item.promptSnapshot || "未填写提示词"}
                            >
                              {item.promptSnapshot || "未填写提示词"}
                            </p>
                            <p className="font-mono text-[9px] opacity-50 uppercase">
                              {new Date(item.createdAt).toLocaleString()}
                            </p>
                            {item.syncWarning && (
                              <p className="font-mono text-[9px] opacity-70 mt-1.5 uppercase">
                                {item.syncWarning}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {enlargedImage && (
        <ImageModal
          url={enlargedImage}
          prompt={enlargedPrompt ?? undefined}
          onClose={() => {
            setEnlargedImage(null);
            setEnlargedPrompt(null);
          }}
        />
      )}
    </div>
  );
}
