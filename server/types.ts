export type JobStatus = "queued" | "processing" | "succeeded" | "failed";
export type ImageModel = "pro" | "v2";

export interface UserProfile {
  userId: string;
  email: string;
  credits: number;
  creditsExpiresAt: string | null;
  createdAt: string;
}

export interface GenerationCreateInput {
  prompt: string;
  referenceImages: string[];
  aspectRatio: string;
  imageSize: string;
  model: ImageModel;
}

export interface GenerationJobRow {
  id: string;
  user_id: string;
  prompt: string;
  aspect_ratio: string;
  image_size: string;
  model: ImageModel;
  status: JobStatus;
  error: string | null;
  result_image_path: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface GenerationHistoryItem {
  id: string;
  prompt: string;
  aspectRatio: string;
  imageSize: string;
  model: ImageModel;
  status: JobStatus;
  imageUrl: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface QueueJobPayload {
  jobId: string;
  userId: string;
  prompt: string;
  referenceImages: string[];
  aspectRatio: string;
  imageSize: string;
  model: ImageModel;
}
