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
    case "external":
      return (
        <Svg {...props}>
          <path d="M8 2.5h3.5V6M11.3 2.7 6.5 7.5M10 8.5v2a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h2" {...stroke} />
        </Svg>
      );
    case "cycle":
      return (
        <Svg {...props}>
          <circle cx="7" cy="7" r="5" {...stroke} />
          <path d="M7 4v3l2 1.3" {...stroke} />
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
    case "plus":
      return (
        <Svg {...props}>
          <path d="M7 3v8M3 7h8" {...stroke} />
        </Svg>
      );
  }
}

export type IconName =
  | "filter"
  | "close"
  | "plus"
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
  | "cycle";
