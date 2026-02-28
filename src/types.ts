export type ViewState = "landing" | "auth" | "dashboard";
export type JobStatus = "queued" | "processing" | "succeeded" | "failed";
export type CreditTier = "standard" | "pro" | "enterprise";
export type ImageModel = "pro" | "v2";

export interface UserProfile {
  userId: string;
  email: string;
  credits: number;
  createdAt: string;
}

export interface GenerationJob {
  id: string;
  prompt: string;
  aspectRatio: string;
  imageSize: string;
  model: ImageModel;
  status: JobStatus;
  error: string | null;
  imageUrl: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface GenerationRecord {
  id: string;
  prompt: string;
  aspectRatio: string;
  imageSize: string;
  model: ImageModel;
  status: JobStatus;
  error: string | null;
  imageUrl: string | null;
  createdAt: string;
  completedAt: string | null;
}
