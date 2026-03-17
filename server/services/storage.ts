import { randomUUID } from "node:crypto";
import path from "node:path";
import { adminClient, storageBucket } from "./db.js";

const STORAGE_REF_PREFIX = "storage://";

function extensionForMimeType(mimeType: string, originalFilename?: string | null): string {
  const originalExtension = path.extname(originalFilename ?? "").replace(/^\./, "").trim().toLowerCase();
  if (originalExtension) {
    return originalExtension;
  }
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";
  return "png";
}

function storageClient(bucket = storageBucket) {
  return adminClient.storage.from(bucket);
}

export function buildStorageRef(bucket: string, objectPath: string): string {
  return `${STORAGE_REF_PREFIX}${bucket}/${objectPath}`;
}

export function parseStorageRef(value: string): { bucket: string; path: string } | null {
  if (!value.startsWith(STORAGE_REF_PREFIX)) return null;
  const payload = value.slice(STORAGE_REF_PREFIX.length);
  const slashIndex = payload.indexOf("/");
  if (slashIndex <= 0 || slashIndex === payload.length - 1) return null;
  return {
    bucket: payload.slice(0, slashIndex),
    path: payload.slice(slashIndex + 1),
  };
}

async function uploadBuffer(params: {
  bucket?: string;
  path: string;
  buffer: Buffer;
  mimeType: string;
}): Promise<void> {
  const { error } = await storageClient(params.bucket).upload(params.path, params.buffer, {
    contentType: params.mimeType,
    upsert: true,
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function uploadGeneratedImage(params: {
  userId: string;
  jobId: string;
  buffer: Buffer;
  mimeType: string;
}): Promise<string> {
  const extension = extensionForMimeType(params.mimeType);
  const path = `${params.userId}/${params.jobId}.${extension}`;
  await uploadBuffer({
    path,
    buffer: params.buffer,
    mimeType: params.mimeType,
  });

  return path;
}

export async function uploadInputImage(params: {
  userId: string;
  buffer: Buffer;
  mimeType: string;
  originalFilename?: string | null;
}): Promise<{ bucket: string; path: string; ref: string }> {
  const extension = extensionForMimeType(params.mimeType, params.originalFilename);
  const objectPath = `${params.userId}/uploads/${randomUUID()}.${extension}`;
  await uploadBuffer({
    path: objectPath,
    buffer: params.buffer,
    mimeType: params.mimeType,
  });

  return {
    bucket: storageBucket,
    path: objectPath,
    ref: buildStorageRef(storageBucket, objectPath),
  };
}

export async function createSignedStorageUrl(params: {
  bucket?: string;
  path: string;
  expiresInSeconds?: number;
}): Promise<string> {
  const { data, error } = await storageClient(params.bucket).createSignedUrl(
    params.path,
    params.expiresInSeconds ?? 60 * 60,
  );

  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? "Failed to create signed URL");
  }

  return data.signedUrl;
}

export async function downloadStorageRef(ref: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const parsed = parseStorageRef(ref);
  if (!parsed) {
    throw new Error("Invalid storage reference");
  }

  const { data, error } = await storageClient(parsed.bucket).download(parsed.path);
  if (error || !data) {
    throw new Error(error?.message ?? "Failed to download storage object");
  }

  const buffer = Buffer.from(await data.arrayBuffer());
  const mimeType = data.type || "application/octet-stream";
  return { buffer, mimeType };
}

export async function deleteGeneratedImage(path: string): Promise<void> {
  const { error } = await storageClient().remove([path]);
  if (error) {
    throw new Error(error.message);
  }
}
