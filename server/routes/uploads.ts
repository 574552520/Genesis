import { Router } from "express";
import type { Request, Response } from "express";
import multer from "multer";
import { createSignedStorageUrl, uploadInputImage } from "../services/storage.js";

const router = Router();

const maxUploadFiles = clamp(Number(process.env.UPLOAD_MAX_FILES ?? 6), 1, 6);
const maxUploadFileBytes = parseByteLimit(process.env.UPLOAD_IMAGE_MAX_BYTES?.trim() || "15mb");
const maxUploadTotalBytes = parseByteLimit(process.env.UPLOAD_TOTAL_MAX_BYTES?.trim() || "60mb");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: maxUploadFiles,
    fileSize: maxUploadFileBytes,
  },
  fileFilter: (_req, file, callback) => {
    if (!file.mimetype.startsWith("image/")) {
      callback(new Error("Only image files are allowed"));
      return;
    }
    callback(null, true);
  },
});

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseByteLimit(input: string): number {
  const normalized = input.trim().toLowerCase();
  const match = normalized.match(/^(\d+)(b|kb|mb|gb)?$/);
  if (!match) return 15 * 1024 * 1024;

  const value = Number(match[1]);
  const unit = match[2] ?? "b";
  const multiplier =
    unit === "gb"
      ? 1024 * 1024 * 1024
      : unit === "mb"
        ? 1024 * 1024
        : unit === "kb"
          ? 1024
          : 1;

  return Math.max(1, value * multiplier);
}

function runUploadMiddleware(req: Request, res: Response): Promise<void> {
  return new Promise((resolve, reject) => {
    upload.array("images", maxUploadFiles)(req, res, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

router.post("/images", async (req, res) => {
  try {
    await runUploadMiddleware(req, res);
  } catch (error) {
    if (error instanceof multer.MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({
          error: `Single image exceeds upload limit (${maxUploadFileBytes} bytes).`,
        });
        return;
      }
      if (error.code === "LIMIT_FILE_COUNT") {
        res.status(400).json({ error: `At most ${maxUploadFiles} images can be uploaded at once.` });
        return;
      }
    }

    const message = error instanceof Error ? error.message : "Image upload failed";
    res.status(400).json({ error: message });
    return;
  }

  const files = ((req.files as Express.Multer.File[] | undefined) ?? []).filter(Boolean);
  if (files.length < 1) {
    res.status(400).json({ error: "Upload at least one image." });
    return;
  }

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > maxUploadTotalBytes) {
    res.status(413).json({
      error: `Total upload payload too large. Keep combined images under ${maxUploadTotalBytes} bytes.`,
    });
    return;
  }

  try {
    const uploaded = await Promise.all(
      files.map(async (file) => {
        const stored = await uploadInputImage({
          userId: req.user!.id,
          buffer: file.buffer,
          mimeType: file.mimetype,
          originalFilename: file.originalname,
        });

        return {
          ref: stored.ref,
          previewUrl: await createSignedStorageUrl({
            bucket: stored.bucket,
            path: stored.path,
          }),
          mimeType: file.mimetype,
          sizeBytes: file.size,
        };
      }),
    );

    res.status(201).json({ images: uploaded });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Image upload failed";
    res.status(500).json({ error: message });
  }
});

export default router;
