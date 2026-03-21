import { Router } from "express";
import multer from "multer";
import { uploadUserImage } from "../services/storage.js";

const router = Router();

const MAX_FILES = 6;
const MAX_FILE_SIZE_MB = Number(process.env.UPLOAD_IMAGE_MAX_FILE_MB ?? 25);
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: MAX_FILES,
    fileSize: MAX_FILE_SIZE_BYTES,
  },
});

router.post("/images", (req, res, next) => {
  upload.array("images", MAX_FILES)(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    if (error instanceof multer.MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({
          error: `单张图片不能超过 ${MAX_FILE_SIZE_MB}MB`,
        });
        return;
      }

      if (error.code === "LIMIT_FILE_COUNT") {
        res.status(400).json({
          error: `最多只能上传 ${MAX_FILES} 张图片`,
        });
        return;
      }
    }

    next(error);
  });
}, async (req, res) => {
  const files = Array.isArray(req.files) ? req.files : [];
  if (!req.user?.id) {
    res.status(401).json({ error: "Missing authenticated user" });
    return;
  }
  if (!files.length) {
    res.status(400).json({ error: "Please upload at least one image" });
    return;
  }
  if (files.length > MAX_FILES) {
    res.status(400).json({ error: `最多只能上传 ${MAX_FILES} 张图片` });
    return;
  }

  for (const file of files) {
    if (!file.mimetype.startsWith("image/")) {
      res.status(400).json({ error: "仅支持图片文件" });
      return;
    }
  }

  try {
    const items = await Promise.all(
      files.map(async (file) => {
        const uploaded = await uploadUserImage({
          userId: req.user!.id,
          buffer: file.buffer,
          mimeType: file.mimetype,
        });
        return {
          ref: uploaded.ref,
          previewUrl: uploaded.previewUrl,
          mimeType: file.mimetype,
          sizeBytes: file.size,
        };
      }),
    );

    res.status(201).json({ items });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to upload images";
    res.status(500).json({ error: message });
  }
});

export default router;
