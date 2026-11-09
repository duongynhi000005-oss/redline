import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { User } from "../lib/types";
import { useApp } from "../state/app";
import { Avatar } from "./Avatar";
import { Icon } from "./icons";

/** Someone's name or avatar that opens their card. */
export function PersonButton({
  userId,
  name,
  className,
  children,
}: {
  userId: number;
  name: string;
  className?: string;
  children: React.ReactNode;
}) {
  const openPersonCard = useApp((s) => s.openPersonCard);
  return (
    <button
      type="button"
      className={className ? `person-button ${className}` : "person-button"}
      aria-haspopup="dialog"
      aria-label={`About ${name}`}
      onClick={(e) => openPersonCard(userId, name, e.currentTarget)}
    >
      {children}
    </button>
  );
}

/** An avatar that opens the person's card, when Redline knows who it is. */
export function PersonAvatar({ person, size }: { person: { id: number; name: string } | null | undefined; size?: number }) {
  if (!person) return <Avatar name={null} size={size} />;
  return (
    <PersonButton userId={person.id} name={person.name} className="person-avatar">
      <Avatar name={person.name} size={size} />
    </PersonButton>
  );
}

function monthYear(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

type Loaded = { userId: number; user: User | null; error: string | null };

/**
 * Who someone is: what Redmine shows of them to this user, the teams they
 * share and their roles there, and how many open issues they have.
 */
export function PersonCard() {
  const card = useApp((s) => s.personCard);
  const close = useApp((s) => s.closePersonCard);
  if (!card) return null;
  return <PersonCardPanel key={card.userId} userId={card.userId} name={card.name} top={card.top} left={card.left} onClose={close} />;
}

function PersonCardPanel({
  userId,
  name,
  top,
  left,
  onClose,
}: {
  userId: number;
  name: string;
  top: number;
  left: number;
  onClose: () => void;
}) {
  const backend = useApp((s) => s.backend);
  const meta = useApp((s) => s.meta);
  const issues = useApp((s) => s.issues);
  const openInRedmine = useApp((s) => s.openInRedmine);
  const ref = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [place, setPlace] = useState({ top, left });

  useEffect(() => {
    let live = true;
    backend
      ?.getUser(userId)
      .then((user) => live && setLoaded({ userId, user, error: null }))
      .catch(
        (e: { message?: string }) =>
          live && setLoaded({ userId, user: null, error: e.message ?? "Redmine didn't say who this is." }),
      );
    return () => {
      live = false;
    };
  }, [backend, userId]);

  // Keeps the card inside the window.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const maxLeft = Math.max(8, window.innerWidth - r.width - 8);
    const maxTop = Math.max(8, window.innerHeight - r.height - 8);
    setPlace({ top: Math.min(top, maxTop), left: Math.min(left, maxLeft) });
  }, [top, left, loaded]);

  useEffect(() => {
    ref.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    }
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) onClose();
    }
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  const user = loaded?.user;
  const full = user ? [user.firstname, user.lastname].filter(Boolean).join(" ") || user.login || name : name;
  const teams = (meta?.memberships ?? [])
    .filter((m) => m.user?.id === userId)
    .map((m) => ({ id: m.project.id, team: m.project.name, roles: m.roles.map((r) => r.name).join(", ") }))
    .sort((a, b) => a.team.localeCompare(b.team));
  const closed = new Set((meta?.statuses ?? []).filter((s) => s.is_closed).map((s) => s.id));
  let open = 0;
  for (const i of issues.values()) if (i.assigned_to?.id === userId && !closed.has(i.status.id)) open++;
  const isMe = meta?.user?.id === userId;

  return (
    <div
      ref={ref}
      className="person-card"
      role="dialog"
      aria-label={full}
      tabIndex={-1}
      style={{ top: place.top, left: place.left }}
    >
      <header className="person-card-header">
        <Avatar name={full} size={40} />
        <div className="person-card-names">
          <strong>
            {full}
            {isMe && <span className="muted"> (you)</span>}
          </strong>
          {user?.login && <span className="muted">@{user.login}</span>}
        </div>
      </header>
      {loaded === null ? (
        <p className="muted person-card-line">Asking Redmine…</p>
      ) : loaded.error ? (
        <p className="muted person-card-line">{loaded.error}</p>
      ) : (
        <dl className="person-card-facts">
          {user?.mail && (
            <>
              <dt>Email</dt>
              <dd className="person-card-mail">{user.mail}</dd>
            </>
          )}
          {user?.created_on && (
            <>
              <dt>Joined</dt>
              <dd>{monthYear(user.created_on)}</dd>
            </>
          )}
          {user?.last_login_on && (
            <>
              <dt>Last seen</dt>
              <dd>{monthYear(user.last_login_on)}</dd>
            </>
          )}
        </dl>
      )}
      {teams.length > 0 && (
        <ul className="person-card-teams" aria-label="Teams">
          {teams.map((t) => (
            <li key={t.id}>
              <span>{t.team}</span>
              <span className="muted">{t.roles}</span>
            </li>
          ))}
        </ul>
      )}
      <footer className="person-card-footer">
        <span className="muted">
          {open} open {open === 1 ? "issue" : "issues"} assigned
        </span>
        <button
          type="button"
          className="icon-button"
          onClick={() => openInRedmine(`users/${userId}`)}
          aria-label="Open in Redmine"
          title="Open in Redmine"
        >
          <Icon name="external" />
        </button>
      </footer>
    </div>
  );
}
