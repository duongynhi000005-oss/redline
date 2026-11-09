import type { Backend } from "./backend";
import type { Attachment } from "./types";

// Attachments in the UI: sizes, which ones are images, and their content as
// object URLs, read once through the backend (which caches them on disk).

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml", "image/bmp", "image/avif"]);
const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
/** Larger images aren't read just to show a thumbnail. */
const MAX_PREVIEW_BYTES = 20 * 1024 * 1024;

export function isImage(a: Attachment): boolean {
  return a.content_type ? IMAGE_TYPES.has(a.content_type) : IMAGE_EXTENSIONS.test(a.filename);
}

export function canPreview(a: Attachment): boolean {
  return isImage(a) && a.filesize <= MAX_PREVIEW_BYTES;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** The extension to show on a file's tile, like PDF. */
export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 && dot < filename.length - 1 ? filename.slice(dot + 1, dot + 5).toUpperCase() : "";
}

/**
 * The attachment an image in a description or comment points at. Redmine
 * resolves `![](shot.png)` to the issue's attachment of that name, the
 * newest when several share it, ignoring case.
 */
export function inlineAttachment(attachments: Attachment[] | null | undefined, src: string | undefined): Attachment | null {
  if (!attachments?.length || !src || /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith("/")) return null;
  let name: string;
  try {
    name = decodeURIComponent(src);
  } catch {
    name = src;
  }
  const matches = attachments.filter((a) => a.filename.toLowerCase() === name.toLowerCase());
  return matches.length ? matches.reduce((a, b) => (b.id > a.id ? b : a)) : null;
}

const urls = new Map<number, Promise<string>>();

/** An object URL for an attachment's content, read once per session. */
export function attachmentUrl(backend: Backend, a: Attachment): Promise<string> {
  let url = urls.get(a.id);
  if (!url) {
    url = backend
      .attachmentData(a.id)
      .then((bytes) => URL.createObjectURL(new Blob([bytes as BlobPart], { type: a.content_type ?? undefined })));
    // A failed read can be tried again.
    url.catch(() => urls.delete(a.id));
    urls.set(a.id, url);
  }
  return url;
}
