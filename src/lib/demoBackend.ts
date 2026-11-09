import type { Backend } from "./backend";
import { applyChanges as applyEdit } from "./edit";
import type {
  Account,
  Issue,
  IssueChanges,
  IssueDetails,
  IssuesChanged,
  Journal,
  Metadata,
  Named,
  SyncState,
} from "./types";

// Sample data for running the UI in a plain browser (`npm run dev`) and in
// tests. Nothing here talks to a network.

const people: Named[] = [
  { id: 1, name: "Dana Developer" },
  { id: 2, name: "Sam Teammate" },
  { id: 3, name: "Riley Chen" },
  { id: 4, name: "Jordan Patel" },
];

const subjects = [
  "Command palette opens with Cmd+K",
  "Sync stops after the laptop sleeps",
  "Issue list scrolls smoothly with 5,000 issues",
  "Dark mode follows the system setting",
  "Show who changed the status in the activity feed",
  "Keyboard shortcut to assign to me",
  "Markdown tables render in descriptions",
  "Retry failed edits when back online",
  "Remember the last opened team",
  "Group the list by assignee",
  "Show the cycle's progress in the sidebar",
  "Paste an image into a comment",
  "Search issues by id from anywhere",
  "Tooltip delay matches the system",
  "Crash when the server returns HTML",
  "Translate status names from Redmine",
  "Explain why a status change was refused",
  "Mention teammates with @ in comments",
  "Open an issue in Redmine from the context menu",
  "Undo the last status change",
  "Window remembers its size and position",
  "Use the system accent colour for focus rings",
  "Offline banner when the server can't be reached",
  "Move unfinished issues to the next cycle",
  "Sort by priority, then by last update",
  "Label chips use the custom field's colours",
  "Faster first sync on large servers",
  "Sign in with a server behind a sub-path",
  "Copy issue link with Cmd+Shift+C",
  "Sub-issues show their parent in the list",
];

function iso(daysAgo: number, hours = 0): string {
  const d = new Date(Date.UTC(2026, 10, 9, 12 - hours) - daysAgo * 86_400_000);
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function buildMetadata(): Metadata {
  return {
    user: { id: 1, login: "dev", firstname: "Dana", lastname: "Developer", admin: false },
    projects: [
      {
        id: 1,
        name: "Web",
        identifier: "web",
        trackers: [
          { id: 1, name: "Bug" },
          { id: 2, name: "Feature" },
        ],
        issue_categories: [],
        enabled_modules: [{ id: 1, name: "issue_tracking" }],
        issue_custom_fields: [
          { id: 1, name: "Area" },
          { id: 2, name: "Size" },
        ],
      },
      {
        id: 3,
        name: "Design",
        identifier: "web-design",
        parent: { id: 1, name: "Web" },
        trackers: [{ id: 2, name: "Feature" }],
        issue_categories: [],
        enabled_modules: [{ id: 1, name: "issue_tracking" }],
        issue_custom_fields: [{ id: 1, name: "Area" }],
      },
      {
        id: 2,
        name: "Mobile",
        identifier: "mobile",
        trackers: [{ id: 1, name: "Bug" }],
        issue_categories: [],
        enabled_modules: [{ id: 1, name: "issue_tracking" }],
        issue_custom_fields: [],
      },
    ],
    statuses: [
      { id: 1, name: "New", is_closed: false },
      { id: 2, name: "In Progress", is_closed: false },
      { id: 3, name: "Resolved", is_closed: false },
      { id: 4, name: "Feedback", is_closed: false },
      { id: 5, name: "Closed", is_closed: true },
      { id: 6, name: "Rejected", is_closed: true },
    ],
    trackers: [
      { id: 1, name: "Bug", default_status: { id: 1, name: "New" } },
      { id: 2, name: "Feature", default_status: { id: 1, name: "New" } },
    ],
    priorities: [
      { id: 1, name: "Low", is_default: false, active: true },
      { id: 2, name: "Normal", is_default: true, active: true },
      { id: 3, name: "High", is_default: false, active: true },
      { id: 4, name: "Urgent", is_default: false, active: true },
      { id: 5, name: "Immediate", is_default: false, active: true },
    ],
    versions: [
      { id: 1, project: { id: 1, name: "Web" }, name: "Sprint 1", status: "closed", due_date: "2026-10-26" },
      { id: 2, project: { id: 1, name: "Web" }, name: "Sprint 2", status: "open", due_date: "2026-11-16" },
      { id: 3, project: { id: 1, name: "Web" }, name: "Sprint 3", status: "open", due_date: "2026-11-30" },
    ],
    memberships: [1, 2]
      .flatMap((projectId) =>
        people.map((p, i) => ({
          id: projectId * 10 + i,
          project: { id: projectId, name: projectId === 1 ? "Web" : "Mobile" },
          user: p,
          roles: [{ id: 4, name: "Developer" }],
        })),
      ),
  };
}

function buildIssues(meta: Metadata): Issue[] {
  const areas = [["UI"], ["Sync"], ["UI", "Performance"], ["API"], [], ["Docs"]];
  return subjects.map((subject, i) => {
    const id = i + 1;
    const status = meta.statuses[[0, 1, 1, 2, 3, 0, 4, 5, 0, 1][i % 10]!]!;
    const project = i % 7 === 6 ? meta.projects[2]! : i % 5 === 4 ? meta.projects[1]! : meta.projects[0]!;
    return {
      id,
      project: { id: project.id, name: project.name },
      tracker: i % 3 === 0 ? { id: 1, name: "Bug" } : { id: 2, name: "Feature" },
      status: { id: status.id, name: status.name, is_closed: status.is_closed },
      priority: { id: meta.priorities[i % 5]!.id, name: meta.priorities[i % 5]!.name },
      author: people[(i + 1) % people.length]!,
      assigned_to: i % 4 === 3 ? null : people[i % people.length]!,
      fixed_version: project.id === 1 && i % 3 !== 2 ? { id: i % 4 === 0 ? 1 : 2, name: i % 4 === 0 ? "Sprint 1" : "Sprint 2" } : null,
      subject,
      description:
        i % 2 === 0
          ? `## Why\n\nPeople expect this from a native app. See #${(id % subjects.length) + 1} for context.\n\n- [ ] Design\n- [x] Agree on scope\n\n@sam can you review?`
          : null,
      is_private: false,
      done_ratio: 0,
      custom_fields: [
        { id: 1, name: "Area", multiple: true, value: areas[i % areas.length]! },
        { id: 2, name: "Size", value: ["S", "M", "L", null][i % 4] ?? null },
      ],
      created_on: iso(30 - i),
      updated_on: iso(Math.floor(i / 3), i % 3),
    };
  });
}

function buildJournals(issue: Issue): Journal[] {
  return [
    {
      id: issue.id * 100 + 1,
      user: people[1]!,
      notes: null,
      created_on: issue.created_on,
      private_notes: false,
      details: [{ property: "attr", name: "status_id", old_value: "1", new_value: String(issue.status.id) }],
    },
    {
      id: issue.id * 100 + 2,
      user: people[0]!,
      notes: "Looks good. I'll pick this up after the sync work lands.",
      created_on: issue.updated_on,
      private_notes: false,
      details: [],
    },
  ];
}

const DEMO_SERVER = "https://redmine.example.com/";

export function createDemoBackend(options: { signedIn?: boolean; latencyMs?: number } = {}): Backend {
  const latency = options.latencyMs ?? 0;
  const wait = <T>(value: T) => new Promise<T>((r) => setTimeout(() => r(value), latency));
  const meta = buildMetadata();
  const issues = new Map(buildIssues(meta).map((i) => [i.id, i]));
  let account: Account | null = options.signedIn
    ? { serverUrl: DEMO_SERVER, userId: 1, login: "dev", name: "Dana Developer" }
    : null;
  const syncHandlers = new Set<(s: SyncState) => void>();
  const changeHandlers = new Set<(c: IssuesChanged) => void>();
  let lastSyncedAt = Date.now();

  const details = (id: number): IssueDetails => {
    const issue = issues.get(id);
    if (!issue) throw { code: "not_found", message: "Not found in Redmine." };
    return {
      issue,
      journals: buildJournals(issue),
      allowedStatuses: meta.statuses.map((s) => ({ id: s.id, name: s.name, is_closed: s.is_closed })),
    };
  };

  const applyChanges = (issue: Issue, c: IssueChanges): Issue => applyEdit(issue, c, meta);

  return {
    appInfo: () => wait({ version: "0.1.0-demo", platform: /Mac/.test(navigator.platform) ? "macos" : "windows" }),
    getAccount: () => wait(account),
    async signIn(serverUrl, apiKey) {
      await wait(null);
      if (!apiKey.trim()) throw { code: "unauthorized", message: "Paste your Redmine API key." };
      if (!serverUrl.trim()) throw { code: "invalid_url", message: "That doesn't look like a web address: the address is empty" };
      account = { serverUrl: DEMO_SERVER, userId: 1, login: "dev", name: "Dana Developer" };
      return account;
    },
    async signOut() {
      account = null;
    },
    getMetadata: () => wait(meta),
    listIssues: () => wait([...issues.values()].sort((a, b) => b.updated_on.localeCompare(a.updated_on))),
    getIssues: (ids) => wait(ids.flatMap((id) => (issues.has(id) ? [issues.get(id)!] : []))),
    getIssueDetails: (id) => wait(details(id)),
    getSyncState: () => wait(account ? { state: "idle" as const, lastSyncedAt, message: null } : null),
    async syncNow() {
      lastSyncedAt = Date.now();
      syncHandlers.forEach((h) => h({ state: "idle", lastSyncedAt, message: null }));
    },
    async updateIssue(id, changes) {
      await wait(null);
      const issue = issues.get(id);
      if (!issue) throw { code: "not_found", message: "Not found in Redmine." };
      issues.set(id, applyChanges(issue, changes));
      changeHandlers.forEach((h) => h({ changed: [id], removed: [] }));
      return details(id);
    },
    async createIssue(fields) {
      await wait(null);
      const id = Math.max(...issues.keys()) + 1;
      const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
      const project = meta.projects.find((p) => p.id === fields.project_id) ?? meta.projects[0]!;
      const base: Issue = {
        id,
        project: { id: project.id, name: project.name },
        tracker: project.trackers[0] ?? { id: 1, name: "Bug" },
        status: { id: 1, name: "New", is_closed: false },
        priority: { id: 2, name: "Normal" },
        author: people[0]!,
        assigned_to: null,
        subject: fields.subject ?? "",
        description: fields.description ?? null,
        is_private: false,
        custom_fields: [],
        created_on: now,
        updated_on: now,
      };
      const issue = applyChanges(base, { ...fields, subject: undefined, description: undefined });
      issues.set(id, issue);
      changeHandlers.forEach((h) => h({ changed: [id], removed: [] }));
      return issue;
    },
    async onSyncState(handler) {
      syncHandlers.add(handler);
      handler({ state: "idle", lastSyncedAt, message: null });
      return () => syncHandlers.delete(handler);
    },
    async onIssuesChanged(handler) {
      changeHandlers.add(handler);
      return () => changeHandlers.delete(handler);
    },
    async onMetadataChanged() {
      return () => {};
    },
    async onMenu() {
      return () => {};
    },
  };
}
