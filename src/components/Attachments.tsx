import { useEffect, useState } from "react";
import { attachmentUrl, canPreview, extensionOf, formatSize } from "../lib/attachments";
import { relativeTime } from "../lib/model";
import type { Attachment, Issue } from "../lib/types";
import { useApp } from "../state/app";
import { Icon } from "./icons";

/** An attachment's image, read through the backend. */
export function AttachmentImage({ attachment, alt, className }: { attachment: Attachment; alt?: string; className?: string }) {
  const backend = useApp((s) => s.backend);
  const [loaded, setLoaded] = useState<{ id: number; url?: string; failed?: boolean } | null>(null);
  useEffect(() => {
    if (!backend) return;
    let live = true;
    attachmentUrl(backend, attachment)
      .then((url) => live && setLoaded({ id: attachment.id, url }))
      .catch(() => live && setLoaded({ id: attachment.id, failed: true }));
    return () => {
      live = false;
    };
  }, [backend, attachment]);
  const state = loaded?.id === attachment.id ? loaded : null;
  if (state?.url) return <img src={state.url} alt={alt ?? attachment.filename} className={className} draggable={false} />;
  return (
    <span className={`attachment-image-placeholder ${className ?? ""}`} role="img" aria-label={alt ?? attachment.filename}>
      {state?.failed ? <Icon name="file" /> : null}
    </span>
  );
}

/** The issue's files, as tiles: images show themselves, other files their type. */
export function Attachments({ issue, onAttach }: { issue: Issue; onAttach: () => void }) {
  const attachments = issue.attachments;
  const deleteAttachment = useApp((s) => s.deleteAttachment);
  const saveAttachment = useApp((s) => s.saveAttachment);
  const [previewing, setPreviewing] = useState<number | null>(null);
  const images = (attachments ?? []).filter(canPreview);
  const current = images.find((a) => a.id === previewing) ?? null;

  if (!attachments?.length) return null;
  return (
    <section className="attachments" aria-label="Attachments">
      <header className="connections-header">
        <h2>
          Attachments <span className="count">{attachments.length}</span>
        </h2>
        <button type="button" className="icon-button" onClick={onAttach} aria-label="Attach more files" title="Attach files">
          <Icon name="plus" />
        </button>
      </header>
      <ul className="attachment-grid">
        {attachments.map((a) => (
          <li key={a.id} className="attachment">
            <button
              type="button"
              className="attachment-open"
              onClick={() => (canPreview(a) ? setPreviewing(a.id) : void saveAttachment(a))}
              aria-label={canPreview(a) ? `Preview ${a.filename}` : `Download ${a.filename}`}
              title={a.description || a.filename}
            >
              <span className="attachment-thumb">
                {canPreview(a) ? (
                  <AttachmentImage attachment={a} alt="" />
                ) : (
                  <span className="attachment-type">
                    <Icon name="file" size={18} />
                    <span>{extensionOf(a.filename)}</span>
                  </span>
                )}
              </span>
              <span className="attachment-name">{a.filename}</span>
              <span className="attachment-meta">
                {formatSize(a.filesize)}
                {a.created_on && ` · ${relativeTime(a.created_on)}`}
              </span>
            </button>
            <span className="attachment-actions">
              <button
                type="button"
                className="icon-button small"
                onClick={() => void saveAttachment(a)}
                aria-label={`Save ${a.filename}`}
                title="Save…"
              >
                <Icon name="download" size={12} />
              </button>
              <button
                type="button"
                className="icon-button small"
                onClick={() => void deleteAttachment(issue.id, a)}
                aria-label={`Delete ${a.filename}`}
                title="Delete"
              >
                <Icon name="trash" size={12} />
              </button>
            </span>
          </li>
        ))}
      </ul>
      {current && (
        <Preview
          attachment={current}
          position={`${images.indexOf(current) + 1} of ${images.length}`}
          onMove={(step) => {
            const i = images.indexOf(current);
            setPreviewing(images[(i + step + images.length) % images.length]!.id);
          }}
          onClose={() => setPreviewing(null)}
        />
      )}
    </section>
  );
}

/** An image at full size over everything, with the others a key away. */
function Preview({
  attachment,
  position,
  onMove,
  onClose,
}: {
  attachment: Attachment;
  position: string;
  onMove: (step: number) => void;
  onClose: () => void;
}) {
  const saveAttachment = useApp((s) => s.saveAttachment);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      } else if (e.key === "ArrowRight") onMove(1);
      else if (e.key === "ArrowLeft") onMove(-1);
    }
    // Capture, so Escape closes the preview before it closes the issue.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onMove, onClose]);
  return (
    <div className="preview-backdrop" onClick={onClose}>
      <div
        className="preview"
        role="dialog"
        aria-modal="true"
        aria-label={attachment.filename}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="preview-header">
          <span className="preview-name">{attachment.filename}</span>
          <span className="muted">
            {formatSize(attachment.filesize)} · {position}
          </span>
          <span className="header-spacer" />
          <button
            type="button"
            className="icon-button"
            onClick={() => void saveAttachment(attachment)}
            aria-label="Save"
            title="Save…"
          >
            <Icon name="download" />
          </button>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close preview" title="Close (Esc)">
            <Icon name="close" />
          </button>
        </header>
        <div className="preview-body">
          <AttachmentImage attachment={attachment} />
        </div>
      </div>
    </div>
  );
}
