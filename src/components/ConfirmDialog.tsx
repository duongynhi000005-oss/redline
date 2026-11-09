import { useEffect, useRef, useState } from "react";
import { errorMessage } from "../lib/types";
import { useDialogFocus } from "./useDialogFocus";

/** Asks before something that can't be undone. Shows Redmine's refusal in place, and closes only once it's done. */
export function ConfirmDialog({
  title,
  text,
  action,
  busyLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  text: string;
  action: string;
  busyLabel: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLFormElement>(null);
  useDialogFocus(ref);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (e) {
      setBusy(false);
      setError(errorMessage(e));
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        ref={ref}
        className="modal confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-text"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h1 id="confirm-dialog-title">{title}</h1>
        <p id="confirm-dialog-text" className="muted">
          {text}
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <footer className="confirm-dialog-footer">
          <button type="button" className="button-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button-danger" disabled={busy} autoFocus>
            {busy ? busyLabel : action}
          </button>
        </footer>
      </form>
    </div>
  );
}
