import { generateImageBuffer } from "./gemini.js";
import { setJobFailedAndRefund, setJobProcessing, setJobSucceeded } from "./db.js";
import { uploadGeneratedImage } from "./storage.js";
import type { QueueJobPayload } from "../types.js";

const MAX_CONCURRENCY = Math.max(1, Number(process.env.GENERATION_MAX_CONCURRENCY ?? 3));
const LANE_ORDER: QueueJobPayload["lane"][] = [
  "generator",
  "launch_pack",
  "try_on",
  "lookbook",
  "flatlay",
  "invisible_mannequin_3d",
];
const queueByLane: Record<QueueJobPayload["lane"], QueueJobPayload[]> = {
  generator: [],
  launch_pack: [],
  try_on: [],
  lookbook: [],
  flatlay: [],
  invisible_mannequin_3d: [],
};
let activeCount = 0;
let laneCursor = 0;
const queueDebugLog = process.env.QUEUE_DEBUG_LOG !== "0";

function logQueue(event: string, meta: Record<string, unknown>): void {
  if (!queueDebugLog) return;
  console.log(`[QUEUE] ${event} ${JSON.stringify(meta)}`);
}

function waitingTotal(): number {
  return LANE_ORDER.reduce((sum, lane) => sum + queueByLane[lane].length, 0);
}

function pullNextJob(): QueueJobPayload | null {
  for (let i = 0; i < LANE_ORDER.length; i += 1) {
    const idx = (laneCursor + i) % LANE_ORDER.length;
    const lane = LANE_ORDER[idx];
    const next = queueByLane[lane].shift();
    if (next) {
      laneCursor = (idx + 1) % LANE_ORDER.length;
      return next;
    }
  }
  return null;
}

async function processJob(job: QueueJobPayload): Promise<void> {
  const startedAt = Date.now();
  logQueue("job.start", {
    jobId: job.jobId,
    lane: job.lane,
    model: job.model,
    referenceImages: job.referenceImages.length,
    promptLen: job.prompt.length,
    imageSize: job.imageSize,
    aspectRatio: job.aspectRatio,
  });
  try {
    await setJobProcessing(job.jobId);
    logQueue("job.processing", { jobId: job.jobId });

    const image = await generateImageBuffer({
      prompt: job.prompt,
      referenceImages: job.referenceImages,
      lane: job.lane,
      aspectRatio: job.aspectRatio,
      imageSize: job.imageSize,
      model: job.model,
    });

    const imagePath = await uploadGeneratedImage({
      userId: job.userId,
      jobId: job.jobId,
      buffer: image.buffer,
      mimeType: image.mimeType,
    });
    logQueue("job.succeeded", {
      jobId: job.jobId,
      elapsedMs: Date.now() - startedAt,
      imageSize: image.buffer.byteLength,
    });
    await setJobSucceeded(job.jobId, imagePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generation failed";
    logQueue("job.failed", {
      jobId: job.jobId,
      lane: job.lane,
      elapsedMs: Date.now() - startedAt,
      message,
    });
    try {
      await setJobFailedAndRefund(job.jobId, message);
    } catch (refundError) {
      logQueue("job.failed_refund_error", {
        jobId: job.jobId,
        error: refundError instanceof Error ? refundError.message : String(refundError),
      });
    }
  }
}

function kickWorkers(): void {
  while (activeCount < MAX_CONCURRENCY && waitingTotal() > 0) {
    const job = pullNextJob();
    if (!job) return;
    activeCount += 1;
    void (async () => {
      try {
        await processJob(job);
      } finally {
        activeCount = Math.max(0, activeCount - 1);
        kickWorkers();
      }
    })();
  }
}

export function enqueueGenerationJob(payload: QueueJobPayload): void {
  queueByLane[payload.lane].push(payload);
  kickWorkers();
}

export function queueSnapshot(): {
  waiting: number;
  processing: boolean;
  activeCount: number;
  maxConcurrency: number;
  waitingTotal: number;
  waitingByLane: Record<QueueJobPayload["lane"], number>;
} {
  const waitingByLane = {
    generator: queueByLane.generator.length,
    launch_pack: queueByLane.launch_pack.length,
    try_on: queueByLane.try_on.length,
    lookbook: queueByLane.lookbook.length,
    flatlay: queueByLane.flatlay.length,
    invisible_mannequin_3d: queueByLane.invisible_mannequin_3d.length,
  };
  return {
    waiting: waitingTotal(),
    processing: activeCount > 0,
    activeCount,
    maxConcurrency: MAX_CONCURRENCY,
    waitingTotal: waitingTotal(),
    waitingByLane,
  };
}
