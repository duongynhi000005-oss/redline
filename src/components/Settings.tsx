import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { knownLabelValues } from "../lib/edit";
import type { StatusCategory } from "../lib/model";
import { CATEGORY_LABEL, CATEGORY_ORDER, defaultCategory } from "../lib/model";
import { useApp } from "../state/app";
import { useDerived } from "../state/derived";
import { StatusIcon } from "./icons";
import { useDialogFocus } from "./useDialogFocus";
import { ConnectionFields } from "./ConnectionFields";
import type { ConnectionOptions } from "../lib/connection";
import { connectionProblem, normalizeConnection, sameConnection } from "../lib/connection";
import { errorMessage } from "../lib/types";

export function Settings() {
  const open = useApp((s) => s.settingsOpen);
  const setOpen = useApp((s) => s.setSettingsOpen);
  // Stable, so the dialog's Escape listener isn't swapped out mid-keypress.
  const close = useCallback(() => setOpen(false), [setOpen]);
  if (!open) return null;
  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <SettingsPanel onClose={close} />
    </div>
  );
}

function SettingsPanel({ onClose }: { onClose: () => void }) {
  const meta = useApp((s) => s.meta);
  const account = useApp((s) => s.account);
  const issues = useApp((s) => s.issues);
  const settings = useApp((s) => s.settings);
  const updateSettings = useApp((s) => s.updateSettings);
  const signOut = useApp((s) => s.signOut);
  const d = useDerived();
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref);

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

  // Every issue custom field any project uses, and whether it allows several values.
  const fields = useMemo(() => {
    const known = knownLabelValues(issues.values());
    const multiple = new Map<number, boolean>();
    for (const issue of issues.values()) for (const f of issue.custom_fields) multiple.set(f.id, !!f.multiple);
    const byId = new Map<number, string>();
    for (const p of meta?.projects ?? []) for (const f of p.issue_custom_fields) byId.set(f.id, f.name);
    return [...byId]
      .map(([id, name]) => ({ id, name, multiple: multiple.get(id) ?? false, examples: known.get(id)?.values.slice(0, 4) ?? [] }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [issues, meta]);

  if (!meta) return null;

  const setCategory = (statusId: number, category: StatusCategory) => {
    const status = meta.statuses.find((s) => s.id === statusId)!;
    const next = { ...settings.statusCategories };
    if (category === defaultCategory(status, meta.trackers)) delete next[statusId];
    else next[statusId] = category;
    updateSettings({ statusCategories: next });
  };

  const labelIds = d.labelFields ?? new Set(fields.filter((f) => f.multiple).map((f) => f.id));
  const toggleLabel = (id: number) => {
    const next = new Set(labelIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    updateSettings({ labelFields: [...next].sort((a, b) => a - b) });
  };

  return (
    <div ref={ref} tabIndex={-1} className="modal settings" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header className="settings-header">
        <h1 id="settings-title">Settings</h1>
        <span className="muted">{account ? new URL(account.serverUrl).host : ""}</span>
        <button type="button" className="icon-button settings-close" onClick={onClose} aria-label="Close settings">
          ✕
        </button>
      </header>
      <div className="settings-body">
        <section aria-labelledby="settings-statuses">
          <h2 id="settings-statuses">Statuses</h2>
          <p className="muted">
            Redmine statuses are grouped the way Linear groups work. Change a status's group if it reads wrong for your
            team.
          </p>
          <table className="settings-table">
            <tbody>
              {meta.statuses.map((s) => {
                const category = d.categories.get(s.id) ?? "started";
                return (
                  <tr key={s.id}>
                    <td>
                      <StatusIcon category={category} /> {s.name}
                      {s.is_closed && <span className="chip chip-plain">Closed in Redmine</span>}
                    </td>
                    <td>
                      <select
                        aria-label={`Group for ${s.name}`}
                        value={category}
                        onChange={(e) => setCategory(s.id, e.target.value as StatusCategory)}
                      >
                        {CATEGORY_ORDER.map((c) => (
                          <option key={c} value={c}>
                            {CATEGORY_LABEL[c]}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {Object.keys(settings.statusCategories).length > 0 && (
            <button type="button" className="button-secondary" onClick={() => updateSettings({ statusCategories: {} })}>
              Reset to defaults
            </button>
          )}
        </section>

        <section aria-labelledby="settings-labels">
          <h2 id="settings-labels">Labels</h2>
          <p className="muted">Pick the custom fields Redline shows as labels on issues.</p>
          {fields.length === 0 ? (
            <p className="muted">This server's projects have no issue custom fields.</p>
          ) : (
            <ul className="settings-fields">
              {fields.map((f) => (
                <li key={f.id}>
                  <label>
                    <input type="checkbox" checked={labelIds.has(f.id)} onChange={() => toggleLabel(f.id)} />
                    <span>{f.name}</span>
                    <span className="muted">
                      {f.multiple ? "Several values" : "One value"}
                      {f.examples.length > 0 && `: ${f.examples.join(", ")}`}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </section>

        <ServerHeaders />

        <section aria-labelledby="settings-account">
          <h2 id="settings-account">Account</h2>
          <p>
            Signed in as <strong>{account?.name}</strong> ({account?.login}) on {account?.serverUrl}
          </p>
          <button type="button" className="button-secondary" onClick={() => void signOut()}>
            Sign out
          </button>
        </section>
      </div>
    </div>
  );
}

/**
 * The username and custom headers a proxy in front of the server needs.
 * Saving checks them against the server first, then syncs with them.
 */
function ServerHeaders() {
  const backend = useApp((s) => s.backend);
  const [saved, setSaved] = useState<ConnectionOptions | null>(null);
  const [draft, setDraft] = useState<ConnectionOptions | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "error" | "saved"; message: string } | null>(null);

  useEffect(() => {
    let live = true;
    backend
      ?.getConnection()
      .then((c) => {
        if (!live) return;
        setSaved(c);
        setDraft(c);
      })
      .catch((e) => live && setStatus({ kind: "error", message: errorMessage(e) }));
    return () => {
      live = false;
    };
  }, [backend]);

  const changed = !!saved && !!draft && !sameConnection(saved, draft);

  async function save() {
    if (!backend || !draft) return;
    const problem = connectionProblem(draft);
    if (problem) {
      setStatus({ kind: "error", message: problem });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const next = await backend.updateConnection(normalizeConnection(draft));
      setSaved(next);
      setDraft(next);
      setStatus({ kind: "saved", message: "Saved. Redline checked them with the server." });
    } catch (e) {
      setStatus({ kind: "error", message: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="settings-connection">
      <h2 id="settings-connection">Connection</h2>
      <p className="muted">
        Only for a server behind a proxy or gateway that needs more than your API key, or one that limits how fast
        apps may ask it for data.
      </p>
      {draft && (
        <form
          className="settings-connection"
          // Redline explains what's wrong itself, in words, instead of the
          // web view's bubbles.
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <ConnectionFields
            value={draft}
            onChange={(next) => {
              setDraft(next);
              setStatus(null);
            }}
            disabled={busy}
          />
          <div className="settings-connection-actions">
            <button type="submit" className="button-secondary" disabled={!changed || busy}>
              {busy ? "Checking…" : "Save"}
            </button>
            {changed && !busy && (
              <button type="button" className="link-button" onClick={() => setDraft(saved)}>
                Discard changes
              </button>
            )}
          </div>
        </form>
      )}
      {status && (
        <p className={status.kind === "error" ? "settings-error" : "muted"} role={status.kind === "error" ? "alert" : "status"}>
          {status.message}
        </p>
      )}
    </section>
  );
}
