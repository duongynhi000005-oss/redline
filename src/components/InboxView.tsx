import { relativeTime } from "../lib/model";
import { useApp } from "../state/app";
import { Avatar } from "./Avatar";

export function InboxView() {
  const inbox = useApp((s) => s.inbox);
  const openIssue = useApp((s) => s.openIssue);
  const markInboxRead = useApp((s) => s.markInboxRead);
  const unread = inbox.items.filter((i) => !i.read).length;

  return (
    <section className="main" aria-label="Inbox">
      <header className="main-header" data-tauri-drag-region>
        <h1>Inbox</h1>
        <span className="count">{unread || ""}</span>
        {unread > 0 && (
          <button type="button" className="button-secondary header-action" onClick={() => markInboxRead("all")}>
            Mark all as read
          </button>
        )}
      </header>
      {inbox.items.length === 0 ? (
        <div className="empty-state">
          <p>You're all caught up.</p>
          <p className="muted">When someone changes or comments on an issue assigned to you or opened by you, it shows up here.</p>
        </div>
      ) : (
        <ul className="inbox-list" aria-label="Notifications">
          {inbox.items.map((item) => (
            <li key={item.key}>
              <button
                type="button"
                className={`inbox-row${item.read ? "" : " unread"}`}
                onClick={() => {
                  markInboxRead([item.key]);
                  openIssue(item.issueId);
                }}
              >
                <Avatar name={item.actor} size={24} />
                <span className="inbox-text">
                  <span className="inbox-title">
                    <span className="issue-id">#{item.issueId}</span> {item.subject}
                  </span>
                  <span className="inbox-summary">
                    <strong>{item.actor}</strong> {item.summary}
                    {item.comment && <span className="inbox-comment">: {item.comment}</span>}
                  </span>
                </span>
                <time dateTime={item.at}>{relativeTime(item.at)}</time>
                {!item.read && <span className="unread-dot" aria-label="Unread" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
