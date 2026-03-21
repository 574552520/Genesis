export type UploadedImageRef = {
  ref: string;
  previewUrl: string;
  mimeType: string;
  sizeBytes: number;
};

export type ImagePreviewMap = Record<string, string>;

export const MAX_UPLOADED_IMAGE_COUNT = 6;

export function buildPreviewMapFromUploads(items: UploadedImageRef[]): ImagePreviewMap {
  return items.reduce<ImagePreviewMap>((acc, item) => {
    acc[item.ref] = item.previewUrl;
    return acc;
  }, {});
}

export function resolveImagePreviewUrl(refOrUrl: string, previewMap: ImagePreviewMap): string {
  if (!refOrUrl) return refOrUrl;
  if (/^storage:\/\//i.test(refOrUrl)) {
    return previewMap[refOrUrl] ?? refOrUrl;
  }
  return refOrUrl;
}
