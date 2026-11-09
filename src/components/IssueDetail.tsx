import { useEffect, useState } from "react";
import { describeDetail } from "../lib/journal";
import { CATEGORY_LABEL, PRIORITY_LABEL, issueCategory, issueLabels, hueFor, relativeTime } from "../lib/model";
import { isTyping, matchesShortcut, shortcutLabel } from "../lib/platform";
import type { IssueDetails, Journal } from "../lib/types";
import { errorMessage } from "../lib/types";
import { useApp } from "../state/app";
import { useDerived } from "../state/derived";
import { Avatar } from "./Avatar";
import { Icon, PriorityIcon, StatusIcon } from "./icons";
import { Markdown } from "./Markdown";

function Property({ label, children, onEdit, shortcut }: { label: string; children: React.ReactNode; onEdit?: () => void; shortcut?: string }) {
  return (
    <div className="property">
      <dt>{label}</dt>
      <dd>
        {onEdit ? (
          <button
            type="button"
            className="property-button"
            onClick={onEdit}
            aria-label={`${label}: change`}
            title={shortcut ? `Change ${label.toLowerCase()} (${shortcutLabel(shortcut)})` : undefined}
          >
            {children}
          </button>
        ) : (
          children
        )}
      </dd>
    </div>
  );
}

function longDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function Activity({ journals }: { journals: Journal[] }) {
  const meta = useApp((s) => s.meta)!;
  return (
    <ol className="activity">
      {journals.map((j) => {
        const who = j.user?.name ?? "Someone";
        return (
          <li key={j.id}>
            {j.details.map((detail, i) => (
              <div key={i} className="activity-change">
                <Avatar name={who} size={16} />
                <span>
                  <strong>{who}</strong> {describeDetail(detail, meta)}
                </span>
                <time dateTime={j.created_on} title={longDate(j.created_on)}>
                  {relativeTime(j.created_on)}
                </time>
              </div>
            ))}
            {j.notes && (
              <article className="comment">
                <header>
                  <Avatar name={who} size={20} />
                  <strong>{who}</strong>
                  <time dateTime={j.created_on} title={longDate(j.created_on)}>
                    {relativeTime(j.created_on)}
                  </time>
                  {j.private_notes && <span className="chip chip-plain">Private</span>}
                </header>
                <Markdown text={j.notes} />
              </article>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function CommentBox({ issueId }: { issueId: number }) {
  const updateIssue = useApp((s) => s.updateIssue);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!text.trim() || busy) return;
    setBusy(true);
    const done = await updateIssue(issueId, { notes: text });
    setBusy(false);
    // On failure the toast explains, and the text stays to try again.
    if (done) setText("");
  }

  return (
    <form
      className="comment-box"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <textarea
        aria-label="Comment"
        placeholder="Leave a comment…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (matchesShortcut(e, "mod+enter")) {
            e.preventDefault();
            void submit();
          } else if (e.key === "Escape") {
            e.currentTarget.blur();
          }
        }}
      />
      <div className="comment-box-actions">
        <span className="muted">Markdown, #123 and @login work.</span>
        <button type="submit" className="button-secondary" disabled={!text.trim() || busy}>
          {busy ? "Sending…" : "Comment"} <kbd>{shortcutLabel("mod+enter")}</kbd>
        </button>
      </div>
    </form>
  );
}

export function IssueDetail({ id }: { id: number }) {
  const backend = useApp((s) => s.backend);
  const cached = useApp((s) => s.issues.get(id));
  const openIssue = useApp((s) => s.openIssue);
  const paletteOpen = useApp((s) => s.paletteOpen);
  const picker = useApp((s) => s.picker);
  const openPicker = useApp((s) => s.openPicker);
  const d = useDerived();
  const [loaded, setLoaded] = useState<{ id: number; details?: IssueDetails; error?: string } | null>(null);
  const details = loaded?.id === id ? (loaded.details ?? null) : null;
  const error = loaded?.id === id ? (loaded.error ?? null) : null;

  // Show the cached issue at once, then load its activity from the server.
  useEffect(() => {
    let live = true;
    backend
      ?.getIssueDetails(id, true)
      .then((result) => live && setLoaded({ id, details: result }))
      .catch((e) => live && setLoaded({ id, error: errorMessage(e) }));
    return () => {
      live = false;
    };
  }, [backend, id, cached?.updated_on]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !paletteOpen && !picker && !isTyping(e.target)) openIssue(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openIssue, paletteOpen, picker]);

  // The store's copy follows edits and syncs; the details add activity.
  const issue = cached ?? details?.issue;
  if (!issue) {
    return (
      <section className="main">
        <div className="empty-state">{error ?? "Loading…"}</div>
      </section>
    );
  }

  const category = issueCategory(issue, d.categories);
  const level = d.priorities.get(issue.priority.id) ?? 0;
  const labels = issueLabels(issue, d.labelFields);
  // Fields not shown as labels get a row of their own.
  const otherFields = issue.custom_fields.filter(
    (f) => f.value && f.value.length !== 0 && (d.labelFields ? !d.labelFields.has(f.id) : !f.multiple),
  );

  return (
    <section className="main detail" aria-label={`Issue ${issue.id}`}>
      <header className="main-header" data-tauri-drag-region>
        <button type="button" className="icon-button" onClick={() => openIssue(null)} aria-label="Back to list">
          <Icon name="back" />
        </button>
        <span className="breadcrumb">
          {issue.project.name} <Icon name="chevron-right" size={12} /> #{issue.id}
        </span>
      </header>
      <div className="detail-body">
        <div className="detail-content">
          <h1 className="detail-title">{issue.subject}</h1>
          {issue.description ? (
            <Markdown text={issue.description} />
          ) : (
            <p className="muted">No description.</p>
          )}
          <h2 className="activity-title">Activity</h2>
          <div className="activity-change">
            <Avatar name={issue.author?.name} size={16} />
            <span>
              <strong>{issue.author?.name ?? "Someone"}</strong> created the issue
            </span>
            <time dateTime={issue.created_on} title={longDate(issue.created_on)}>
              {relativeTime(issue.created_on)}
            </time>
          </div>
          {details ? (
            <Activity journals={details.journals} />
          ) : (
            <p className="muted">{error ? `Couldn't load the activity: ${error}` : "Loading activity…"}</p>
          )}
          <CommentBox key={issue.id} issueId={issue.id} />
        </div>
        <aside className="detail-properties" aria-label="Properties">
          <dl>
            <Property label="Status" shortcut="s" onEdit={() => openPicker("status", issue.id)}>
              <StatusIcon category={category} />
              <span title={CATEGORY_LABEL[category]}>{issue.status.name}</span>
            </Property>
            <Property label="Priority" shortcut="p" onEdit={() => openPicker("priority", issue.id)}>
              <PriorityIcon level={level} />
              <span title={PRIORITY_LABEL[level]}>{issue.priority.name}</span>
            </Property>
            <Property label="Assignee" shortcut="a" onEdit={() => openPicker("assignee", issue.id)}>
              <Avatar name={issue.assigned_to?.name} />
              <span>{issue.assigned_to?.name ?? "Unassigned"}</span>
            </Property>
            <Property label="Labels" shortcut="l" onEdit={() => openPicker("labels", issue.id)}>
              {labels.length ? (
                <span className="chips">
                  {labels.map((l) => (
                    <span key={`${l.field}:${l.value}`} className="chip" title={l.field}>
                      <span className="chip-dot" style={{ background: `hsl(${hueFor(l.field + l.value)} 55% 55%)` }} />
                      {l.value}
                    </span>
                  ))}
                </span>
              ) : (
                <span className="muted">None</span>
              )}
            </Property>
            <Property label="Cycle" shortcut="shift+c" onEdit={() => openPicker("cycle", issue.id)}>
              <Icon name="cycle" />
              <span>{issue.fixed_version?.name ?? "None"}</span>
            </Property>
            <Property label="Project">
              <Icon name="project" />
              <span>{issue.project.name}</span>
            </Property>
            <Property label="Tracker">
              <span>{issue.tracker.name}</span>
            </Property>
            {issue.due_date && <Property label="Due">{issue.due_date}</Property>}
            {issue.estimated_hours != null && <Property label="Estimate">{issue.estimated_hours} h</Property>}
            {issue.done_ratio ? <Property label="Done">{issue.done_ratio}%</Property> : null}
            {otherFields.map((f) => (
              <Property key={f.id} label={f.name}>
                {Array.isArray(f.value) ? f.value.join(", ") : f.value}
              </Property>
            ))}
          </dl>
        </aside>
      </div>
    </section>
  );
}
