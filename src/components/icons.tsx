import type { PriorityLevel, StatusCategory } from "../lib/model";

// Small 14px icons drawn for Redline. Colours come from CSS variables so they
// follow light and dark mode.

type IconProps = { size?: number; className?: string; title?: string };

function Svg({ size = 14, className, title, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      fill="none"
    >
      {children}
    </svg>
  );
}

export function StatusIcon({ category, ...props }: IconProps & { category: StatusCategory }) {
  const color = `var(--status-${category})`;
  switch (category) {
    case "triage":
      return (
        <Svg {...props}>
          <circle cx="7" cy="7" r="6" fill={color} />
          <path d="M4.5 7h5M7.8 5.3 9.5 7 7.8 8.7" stroke="var(--bg)" strokeWidth="1.3" strokeLinecap="round" />
        </Svg>
      );
    case "backlog":
      return (
        <Svg {...props}>
          <circle cx="7" cy="7" r="5.5" stroke={color} strokeWidth="1.5" strokeDasharray="1.6 1.8" />
        </Svg>
      );
    case "unstarted":
      return (
        <Svg {...props}>
          <circle cx="7" cy="7" r="5.5" stroke={color} strokeWidth="1.5" />
        </Svg>
      );
    case "started":
      return (
        <Svg {...props}>
          <circle cx="7" cy="7" r="5.5" stroke={color} strokeWidth="1.5" />
          <path d="M7 3.5a3.5 3.5 0 0 1 0 7z" fill={color} />
        </Svg>
      );
    case "completed":
      return (
        <Svg {...props}>
          <circle cx="7" cy="7" r="6.25" fill={color} />
          <path d="m4.4 7.1 1.8 1.8 3.5-3.6" stroke="var(--bg)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      );
    case "canceled":
      return (
        <Svg {...props}>
          <circle cx="7" cy="7" r="6.25" fill={color} />
          <path d="m5 5 4 4M9 5 5 9" stroke="var(--bg)" strokeWidth="1.4" strokeLinecap="round" />
        </Svg>
      );
  }
}

export function PriorityIcon({ level, ...props }: IconProps & { level: PriorityLevel }) {
  if (level === 0) {
    return (
      <Svg {...props}>
        {[2.5, 6, 9.5].map((x) => (
          <rect key={x} x={x} y="6.4" width="2" height="1.2" rx="0.6" fill="var(--text-tertiary)" />
        ))}
      </Svg>
    );
  }
  if (level === 4) {
    return (
      <Svg {...props}>
        <rect x="1" y="1" width="12" height="12" rx="3" fill="var(--priority-urgent)" />
        <path d="M7 3.8v4" stroke="var(--bg)" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="7" cy="10.1" r="0.9" fill="var(--bg)" />
      </Svg>
    );
  }
  const bars = [
    { x: 1.5, y: 8, h: 4.5 },
    { x: 5.75, y: 5, h: 7.5 },
    { x: 10, y: 1.5, h: 11 },
  ];
  const lit = level === 1 ? 1 : level === 2 ? 2 : 3;
  return (
    <Svg {...props}>
      {bars.map((b, i) => (
        <rect
          key={b.x}
          x={b.x}
          y={b.y}
          width="2.5"
          height={b.h}
          rx="1"
          fill={i < lit ? "var(--text-secondary)" : "var(--border-strong)"}
        />
      ))}
    </Svg>
  );
}

export function Icon({ name, ...props }: IconProps & { name: IconName }) {
  const stroke = { stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (name) {
    case "inbox":
      return (
        <Svg {...props}>
          <path d="M1.8 8h3l.8 1.5h2.8L9.2 8h3M2.5 3.5h9l1 4.5v3a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V8z" {...stroke} />
        </Svg>
      );
    case "my-issues":
      return (
        <Svg {...props}>
          <circle cx="7" cy="5" r="2.5" {...stroke} />
          <path d="M2.5 12c.6-2.2 2.4-3.5 4.5-3.5s3.9 1.3 4.5 3.5" {...stroke} />
        </Svg>
      );
    case "search":
      return (
        <Svg {...props}>
          <circle cx="6.2" cy="6.2" r="4" {...stroke} />
          <path d="m9.2 9.2 3 3" {...stroke} />
        </Svg>
      );
    case "issues":
      return (
        <Svg {...props}>
          <circle cx="7" cy="7" r="5" {...stroke} />
          <circle cx="7" cy="7" r="1.6" fill="currentColor" />
        </Svg>
      );
    case "project":
      return (
        <Svg {...props}>
          <path d="M2 4.5 7 2l5 2.5v5L7 12 2 9.5zM2 4.5 7 7l5-2.5M7 7v5" {...stroke} />
        </Svg>
      );
    case "chevron-right":
      return (
        <Svg {...props}>
          <path d="m5.5 3.5 3.5 3.5-3.5 3.5" {...stroke} />
        </Svg>
      );
    case "chevron-down":
      return (
        <Svg {...props}>
          <path d="m3.5 5.5 3.5 3.5 3.5-3.5" {...stroke} />
        </Svg>
      );
    case "back":
      return (
        <Svg {...props}>
          <path d="M11.5 7h-9M6 3.5 2.5 7 6 10.5" {...stroke} />
        </Svg>
      );
    case "sync":
      return (
        <Svg {...props}>
          <path d="M11.5 6A4.6 4.6 0 0 0 3 4.5M2.5 8A4.6 4.6 0 0 0 11 9.5M3 2v2.5h2.5M11 12V9.5H8.5" {...stroke} />
        </Svg>
      );
    case "offline":
      return (
        <Svg {...props}>
          <path d="M2 2l10 10M4.5 10.5h5.2a2.3 2.3 0 0 0 .8-4.4M8.6 3.3A3.5 3.5 0 0 0 4 5.6a2.5 2.5 0 0 0-.6 4.6" {...stroke} />
        </Svg>
      );
    case "bell":
      return (
        <Svg {...props}>
          <path d="M3.5 9.8V6.6a3.5 3.5 0 0 1 7 0v3.2l1 1.2h-9z M5.8 12.2a1.3 1.3 0 0 0 2.4 0" {...stroke} />
        </Svg>
      );
    case "bell-filled":
      return (
        <Svg {...props}>
          <path d="M3.5 9.8V6.6a3.5 3.5 0 0 1 7 0v3.2l1 1.2h-9z" fill="currentColor" {...stroke} />
          <path d="M5.8 12.2a1.3 1.3 0 0 0 2.4 0" {...stroke} />
        </Svg>
      );
    case "external":
      return (
        <Svg {...props}>
          <path d="M8 2.5h3.5V6M11.3 2.7 6.5 7.5M10 8.5v2a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h2" {...stroke} />
        </Svg>
      );
    case "attachment":
      return (
        <Svg {...props}>
          <path d="m11.2 6.6-4.4 4.5a2.6 2.6 0 0 1-3.7-3.7l4.6-4.7a1.7 1.7 0 0 1 2.5 2.4L5.6 9.7a.8.8 0 0 1-1.2-1.2l4.1-4.2" {...stroke} />
        </Svg>
      );
    case "download":
      return (
        <Svg {...props}>
          <path d="M7 2.5v6.5M4.3 6.5 7 9.2l2.7-2.7M2.5 11.5h9" {...stroke} />
        </Svg>
      );
    case "trash":
      return (
        <Svg {...props}>
          <path d="M2.5 4h9M5.5 4V2.8h3V4M3.7 4l.6 7.2a.8.8 0 0 0 .8.8h3.8a.8.8 0 0 0 .8-.8l.6-7.2" {...stroke} />
        </Svg>
      );
    case "file":
      return (
        <Svg {...props}>
          <path d="M8 1.8H4a1 1 0 0 0-1 1v8.4a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.8L8 1.8Zm0 0v3h3" {...stroke} />
        </Svg>
      );
    case "cycle":
      return (
        <Svg {...props}>
          <circle cx="7" cy="7" r="5" {...stroke} />
          <path d="M7 4v3l2 1.3" {...stroke} />
        </Svg>
      );
    case "time":
      return (
        <Svg {...props}>
          <circle cx="7" cy="8" r="4.6" {...stroke} />
          <path d="M5.6 1.8h2.8M7 1.8v1.6M7 8V5.7M10.6 3.8l.9-.9" {...stroke} />
        </Svg>
      );
    case "edit":
      return (
        <Svg {...props}>
          <path d="M9.4 2.6a1.2 1.2 0 0 1 1.7 1.7L5 10.4l-2.3.6.6-2.3 6.1-6.1Z" {...stroke} />
        </Svg>
      );
    case "filter":
      return (
        <Svg {...props}>
          <path d="M2 3.5h10M4 7h6M5.8 10.5h2.4" {...stroke} />
        </Svg>
      );
    case "close":
      return (
        <Svg {...props}>
          <path d="m4 4 6 6M10 4l-6 6" {...stroke} />
        </Svg>
      );
    case "display":
      return (
        <Svg {...props}>
          <path d="M2 4h4M9 4h3M2 10h2M7 10h5" {...stroke} />
          <circle cx="7.5" cy="4" r="1.5" {...stroke} />
          <circle cx="5.5" cy="10" r="1.5" {...stroke} />
        </Svg>
      );
    case "list":
      return (
        <Svg {...props}>
          <path d="M2.5 3.5h9M2.5 7h9M2.5 10.5h9" {...stroke} />
        </Svg>
      );
    case "board":
      return (
        <Svg {...props}>
          <rect x="1.8" y="2.5" width="3" height="9" rx="1" {...stroke} />
          <rect x="5.5" y="2.5" width="3" height="6" rx="1" {...stroke} />
          <rect x="9.2" y="2.5" width="3" height="7.5" rx="1" {...stroke} />
        </Svg>
      );
    case "timeline":
      return (
        <Svg {...props}>
          <path d="M2 3.5h5.5M4.5 7h6M7 10.5h5" {...stroke} strokeWidth={2.2} />
        </Svg>
      );
    case "calendar":
      return (
        <Svg {...props}>
          <rect x="2" y="2.8" width="10" height="9" rx="1.6" {...stroke} />
          <path d="M2 5.8h10M4.8 1.6v2.2M9.2 1.6v2.2" {...stroke} />
        </Svg>
      );
    case "category":
      return (
        <Svg {...props}>
          <path d="M2 4a1 1 0 0 1 1-1h2.5l1.2 1.3H11a1 1 0 0 1 1 1V10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" {...stroke} />
        </Svg>
      );
    case "tracker":
      return (
        <Svg {...props}>
          <rect x="2.5" y="2.5" width="9" height="9" rx="2" {...stroke} />
          <path d="M5 7h4" {...stroke} />
        </Svg>
      );
    case "done":
      return (
        <Svg {...props}>
          <circle cx="7" cy="7" r="4.5" {...stroke} />
          <path d="M7 2.5A4.5 4.5 0 0 1 11.5 7H7z" fill="currentColor" />
        </Svg>
      );
    case "more":
      return (
        <Svg {...props}>
          <circle cx="3.5" cy="7" r="1" fill="currentColor" />
          <circle cx="7" cy="7" r="1" fill="currentColor" />
          <circle cx="10.5" cy="7" r="1" fill="currentColor" />
        </Svg>
      );
    case "copy":
      return (
        <Svg {...props}>
          <rect x="4.5" y="4.5" width="7" height="7" rx="1.3" {...stroke} />
          <path d="M9.5 4.5V3.8a1.3 1.3 0 0 0-1.3-1.3H3.8a1.3 1.3 0 0 0-1.3 1.3v4.4a1.3 1.3 0 0 0 1.3 1.3h.7" {...stroke} />
        </Svg>
      );
    case "view":
      return (
        <Svg {...props}>
          <rect x="2.5" y="2.5" width="9" height="3.5" rx="1" {...stroke} />
          <rect x="2.5" y="8" width="9" height="3.5" rx="1" {...stroke} />
        </Svg>
      );
    case "check":
      return (
        <Svg {...props}>
          <path d="M3 7.3 5.8 10 11 4" {...stroke} strokeWidth={1.8} />
        </Svg>
      );
    case "lock":
      return (
        <Svg {...props}>
          <rect x="3" y="6.5" width="8" height="5" rx="1.2" {...stroke} />
          <path d="M5 6.5V5a2 2 0 0 1 4 0v1.5" {...stroke} />
        </Svg>
      );
    case "plus":
      return (
        <Svg {...props}>
          <path d="M7 3v8M3 7h8" {...stroke} />
        </Svg>
      );
    case "relation":
      return (
        <Svg {...props}>
          <path d="M6 8.2a2.6 2.6 0 0 0 3.7 0l1.6-1.6a2.6 2.6 0 0 0-3.7-3.7l-.7.7M8 5.8a2.6 2.6 0 0 0-3.7 0L2.7 7.4a2.6 2.6 0 0 0 3.7 3.7l.7-.7" {...stroke} />
        </Svg>
      );
    case "sub-issue":
      return (
        <Svg {...props}>
          <path d="M3.5 2.5v6a2 2 0 0 0 2 2h3" {...stroke} />
          <circle cx="10.5" cy="10.5" r="1.8" {...stroke} />
          <circle cx="3.5" cy="2.5" r="0.4" {...stroke} />
        </Svg>
      );
    case "blocked":
      return (
        <Svg {...props}>
          <circle cx="7" cy="7" r="5" {...stroke} />
          <path d="m3.5 10.5 7-7" {...stroke} />
        </Svg>
      );
    case "mention":
      return (
        <Svg {...props}>
          <path d="M5.5 2 4.5 12M9.5 2l-1 10M2.5 5h9.5M2 9h9.5" {...stroke} />
        </Svg>
      );
  }
}

export type IconName =
  | "relation"
  | "sub-issue"
  | "blocked"
  | "mention"
  | "attachment"
  | "download"
  | "trash"
  | "file"
  | "filter"
  | "close"
  | "plus"
  | "list"
  | "board"
  | "timeline"
  | "calendar"
  | "display"
  | "inbox"
  | "my-issues"
  | "search"
  | "issues"
  | "project"
  | "chevron-right"
  | "chevron-down"
  | "back"
  | "sync"
  | "offline"
  | "external"
  | "bell"
  | "bell-filled"
  | "cycle"
  | "time"
  | "edit"
  | "category"
  | "tracker"
  | "done"
  | "lock"
  | "check"
  | "view"
  | "more"
  | "copy";
