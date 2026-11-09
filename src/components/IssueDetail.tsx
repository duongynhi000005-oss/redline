import { useEffect, useState } from "react";
import { describeDetail } from "../lib/journal";
import { CATEGORY_LABEL, PRIORITY_LABEL, issueCategory, issueLabels, hueFor, relativeTime } from "../lib/model";
import { isTyping, matchesShortcut, shortcutLabel } from "../lib/platform";
import { blockingIssues, mentionsIn, relatedGroups, subIssues } from "../lib/relations";
import type { Issue, IssueDetails, Journal, Relation } from "../lib/types";
import { errorMessage } from "../lib/types";
import { allowed } from "../lib/permissions";
import { overlayOpen, useApp } from "../state/app";
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

/** Who gets Redmine's notifications for the issue, as far as the role may see and change. */
function Subscribers({ issue }: { issue: Issue }) {
  const meta = useApp((s) => s.meta);
  const me = useApp((s) => s.account?.userId);
  const openPicker = useApp((s) => s.openPicker);
  const setWatcher = useApp((s) => s.setWatcher);
  const canAdd = allowed(meta, issue.project.id, "add_issue_watchers") !== false;
  const canRemove = allowed(meta, issue.project.id, "delete_issue_watchers") !== false;
  const watchers = issue.watchers;
  return (
    <section className="subscribers" aria-label="Subscribers">
      <header className="subscribers-header">
        <h3>
          Subscribers{watchers && watchers.length > 0 && <span className="count">{watchers.length}</span>}
        </h3>
        {canAdd && (
          <button
            type="button"
            className="icon-button small"
            onClick={() => openPicker("subscribers", issue.id)}
            aria-label="Change subscribers"
            title="Change subscribers"
          >
            <Icon name="plus" size={12} />
          </button>
        )}
      </header>
      {watchers == null ? (
        <p className="muted subscribers-note">Your role can't see who else is subscribed.</p>
      ) : watchers.length === 0 ? (
        <p className="muted subscribers-note">No one yet.</p>
      ) : (
        <ul className="subscribers-list">
          {watchers.map((w) => (
            <li key={w.id}>
              <Avatar name={w.name} size={16} />
              <span className="subscriber-name">
                {w.name}
                {w.id === me && <span className="muted"> (you)</span>}
              </span>
              {canRemove && (
                <button
                  type="button"
                  className="icon-button small subscriber-remove"
                  onClick={() => void setWatcher(issue.id, w.id, false)}
                  aria-label={`Remove ${w.name}`}
                  title={`Remove ${w.name}`}
                >
                  <Icon name="close" size={10} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
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

/** One connected issue: opens it, and can be unlinked when it's a relation. */
function LinkedIssue({ id, issue, onRemove }: { id: number; issue: Issue | undefined; onRemove?: () => void }) {
  const openIssue = useApp((s) => s.openIssue);
  const d = useDerived();
  return (
    <li className="linked-issue">
      <button type="button" className="linked-issue-open" onClick={() => openIssue(id)}>
        {issue ? <StatusIcon category={issueCategory(issue, d.categories)} /> : <Icon name="issues" />}
        <span className="linked-issue-id">#{id}</span>
        <span className="linked-issue-subject">{issue?.subject ?? "Not synced to Redline"}</span>
        {issue?.assigned_to && <Avatar name={issue.assigned_to.name} size={16} />}
      </button>
      {onRemove ? (
        <button type="button" className="icon-button linked-issue-remove" onClick={onRemove} aria-label={`Remove relation to #${id}`} title="Remove relation">
          <Icon name="close" size={12} />
        </button>
      ) : (
        <span className="linked-issue-remove-space" aria-hidden="true" />
      )}
    </li>
  );
}

/** Sub-issues, Redmine relations and #mentions, each way. */
function Connections({ issue, journals }: { issue: Issue; journals: Journal[] | null }) {
  const issues = useApp((s) => s.issues);
  const backend = useApp((s) => s.backend);
  const openPicker = useApp((s) => s.openPicker);
  const removeRelation = useApp((s) => s.removeRelation);
  const [mentionedIn, setMentionedIn] = useState<{ id: number; ids: number[] } | null>(null);

  // Mentions elsewhere come from Redmine's search, which also reads comments.
  useEffect(() => {
    let live = true;
    backend
      ?.findMentions(issue.id)
      .then((ids) => live && setMentionedIn({ id: issue.id, ids }))
      .catch(() => live && setMentionedIn({ id: issue.id, ids: [] }));
    return () => {
      live = false;
    };
  }, [backend, issue.id, issue.updated_on]);

  const children = subIssues(issue, issues.values());
  const groups = relatedGroups(issue, issues);
  const shown = new Set<number>([...children.map((c) => c.id), ...groups.flatMap((g) => g.items.map((i) => i.otherId))]);
  if (issue.parent) shown.add(issue.parent.id);
  const mentions = mentionsIn(issue, journals).filter((id) => !shown.has(id));
  const incoming = (mentionedIn?.id === issue.id ? mentionedIn.ids : []).filter((id) => !shown.has(id));
  const done = children.filter((c) => c.status.is_closed).length;
  const remove = (relation: Relation) => () => void removeRelation(relation);

  return (
    <>
      <section className="connections" aria-label="Sub-issues">
        <header className="connections-header">
          <h2>Sub-issues</h2>
          {children.length > 0 && (
            <span className="muted" aria-label={`${done} of ${children.length} done`}>
              {done}/{children.length}
            </span>
          )}
          <button type="button" className="icon-button" onClick={() => openPicker("relation", issue.id, "sub-issue")} aria-label="Add sub-issue" title="Add sub-issue">
            <Icon name="plus" />
          </button>
        </header>
        {children.length > 0 && (
          <ul className="linked-issues">
            {children.map((c) => (
              <LinkedIssue key={c.id} id={c.id} issue={c} />
            ))}
          </ul>
        )}
      </section>
      <section className="connections" aria-label="Related issues">
        <header className="connections-header">
          <h2>Related</h2>
          <button type="button" className="icon-button" onClick={() => openPicker("relation", issue.id)} aria-label="Add relation" title="Add relation">
            <Icon name="plus" />
          </button>
        </header>
        {groups.map((g) => (
          <div key={g.type} className="connection-group">
            <h3>{g.label}</h3>
            <ul className="linked-issues">
              {g.items.map((item) => (
                <LinkedIssue key={item.relation.id} id={item.otherId} issue={item.other} onRemove={remove(item.relation)} />
              ))}
            </ul>
          </div>
        ))}
        {mentions.length > 0 && (
          <div className="connection-group">
            <h3>Mentions</h3>
            <ul className="linked-issues">
              {mentions.map((id) => (
                <LinkedIssue key={id} id={id} issue={issues.get(id)} />
              ))}
            </ul>
          </div>
        )}
        {incoming.length > 0 && (
          <div className="connection-group">
            <h3>Mentioned in</h3>
            <ul className="linked-issues">
              {incoming.map((id) => (
                <LinkedIssue key={id} id={id} issue={issues.get(id)} />
              ))}
            </ul>
          </div>
        )}
        {!groups.length && !mentions.length && !incoming.length && <p className="muted connections-empty">No related issues.</p>}
      </section>
    </>
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
  const allIssues = useApp((s) => s.issues);
  const relationIds = (cached?.relations ?? []).map((r) => r.id).join(",");
  const openIssue = useApp((s) => s.openIssue);
  const overlay = useApp(overlayOpen);
  const openPicker = useApp((s) => s.openPicker);
  const watchingNow = useApp((s) => s.watching.get(id));
  const me = useApp((s) => s.account?.userId);
  const toggleSubscribe = useApp((s) => s.toggleSubscribe);
  const openInRedmine = useApp((s) => s.openInRedmine);
  const d = useDerived();
  const [loaded, setLoaded] = useState<{ id: number; details?: IssueDetails; error?: string } | null>(null);
  const details = loaded?.id === id ? (loaded.details ?? null) : null;
  const error = loaded?.id === id ? (loaded.error ?? null) : null;

  // Show the cached issue at once, then load its activity from the server.
  useEffect(() => {
    let live = true;
    backend
      ?.getIssueDetails(id, true)
      .then((result) => {
        if (!live) return;
        setLoaded({ id, details: result });
        // Redmine doesn't touch updated_on for relations or watchers; take the fresh ones.
        useApp.getState().takeDetails(result);
      })
      .catch((e) => live && setLoaded({ id, error: errorMessage(e) }));
    return () => {
      live = false;
    };
    // Relation changes add a comment-less journal entry without touching updated_on.
  }, [backend, id, cached?.updated_on, relationIds]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Escape closes whatever is on top first; the issue only when nothing is.
      if (e.key === "Escape" && !overlay && !isTyping(e.target)) openIssue(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openIssue, overlay]);

  // The store's copy follows edits and syncs; the details add activity.
  const issue = cached ?? details?.issue;
  if (!issue) {
    return (
      <section className="main">
        <div className="empty-state">{error ?? "Loading…"}</div>
      </section>
    );
  }

  const subscribed = watchingNow ?? issue.watchers?.some((w) => w.id === me) ?? false;
  const parentIssue = issue.parent ? allIssues.get(issue.parent.id) : undefined;
  const blockedBy = blockingIssues(issue, allIssues);
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
        <span className="header-spacer" data-tauri-drag-region />
        <button
          type="button"
          className={subscribed ? "icon-button is-on" : "icon-button"}
          onClick={() => void toggleSubscribe(issue.id)}
          aria-pressed={subscribed}
          aria-label={subscribed ? "Unsubscribe" : "Subscribe"}
          title={`${subscribed ? "Unsubscribe" : "Subscribe"} (${shortcutLabel("shift+s")})`}
        >
          <Icon name={subscribed ? "bell-filled" : "bell"} />
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={() => openInRedmine(`issues/${issue.id}`)}
          aria-label="Open in Redmine"
          title={`Open in Redmine (${shortcutLabel("mod+shift+o")})`}
        >
          <Icon name="external" />
        </button>
      </header>
      <div className="detail-body">
        <div className="detail-content">
          {issue.parent && (
            <button type="button" className="parent-link" onClick={() => openIssue(issue.parent!.id)}>
              <Icon name="sub-issue" size={12} />
              Sub-issue of #{issue.parent.id}
              {parentIssue && <span className="parent-link-subject">{parentIssue.subject}</span>}
            </button>
          )}
          <h1 className="detail-title">{issue.subject}</h1>
          {blockedBy.length > 0 && (
            <p className="blocked-note">
              <Icon name="blocked" size={12} /> Blocked by {blockedBy.map((b) => `#${b}`).join(", ")}
            </p>
          )}
          {issue.description ? (
            <Markdown text={issue.description} />
          ) : (
            <p className="muted">No description.</p>
          )}
          <Connections issue={issue} journals={details?.journals ?? null} />
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
          <Subscribers issue={issue} />
        </aside>
      </div>
    </section>
  );
}
