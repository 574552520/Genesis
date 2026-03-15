type DownloadImageOptions = {
  url: string;
  title?: string | null;
  resolvedId?: string | null;
  stableId?: string | null;
  id?: string | null;
  defaultBaseName?: string;
};

const CONTENT_TYPE_EXTENSION_MAP: Record<string, string> = {
  "image/apng": ".apng",
  "image/avif": ".avif",
  "image/gif": ".gif",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/svg+xml": ".svg",
  "image/webp": ".webp",
};

function sanitizeFileNameSegment(value: string): string {
  const normalized = value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ");
  const collapsed = normalized.replace(/\s+/g, " ").replace(/\.+$/g, "").trim();
  return collapsed || "genesis-image";
}

function inferExtension(contentType: string | null | undefined): string {
  if (!contentType) return ".png";
  const normalized = contentType.split(";")[0]?.trim().toLowerCase();
  return CONTENT_TYPE_EXTENSION_MAP[normalized] ?? ".png";
}

function hasKnownExtension(fileName: string): boolean {
  return /\.[a-z0-9]{2,5}$/i.test(fileName);
}

function buildFileName(options: DownloadImageOptions, extension: string): string {
  const baseName = sanitizeFileNameSegment(
    options.title ?? options.resolvedId ?? options.stableId ?? options.id ?? options.defaultBaseName ?? "genesis-image",
  );
  return hasKnownExtension(baseName) ? baseName : `${baseName}${extension}`;
}

export async function downloadImageFile(options: DownloadImageOptions): Promise<void> {
  const response = await fetch(options.url);
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status}`);
  }

  const blob = await response.blob();
  const extension = inferExtension(response.headers.get("content-type") || blob.type);
  const fileName = buildFileName(options, extension);
  const objectUrl = URL.createObjectURL(blob);

  try {
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = fileName;
    link.rel = "noopener";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
}
