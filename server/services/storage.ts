import { adminClient, storageBucket } from "./db";

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
