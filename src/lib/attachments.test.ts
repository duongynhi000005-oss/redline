import { canPreview, extensionOf, formatSize, inlineAttachment, isImage } from "./attachments";
import type { Attachment } from "./types";

const file = (id: number, filename: string, extra: Partial<Attachment> = {}): Attachment => ({
  id,
  filename,
  filesize: 100,
  ...extra,
});

describe("attachments", () => {
  it("formats sizes the way Finder and Explorer do", () => {
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(1536)).toBe("1.5 KB");
    expect(formatSize(25 * 1024 * 1024)).toBe("25 MB");
  });

  it("knows images by type, or by name when the type is missing", () => {
    expect(isImage(file(1, "a.bin", { content_type: "image/png" }))).toBe(true);
    expect(isImage(file(1, "a.png", { content_type: "application/pdf" }))).toBe(false);
    expect(isImage(file(1, "Shot.JPG"))).toBe(true);
    expect(canPreview(file(1, "huge.png", { filesize: 50 * 1024 * 1024 }))).toBe(false);
  });

  it("shows a short extension on file tiles", () => {
    expect(extensionOf("report.pdf")).toBe("PDF");
    expect(extensionOf("Makefile")).toBe("");
    expect(extensionOf(".env")).toBe("");
  });

  it("finds the attachment an inline image names, newest first, ignoring case", () => {
    const list = [file(1, "shot.png"), file(2, "other.png"), file(3, "Shot.png")];
    expect(inlineAttachment(list, "shot.png")?.id).toBe(3);
    expect(inlineAttachment(list, "other%2Epng")?.id).toBe(2);
    expect(inlineAttachment(list, "https://example.com/shot.png")).toBeNull();
    expect(inlineAttachment(list, "/attachments/shot.png")).toBeNull();
    expect(inlineAttachment(list, "missing.png")).toBeNull();
  });
});
