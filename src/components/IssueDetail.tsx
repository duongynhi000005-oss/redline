import { useEffect, useMemo, useState } from "react";
import { describeDetail } from "../lib/journal";
import { CATEGORY_LABEL, PRIORITY_LABEL, issueCategory, issueLabels, hueFor, relativeTime } from "../lib/model";
import { isTyping, matchesShortcut, shortcutLabel } from "../lib/platform";
import { blockingIssues, mentionsIn, relatedGroups, subIssues } from "../lib/relations";
import type { Attachment, Issue, IssueDetails, Journal, Relation } from "../lib/types";
import { errorMessage } from "../lib/types";
import { allowed, canEditComment, timeAccess } from "../lib/permissions";
import { fieldEnabled, fieldShape, fieldValues, knownLabelValues, moveTargets } from "../lib/edit";
import { formatHours } from "../lib/time";
import { overlayOpen, useApp } from "../state/app";
import { useDerived } from "../state/derived";
import { Attachments } from "./Attachments";
import { Avatar } from "./Avatar";
import { Icon, PriorityIcon, StatusIcon } from "./icons";
import { IssueMenu } from "./IssueActions";
import { IssueTime } from "./IssueTime";
import { Markdown } from "./Markdown";
import { DateProperty, HoursProperty, Property } from "./Properties";

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
        <h3>Subscribers{watchers && watchers.length > 0 && <span className="count">{watchers.length}</span>}</h3>
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

/** A comment, with Edit and Delete for whoever may change it. */
function Comment({
  issue,
  journal,
  attachments,
  onChanged,
}: {
  issue: Issue;
  journal: Journal;
  attachments?: Attachment[] | null;
  onChanged: (details: IssueDetails) => void;
}) {
  const meta = useApp((s) => s.meta);
  const me = useApp((s) => s.account?.userId);
  const updateComment = useApp((s) => s.updateComment);
  const [draft, setDraft] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const who = journal.user?.name ?? "Someone";
  const editable = canEditComment(meta, issue.project.id, journal.user?.id, me);
  const edited = !!journal.updated_on && journal.updated_on !== journal.created_on;

  async function save(notes: string) {
    setBusy(true);
    const done = await updateComment(issue.id, journal.id, notes);
    setBusy(false);
    if (done) {
      setDraft(null);
      setConfirming(false);
      onChanged(done);
    }
  }

  return (
    <article className="comment" aria-label={`Comment by ${who}`}>
      <header>
        <Avatar name={who} size={20} />
        <strong>{who}</strong>
        <time dateTime={journal.created_on} title={longDate(journal.created_on)}>
          {relativeTime(journal.created_on)}
        </time>
        {edited && (
          <span className="muted comment-edited" title={`Edited ${longDate(journal.updated_on!)}`}>
            edited
          </span>
        )}
        {journal.private_notes && <span className="chip chip-plain">Private</span>}
        {editable && draft === null && (
          <span className="comment-actions">
            {confirming ? (
              <>
                <span className="muted">Delete this comment?</span>
                <button type="button" className="link-button" onClick={() => setConfirming(false)}>
                  Keep
                </button>
                <button type="button" className="link-button is-danger" disabled={busy} onClick={() => void save("")}>
                  Delete
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Edit comment"
                  title="Edit comment"
                  onClick={() => setDraft(journal.notes ?? "")}
                >
                  <Icon name="edit" size={12} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Delete comment"
                  title="Delete comment"
                  onClick={() => setConfirming(true)}
                >
                  <Icon name="trash" size={12} />
                </button>
              </>
            )}
          </span>
        )}
      </header>
      {draft === null ? (
        <Markdown text={journal.notes ?? ""} attachments={attachments} />
      ) : (
        <form
          className="comment-edit"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) void save(draft);
          }}
        >
          <textarea
            aria-label="Edit comment"
            autoFocus
            onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (matchesShortcut(e, "mod+enter")) {
                e.preventDefault();
                if (draft.trim()) void save(draft);
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setDraft(null);
              }
            }}
          />
          <div className="comment-edit-actions">
            <button type="button" className="button-secondary" onClick={() => setDraft(null)}>
              Cancel
            </button>
            <button type="submit" className="button-primary" disabled={busy || !draft.trim() || draft === journal.notes}>
              {busy ? "Saving…" : "Save"} <kbd className="kbd-on-accent">{shortcutLabel("mod+enter")}</kbd>
            </button>
          </div>
        </form>
      )}
    </article>
  );
}

function Activity({
  issue,
  journals,
  attachments,
  onChanged,
}: {
  issue: Issue;
  journals: Journal[];
  attachments?: Attachment[] | null;
  onChanged: (details: IssueDetails) => void;
}) {
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
            {j.notes && <Comment issue={issue} journal={j} attachments={attachments} onChanged={onChanged} />}
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
        <button
          type="button"
          className="icon-button linked-issue-remove"
          onClick={onRemove}
          aria-label={`Remove relation to #${id}`}
          title="Remove relation"
        >
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
          <button
            type="button"
            className="icon-button"
            onClick={() => openPicker("relation", issue.id, "sub-issue")}
            aria-label="Add sub-issue"
            title="Add sub-issue"
          >
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
          <button
            type="button"
            className="icon-button"
            onClick={() => openPicker("relation", issue.id)}
            aria-label="Add relation"
            title="Add relation"
          >
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

function fileName(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}

function CommentBox({
  issueId,
  files,
  onFilesChange,
  dropping,
}: {
  issueId: number;
  files: string[];
  onFilesChange: (files: string[]) => void;
  dropping: boolean;
}) {
  const updateIssue = useApp((s) => s.updateIssue);
  const attachFiles = useApp((s) => s.attachFiles);
  const backend = useApp((s) => s.backend);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = (text.trim() || files.length > 0) && !busy;

  async function submit() {
    if (!ready) return;
    setBusy(true);
    const done = files.length ? await attachFiles(issueId, files, text) : await updateIssue(issueId, { notes: text });
    setBusy(false);
    // On failure the toast explains, and the text stays to try again.
    if (done) {
      setText("");
      onFilesChange([]);
    }
  }

  async function pick() {
    const picked = await backend?.pickFiles().catch(() => []);
    if (picked?.length) onFilesChange([...files, ...picked.filter((p) => !files.includes(p))]);
  }

  return (
    <form
      className={dropping ? "comment-box is-dropping" : "comment-box"}
      data-drop="comment"
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
      {files.length > 0 && (
        <ul className="comment-files" aria-label="Files to attach">
          {files.map((f) => (
            <li key={f} className="chip">
              <Icon name="attachment" size={12} />
              {fileName(f)}
              <button
                type="button"
                className="chip-remove"
                onClick={() => onFilesChange(files.filter((x) => x !== f))}
                aria-label={`Don't attach ${fileName(f)}`}
              >
                <Icon name="close" size={10} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="comment-box-actions">
        <button
          type="button"
          className="icon-button"
          onClick={() => void pick()}
          aria-label="Attach files to the comment"
          title="Attach files"
        >
          <Icon name="attachment" />
        </button>
        <span className="muted">Markdown, #123 and @login work. Drop files to attach.</span>
        <button type="submit" className="button-secondary" disabled={!ready}>
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
  const updateIssue = useApp((s) => s.updateIssue);
  const watchingNow = useApp((s) => s.watching.get(id));
  const me = useApp((s) => s.account?.userId);
  const toggleSubscribe = useApp((s) => s.toggleSubscribe);
  const openInRedmine = useApp((s) => s.openInRedmine);
  const attachFiles = useApp((s) => s.attachFiles);
  const openTimeDialog = useApp((s) => s.openTimeDialog);
  const meta = useApp((s) => s.meta);
  const [commentFiles, setCommentFiles] = useState<{ id: number; files: string[] }>({ id, files: [] });
  const [dropTarget, setDropTarget] = useState<"issue" | "comment" | null>(null);
  const d = useDerived();
  // Values seen per custom field, to tell date fields from the rest.
  const knownValues = useMemo(() => knownLabelValues(allIssues.values()), [allIssues]);
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

  // Files dropped on the comment box go with the comment; anywhere else on
  // the issue, they're attached at once.
  useEffect(() => {
    if (!backend) return;
    const targetAt = (x: number, y: number) =>
      document.elementFromPoint(x, y)?.closest("[data-drop]")?.getAttribute("data-drop") === "comment" ? "comment" : "issue";
    let unlisten: (() => void) | null = null;
    let live = true;
    void backend
      .onFileDrop((event) => {
        if (event.type === "leave") setDropTarget(null);
        else if (event.type === "over") setDropTarget(targetAt(event.x, event.y));
        else {
          setDropTarget(null);
          if (!event.paths.length) return;
          if (targetAt(event.x, event.y) === "comment") {
            setCommentFiles((c) => {
              const files = c.id === id ? c.files : [];
              return { id, files: [...files, ...event.paths.filter((p) => !files.includes(p))] };
            });
          } else void attachFiles(id, event.paths);
        }
      })
      .then((u) => (live ? (unlisten = u) : u()));
    return () => {
      live = false;
      unlisten?.();
    };
  }, [backend, id, attachFiles]);

  async function pickAndAttach() {
    const picked = await backend?.pickFiles().catch(() => []);
    if (picked?.length) await attachFiles(id, picked);
  }

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
  const time = timeAccess(meta, issue.project.id);
  const spent = issue.total_spent_hours ?? issue.spent_hours;
  const on = (field: string) => !meta || fieldEnabled(meta, issue.tracker.id, field);
  const categories = meta?.projects.find((p) => p.id === issue.project.id)?.issue_categories ?? [];
  const trackerCount = meta?.projects.find((p) => p.id === issue.project.id)?.trackers.length ?? 0;
  const canMove = !!meta && moveTargets(meta).some((p) => p.id !== issue.project.id);
  const canSetPrivate =
    allowed(meta, issue.project.id, "set_issues_private") === true ||
    (issue.author?.id === me && allowed(meta, issue.project.id, "set_own_issues_private") === true);
  // Fields not shown as labels get a row of their own, empty ones too so
  // they can be filled in.
  const otherFields = issue.custom_fields.filter((f) => (d.labelFields ? !d.labelFields.has(f.id) : !f.multiple));

  return (
    <section className="main detail" aria-label={`Issue ${issue.id}`}>
      {dropTarget === "issue" && (
        <div className="drop-overlay" aria-hidden="true">
          <Icon name="attachment" size={20} />
          Drop to attach to #{issue.id}
        </div>
      )}
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
          className="icon-button"
          onClick={() => void pickAndAttach()}
          aria-label="Attach files"
          title="Attach files"
        >
          <Icon name="attachment" />
        </button>
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
        <IssueMenu issue={issue} />
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
            <Markdown text={issue.description} attachments={issue.attachments} />
          ) : (
            <p className="muted">No description.</p>
          )}
          <Attachments issue={issue} onAttach={() => void pickAndAttach()} />
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
            <Activity
              issue={issue}
              journals={details.journals}
              attachments={issue.attachments}
              onChanged={(fresh) => setLoaded({ id: issue.id, details: fresh })}
            />
          ) : (
            <p className="muted">{error ? `Couldn't load the activity: ${error}` : "Loading activity…"}</p>
          )}
          <CommentBox
            key={issue.id}
            issueId={issue.id}
            files={commentFiles.id === issue.id ? commentFiles.files : []}
            onFilesChange={(files) => setCommentFiles({ id: issue.id, files })}
            dropping={dropTarget === "comment"}
          />
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
            {on("fixed_version_id") && (
              <Property label="Cycle" shortcut="shift+c" onEdit={() => openPicker("cycle", issue.id)}>
                <Icon name="cycle" />
                <span>{issue.fixed_version?.name ?? "None"}</span>
              </Property>
            )}
            {on("category_id") && (categories.length > 0 || issue.category) && (
              <Property label="Category" onEdit={categories.length ? () => openPicker("category", issue.id) : undefined}>
                <Icon name="category" />
                <span className={issue.category ? undefined : "muted"}>{issue.category?.name ?? "None"}</span>
              </Property>
            )}
            <Property label="Project" onEdit={canMove ? () => openPicker("project", issue.id) : undefined}>
              <Icon name="project" />
              <span>{issue.project.name}</span>
            </Property>
            <Property label="Tracker" onEdit={trackerCount > 1 ? () => openPicker("tracker", issue.id) : undefined}>
              <Icon name="tracker" />
              <span>{issue.tracker.name}</span>
            </Property>
            {on("parent_issue_id") && (
              <Property label="Parent" onEdit={() => openPicker("relation", issue.id, "parent")}>
                <Icon name="sub-issue" />
                {issue.parent ? (
                  <span className="property-parent">
                    #{issue.parent.id}
                    {parentIssue ? ` ${parentIssue.subject}` : ""}
                  </span>
                ) : (
                  <span className="muted">None</span>
                )}
              </Property>
            )}
            {on("start_date") && (
              <DateProperty
                label="Start"
                value={issue.start_date}
                max={issue.due_date}
                onChange={(start_date) => void updateIssue(issue.id, { start_date })}
              />
            )}
            {on("due_date") && (
              <DateProperty
                label="Due"
                value={issue.due_date}
                min={issue.start_date}
                onChange={(due_date) => void updateIssue(issue.id, { due_date })}
              />
            )}
            {on("estimated_hours") && (
              <HoursProperty
                label="Estimate"
                value={issue.estimated_hours}
                onChange={(estimated_hours) => void updateIssue(issue.id, { estimated_hours })}
              />
            )}
            {time.view && (
              <Property label="Spent" shortcut="mod+shift+t" onEdit={time.log ? () => openTimeDialog(issue.id) : undefined}>
                <Icon name="time" />
                <span>{spent ? formatHours(spent) : "None"}</span>
              </Property>
            )}
            {on("done_ratio") && (
              <Property label="Done" onEdit={() => openPicker("done", issue.id)}>
                <span className="done-meter" aria-hidden="true">
                  <span style={{ width: `${issue.done_ratio ?? 0}%` }} />
                </span>
                <span>{issue.done_ratio ?? 0}%</span>
              </Property>
            )}
            {(canSetPrivate || issue.is_private) && (
              <Property
                label="Private"
                onEdit={canSetPrivate ? () => void updateIssue(issue.id, { is_private: !issue.is_private }) : undefined}
              >
                <Icon name="lock" />
                <span className={issue.is_private ? undefined : "muted"}>{issue.is_private ? "Private" : "No"}</span>
              </Property>
            )}
            {otherFields.map((f) => {
              const values = fieldValues(f.value);
              const seen = [...(knownValues.get(f.id)?.values ?? []), ...values];
              if (!f.multiple && fieldShape(seen) === "date") {
                return (
                  <DateProperty
                    key={f.id}
                    label={f.name}
                    value={values[0] ?? null}
                    onChange={(day) => void updateIssue(issue.id, { custom_fields: [{ id: f.id, value: day ?? "" }] })}
                  />
                );
              }
              return (
                <Property key={f.id} label={f.name} onEdit={() => openPicker("field", issue.id, undefined, f.id)}>
                  <span className={values.length ? undefined : "muted"}>{values.length ? values.join(", ") : "None"}</span>
                </Property>
              );
            })}
          </dl>
          <Subscribers issue={issue} />
          {time.view && <IssueTime issue={issue} canLog={time.log} />}
        </aside>
      </div>
    </section>
  );
}
