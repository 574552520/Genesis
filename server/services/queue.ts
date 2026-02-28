import { generateImageBuffer } from "./gemini";
import { setJobFailedAndRefund, setJobProcessing, setJobSucceeded } from "./db";
import { uploadGeneratedImage } from "./storage";
import type { QueueJobPayload } from "../types";

const queue: QueueJobPayload[] = [];
let processing = false;

async function processNext(): Promise<void> {
  if (processing) return;

  const job = queue.shift();
  if (!job) return;

  processing = true;
  try {
    await setJobProcessing(job.jobId);

    const image = await generateImageBuffer({
      prompt: job.prompt,
      referenceImages: job.referenceImages,
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

    await setJobSucceeded(job.jobId, imagePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generation failed";
    try {
      await setJobFailedAndRefund(job.jobId, message);
    } catch (refundError) {
      console.error("Failed to mark generation as failed/refunded:", refundError);
    }
  } finally {
    processing = false;
    void processNext();
  }
}

export function enqueueGenerationJob(payload: QueueJobPayload): void {
  queue.push(payload);
  void processNext();
}

export function queueSnapshot(): { waiting: number; processing: boolean } {
  return { waiting: queue.length, processing };
}
