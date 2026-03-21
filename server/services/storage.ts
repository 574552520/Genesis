import { randomUUID } from "node:crypto";
import { adminClient, storageBucket } from "./db.js";

function rewriteSignedUrlToPublicBase(rawUrl: string): string {
  const publicBase = (process.env.SUPABASE_PUBLIC_URL ?? "https://db.xn--rhqy77ef4l.top").replace(/\/+$/, "");

  if (/^https?:\/\//i.test(rawUrl)) {
    try {
      const url = new URL(rawUrl);
      return `${publicBase}${url.pathname}${url.search}`;
    } catch {
      return rawUrl;
    }
  }

  return `${publicBase}${rawUrl.startsWith("/") ? rawUrl : `/${rawUrl}`}`;
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

export async function uploadGeneratedImage(params: {
  userId: string;
  jobId: string;
  buffer: Buffer;
  mimeType: string;
}): Promise<string> {
  const extension = extensionForMimeType(params.mimeType);
  const path = `${params.userId}/${params.jobId}.${extension}`;

  const { error } = await adminClient.storage.from(storageBucket).upload(path, params.buffer, {
    contentType: params.mimeType,
    upsert: true,
  });

  if (error) {
    throw new Error(error.message);
  }

  return path;
}

export async function deleteGeneratedImage(path: string): Promise<void> {
  const { error } = await adminClient.storage.from(storageBucket).remove([path]);
  if (error) {
    throw new Error(error.message);
  }
}

function uploadExtensionForMimeType(mimeType: string): string {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";
  return extensionForMimeType(mimeType);
}

export async function uploadUserImage(params: {
  userId: string;
  buffer: Buffer;
  mimeType: string;
}): Promise<{ ref: string; path: string; previewUrl: string; sizeBytes: number }> {
  const extension = uploadExtensionForMimeType(params.mimeType);
  const fileId = randomUUID();
  const path = `${params.userId}/uploads/${fileId}.${extension}`;

  const { error } = await adminClient.storage.from(storageBucket).upload(path, params.buffer, {
    contentType: params.mimeType,
    upsert: false,
  });

  if (error) {
    throw new Error(error.message);
  }

  const { data: signed, error: signedError } = await adminClient.storage.from(storageBucket).createSignedUrl(path, 60 * 60);
  if (signedError || !signed?.signedUrl) {
    throw new Error(signedError?.message ?? "Failed to create preview url");
  }

  return {
    ref: `storage://${storageBucket}/${path}`,
    path,
    previewUrl: rewriteSignedUrlToPublicBase(signed.signedUrl),
    sizeBytes: params.buffer.byteLength,
  };
}

export async function downloadStorageReference(ref: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const match = /^storage:\/\/([^/]+)\/(.+)$/.exec(ref.trim());
  if (!match) {
    throw new Error("Invalid storage reference");
  }
  const [, bucket, path] = match;
  const { data, error } = await adminClient.storage.from(bucket).download(path);
  if (error || !data) {
    throw new Error(error?.message ?? "Failed to download storage reference");
  }
  const buffer = Buffer.from(await data.arrayBuffer());
  const mimeType = (data.type || "application/octet-stream").split(";")[0].trim();
  return { buffer, mimeType };
}
