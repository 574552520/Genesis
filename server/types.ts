export type JobStatus = "queued" | "processing" | "succeeded" | "failed";
export type ImageModel = "pro" | "v2";
export type CommercePlatform = "taobao" | "douyin" | "amazon";
export type CommerceTemplateType =
  | "commuter_womenswear"
  | "sport_casual"
  | "mens_basic"
  | "kids"
  | "taobao_detail"
  | "douyin_detail"
  | "amazon_detail";
export type CommerceHeroStyle = "white_background" | "scene" | "selling_point_overlay";
export type CommerceDetailDepth = "concise" | "standard" | "rich";
export type CommercePackStatus = "processing" | "ready" | "failed";
export type CommerceMode =
  | "launch_pack"
  | "try_on"
  | "lookbook"
  | "flatlay"
  | "invisible_mannequin_3d";
export type GenerationLane = "generator" | CommerceMode;
export type TryOnGenderCategory = "menswear" | "womenswear" | "unisex";
export type TryOnAgeGroup =
  | "adult"
  | "teen"
  | "older_kids"
  | "middle_kids"
  | "younger_kids"
  | "toddlers";
export type LookbookAngle = "front" | "side" | "back";
export type LookbookMode = "angle_preset" | "count_input";
export type GarmentGenerationMode = "smart" | "reference";
export type LaunchPackGenderPreset = "menswear" | "womenswear" | "unisex";
export type LaunchPackAgePreset = "adult" | "teen" | "kids";
export type LaunchPackPhotoStyle = "minimal_white" | "lifestyle_light" | "premium_texture" | "promo_impact";
export type AmazonMarketplace = "amazon_us";

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
  lane?: GenerationLane;
}

export interface GenerationJobRow {
  id: string;
  user_id: string;
  prompt: string;
  aspect_ratio: string;
  image_size: string;
  model: ImageModel;
  lane: GenerationLane;
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
  lane: GenerationLane;
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
  lane: GenerationLane;
}

export interface CommerceBaseSettings {
  imageSize: string;
  aspectRatio: string;
  model: ImageModel;
  imageTaskCount: number;
}

export interface LaunchPackInput extends CommerceBaseSettings {
  mode: "launch_pack";
  productName: string;
  gender: LaunchPackGenderPreset;
  agePreset: LaunchPackAgePreset;
  photographyStyle: LaunchPackPhotoStyle;
  descriptionPrompt?: string;
  referenceImages: string[];
  platform: CommercePlatform;
  amazonMarketplace: AmazonMarketplace;
  templateType: CommerceTemplateType;
  heroStyle: CommerceHeroStyle;
  detailDepth: CommerceDetailDepth;
  requestedCount: number;
  titleCount: number;
}

export interface TryOnInput extends CommerceBaseSettings {
  mode: "try_on";
  productImages: string[];
  descriptionPrompt?: string;
  genderCategory: TryOnGenderCategory;
  ageGroup: TryOnAgeGroup;
  sceneReferenceImages: string[];
  modelReferenceImages: string[];
  referenceImages?: string[];
  builtinScenePresetId?: string | null;
  builtinModelPresetId?: string | null;
  useModelReference: boolean;
  modelEthnicity?: string;
  modelStyle?: string;
  keepBackground: boolean;
  useSceneAsTextReference?: boolean;
}

export interface LookbookInput extends CommerceBaseSettings {
  mode: "lookbook";
  lookbookMode: LookbookMode;
  baseModelImage: string | null;
  backReferenceImage?: string | null;
  referenceImages?: string[];
  selectedAngles: LookbookAngle[];
  requestedCount: number;
  descriptionPrompt?: string;
}

export interface FlatlayInput extends CommerceBaseSettings {
  mode: "flatlay";
  frontImage?: string | null;
  backImage?: string | null;
  generationMode: GarmentGenerationMode;
  referenceImages: string[];
  garmentMainCategory: string;
  garmentSubCategory?: string;
  customGarmentType?: string;
  descriptionPrompt?: string;
}

export interface InvisibleMannequinInput extends CommerceBaseSettings {
  mode: "invisible_mannequin_3d";
  frontImage?: string | null;
  backImage?: string | null;
  generationMode: GarmentGenerationMode;
  referenceImages: string[];
  garmentMainCategory: string;
  garmentSubCategory?: string;
  customGarmentType?: string;
  descriptionPrompt?: string;
}

export type CommerceModuleInput =
  | LaunchPackInput
  | TryOnInput
  | LookbookInput
  | FlatlayInput
  | InvisibleMannequinInput;

export interface CommerceGenerateRequest {
  mode: CommerceMode;
  input: CommerceModuleInput;
  editMode?: boolean;
}

// Backward alias for old service signatures.
export type CommerceInput = LaunchPackInput;

export interface CopyBlock {
  id: string;
  title: string;
  content: string;
}

export interface QualityWarning {
  code: string;
  message: string;
  severity: "info" | "warning";
}

export interface ImageTaskSpec {
  id: string;
  title: string;
  prompt: string;
  aspectRatio: string;
  imageSize: string;
  model: ImageModel;
  status?: JobStatus;
  imageUrl?: string | null;
  error?: string | null;
  jobId?: string | null;
  referenceImages?: string[];
}

export interface CommercePack {
  id: string;
  userId: string;
  platform: CommercePlatform;
  mode: CommerceMode;
  templateType: CommerceTemplateType;
  status: CommercePackStatus;
  input: CommerceModuleInput;
  copyBlocks: CopyBlock[];
  titleCandidates: string[];
  keywords: string[];
  qualityWarnings: QualityWarning[];
  imageTasks: ImageTaskSpec[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CommercePackRow {
  id: string;
  user_id: string;
  platform: CommercePlatform;
  mode: CommerceMode;
  template_type: CommerceTemplateType;
  status: CommercePackStatus;
  input: CommerceModuleInput;
  copy_blocks: CopyBlock[];
  title_candidates: string[];
  keywords: string[];
  quality_warnings: QualityWarning[];
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface CommercePackItemRow {
  id: number;
  pack_id: string;
  item_type: "image_task";
  title: string;
  prompt: string;
  aspect_ratio: string;
  image_size: string;
  model: ImageModel;
  job_id: string | null;
  created_at: string;
}
