import { Router } from "express";
import {
  createGenerationJobAtomic,
  createSignedImageUrl,
  deleteJobForUser,
  getJobByIdForUser,
  listJobsForUser,
} from "../services/db";
import { enqueueGenerationJob } from "../services/queue";
import { deleteGeneratedImage } from "../services/storage";
import type { ImageModel } from "../types";

const router = Router();
const validModels: ImageModel[] = ["pro", "v2"];

router.post("/", async (req, res) => {
  try {
    const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
    const referenceImages = Array.isArray(req.body?.referenceImages)
      ? req.body.referenceImages.filter((x: unknown) => typeof x === "string").slice(0, 6)
      : [];
    const aspectRatio =
      typeof req.body?.aspectRatio === "string" ? req.body.aspectRatio : "1:1";
    const imageSize = typeof req.body?.imageSize === "string" ? req.body.imageSize : "1K";
    const modelRaw = typeof req.body?.model === "string" ? req.body.model : "v2";
    const model = validModels.includes(modelRaw as ImageModel) ? (modelRaw as ImageModel) : null;

    if (!prompt && referenceImages.length === 0) {
      res.status(400).json({ error: "Provide prompt or at least one reference image" });
      return;
    }
    if (!model) {
      res.status(400).json({ error: "Invalid model. Use pro or v2." });
      return;
    }

    const jobId = await createGenerationJobAtomic({
      userId: req.user!.id,
      prompt,
      aspectRatio,
      imageSize,
      model,
    });

    enqueueGenerationJob({
      jobId,
      userId: req.user!.id,
      prompt,
      referenceImages,
      aspectRatio,
      imageSize,
      model,
    });

    res.status(202).json({ jobId, status: "queued" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create generation";
    if (message.toLowerCase().includes("insufficient credits")) {
      res.status(400).json({ error: message });
      return;
    }
    res.status(500).json({ error: message });
  }
});

router.get("/jobs/:jobId", async (req, res) => {
  try {
    const job = await getJobByIdForUser(req.user!.id, req.params.jobId);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    let imageUrl: string | null = null;
    if (job.result_image_path) {
      try {
        imageUrl = await createSignedImageUrl(job.result_image_path);
      } catch (error) {
        console.warn("Signed URL generation warning (jobs route):", {
          jobId: job.id,
          message: error instanceof Error ? error.message : "Unknown signed URL error",
        });
        imageUrl = null;
      }
    }

    res.json({
      job: {
        id: job.id,
        prompt: job.prompt,
        aspectRatio: job.aspect_ratio,
        imageSize: job.image_size,
        model: job.model,
        status: job.status,
        error: job.error,
        imageUrl,
        createdAt: job.created_at,
        startedAt: job.started_at,
        completedAt: job.completed_at,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to get job";
    res.status(500).json({ error: message });
  }
});

router.get("/history", async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 20)));
    const offset = Math.max(0, Number(req.query.offset ?? 0));
    const jobs = await listJobsForUser({
      userId: req.user!.id,
      limit,
      offset,
    });

    const items = await Promise.all(
      jobs.map(async (job) => {
        let imageUrl: string | null = null;
        if (job.result_image_path) {
          try {
            imageUrl = await createSignedImageUrl(job.result_image_path);
          } catch {
            imageUrl = null;
          }
        }
        return {
          id: job.id,
          prompt: job.prompt,
          aspectRatio: job.aspect_ratio,
          imageSize: job.image_size,
          model: job.model,
          status: job.status,
          error: job.error,
          imageUrl,
          createdAt: job.created_at,
          completedAt: job.completed_at,
        };
      }),
    );

    res.json({
      items,
      limit,
      offset,
      hasMore: jobs.length === limit,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load history";
    res.status(500).json({ error: message });
  }
});

router.delete("/:jobId", async (req, res) => {
  try {
    const result = await deleteJobForUser({
      userId: req.user!.id,
      jobId: req.params.jobId,
    });
    if (!result.deleted) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    if (result.imagePath) {
      try {
        await deleteGeneratedImage(result.imagePath);
      } catch (error) {
        console.error("Storage deletion warning:", error);
      }
    }

    res.json({ deleted: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete job";
    res.status(500).json({ error: message });
  }
});

export default router;
