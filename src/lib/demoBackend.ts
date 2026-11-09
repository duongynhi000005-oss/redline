import type { Backend } from "./backend";
import type { ConnectionOptions } from "./connection";
import { NO_CONNECTION, connectionProblem, normalizeConnection } from "./connection";
import { applyChanges as applyEdit } from "./edit";
import { INVERSE, mentionedIds } from "./relations";
import type {
  SearchKind,
  SearchResult,
  Account,
  Attachment,
  Changeset,
  Issue,
  IssueChanges,
  IssueDetails,
  IssuesChanged,
  Journal,
  Metadata,
  Named,
  Project,
  Relation,
  SyncState,
  TimeEntry,
  User,
  Version,
  WikiPage,
  News,
  ProjectFile,
} from "./types";

// Sample data for running the UI in a plain browser (`npm run dev`) and in
// tests. Nothing here talks to a network.

const people: Named[] = [
  { id: 1, name: "Dana Developer" },
  { id: 2, name: "Sam Teammate" },
  { id: 3, name: "Riley Chen" },
  { id: 4, name: "Jordan Patel" },
];

// What Redmine shows of each person to Dana. Riley hides their email.
const demoUsers: User[] = [
  { id: 1, login: "dev", firstname: "Dana", lastname: "Developer", mail: "dana@example.com", admin: false, created_on: "2026-03-02T09:00:00Z" },
  { id: 2, login: "sam", firstname: "Sam", lastname: "Teammate", mail: "sam@example.com", admin: false, created_on: "2026-04-14T09:00:00Z" },
  { id: 3, login: "riley", firstname: "Riley", lastname: "Chen", mail: null, admin: false, created_on: "2026-05-20T09:00:00Z" },
  { id: 4, login: "jordan", firstname: "Jordan", lastname: "Patel", mail: "jordan@example.com", admin: false, created_on: "2026-06-08T09:00:00Z" },
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
    user: {
      id: 1,
      login: "dev",
      firstname: "Dana",
      lastname: "Developer",
      admin: false,
      memberships: [
        { project: { id: 1, name: "Web" }, roles: [{ id: 3, name: "Manager" }] },
        { project: { id: 2, name: "Mobile" }, roles: [{ id: 4, name: "Developer" }] },
      ],
    },
    projects: [
      {
        id: 1,
        name: "Web",
        identifier: "web",
        description: "The **Redline** web team: the list, board and sync engine.",
        homepage: "https://example.com/web",
        status: 1,
        is_public: true,
        created_on: "2026-03-02T09:00:00Z",
        trackers: [
          { id: 1, name: "Bug" },
          { id: 2, name: "Feature" },
        ],
        issue_categories: [
          { id: 1, name: "Frontend" },
          { id: 2, name: "Sync engine" },
          { id: 3, name: "Docs" },
        ],
        enabled_modules: [
          { id: 1, name: "issue_tracking" },
          { id: 2, name: "time_tracking" },
          { id: 3, name: "wiki" },
          { id: 4, name: "news" },
          { id: 5, name: "files" },
          { id: 6, name: "boards" },
          { id: 7, name: "repository" },
          { id: 8, name: "documents" },
        ],
        issue_custom_fields: [
          { id: 1, name: "Area" },
          { id: 2, name: "Size" },
          { id: 3, name: "Review by" },
        ],
      },
      {
        id: 3,
        name: "Design",
        identifier: "web-design",
        description: "Icons, colors and type for Redline.",
        parent: { id: 1, name: "Web" },
        status: 1,
        is_public: false,
        created_on: "2026-05-11T09:00:00Z",
        trackers: [{ id: 2, name: "Feature" }],
        issue_categories: [],
        enabled_modules: [{ id: 1, name: "issue_tracking" }],
        issue_custom_fields: [{ id: 1, name: "Area" }],
      },
      {
        id: 2,
        name: "Mobile",
        identifier: "mobile",
        status: 1,
        is_public: false,
        created_on: "2026-04-01T09:00:00Z",
        trackers: [{ id: 1, name: "Bug" }],
        issue_categories: [],
        enabled_modules: [
          { id: 1, name: "issue_tracking" },
          { id: 2, name: "time_tracking" },
          { id: 4, name: "news" },
        ],
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
      {
        id: 1,
        project: { id: 1, name: "Web" },
        name: "Sprint 1",
        status: "closed",
        due_date: "2026-10-26",
        sharing: "none",
        description: "List view, sign-in and sync.",
      },
      {
        id: 2,
        project: { id: 1, name: "Web" },
        name: "Sprint 2",
        status: "open",
        due_date: "2026-11-16",
        sharing: "descendants",
        description: "Keyboard first: the command palette and single-key shortcuts.",
        wiki_page_title: "Sprint_2",
      },
      { id: 3, project: { id: 1, name: "Web" }, name: "Sprint 3", status: "open", due_date: "2026-11-30", sharing: "none" },
    ],
    memberships: [1, 2].flatMap((projectId) =>
      people.map((p, i) => ({
        id: projectId * 10 + i,
        project: { id: projectId, name: projectId === 1 ? "Web" : "Mobile" },
        user: p,
        // Dana manages Web, as her own memberships say.
        roles: projectId === 1 && p.id === 1 ? [{ id: 3, name: "Manager" }] : [{ id: 4, name: "Developer" }],
      })),
    ),
    // As in Redmine's defaults: managers handle watchers and anyone's time,
    // developers can't watch for others and fix only their own time.
    roles: [
      {
        id: 3,
        name: "Manager",
        permissions: [
          "view_issues",
          "add_issues",
          "edit_issues",
          "set_issues_private",
          "view_issue_watchers",
          "add_issue_watchers",
          "delete_issue_watchers",
          "view_time_entries",
          "log_time",
          "edit_time_entries",
          "manage_versions",
          "add_subprojects",
          "edit_project",
          "close_project",
          "delete_project",
          "delete_issues",
          "edit_issue_notes",
          "manage_issue_relations",
          "view_wiki_pages",
          "view_wiki_edits",
          "edit_wiki_pages",
          "rename_wiki_pages",
          "delete_wiki_pages",
          "view_news",
          "manage_news",
          "comment_news",
          "view_files",
          "manage_files",
          "view_changesets",
          "view_documents",
          "view_messages",
        ],
      },
      {
        id: 4,
        name: "Developer",
        permissions: [
          "view_issues",
          "add_issues",
          "edit_issues",
          "edit_own_issue_notes",
          "view_time_entries",
          "log_time",
          "edit_own_time_entries",
          "view_wiki_pages",
          "view_wiki_edits",
          "edit_wiki_pages",
          "view_news",
          "comment_news",
          "view_files",
          "view_changesets",
          "view_documents",
          "view_messages",
        ],
      },
    ],
    time_entry_activities: [
      { id: 8, name: "Design", is_default: false },
      { id: 9, name: "Development", is_default: true },
      { id: 10, name: "Review", is_default: false },
    ],
    queries: [
      { id: 1, name: "Open bugs", is_public: true, project_id: 1 },
      { id: 2, name: "Assigned to me, by due date", is_public: false, project_id: null },
    ],
  };
}

/** Pages the demo's search finds besides issues, all in Web. */
const DEMO_PAGES: (SearchResult & { kind: SearchKind; datetime: string })[] = [
  { id: 1, title: "Wiki: Release checklist", type: "wiki-page", kind: "wiki_pages", url: "https://redmine.example.com/projects/web/wiki/Release_checklist", datetime: "2026-11-01T09:00:00Z" },
  { id: 1, title: "News: Board view ships in Sprint 2", type: "news", kind: "news", url: "https://redmine.example.com/news/1", datetime: "2026-11-01T09:00:00Z" },
  {
    id: 3,
    title: "Document: Board view spec",
    type: "document",
    kind: "documents",
    url: "https://redmine.example.com/documents/3",
    description: "How the board groups issues, and what dragging a card changes.",
    datetime: "2026-11-02T10:00:00Z",
  },
  {
    id: 4,
    title: "Document: Keyboard shortcuts",
    type: "document",
    kind: "documents",
    url: "https://redmine.example.com/documents/4",
    description: "Every shortcut on the **board** and in lists, for macOS and Windows.",
    datetime: "2026-10-28T10:00:00Z",
  },
  {
    id: 2,
    title: "General: RE: Syncing on a slow connection",
    type: "reply",
    kind: "messages",
    url: "https://redmine.example.com/boards/1/topics/1?r=2#message-2",
    description: "Not yet. A board of just your issues is planned.",
    datetime: "2026-11-06T16:00:00Z",
  },
  {
    id: 1,
    title: "General: Syncing on a slow connection",
    type: "message",
    kind: "messages",
    url: "https://redmine.example.com/boards/1/topics/1",
    description: "Sync takes a minute on hotel Wi-Fi. Is there a way to sync only my issues?",
    datetime: "2026-11-06T09:00:00Z",
  },
];

/** A date this many days from the demo's today. */
function day(offset: number): string {
  return new Date(Date.UTC(2026, 10, 9) + offset * 86_400_000).toISOString().slice(0, 10);
}

function buildIssues(meta: Metadata): Issue[] {
  const areas = [["UI"], ["Sync"], ["UI", "Performance"], ["API"], [], ["Docs"]];
  return subjects.map((subject, i) => {
    const id = i + 1;
    const status = meta.statuses[[0, 1, 1, 2, 3, 0, 4, 5, 0, 1][i % 10]!]!;
    const project = i % 7 === 6 ? meta.projects[2]! : i % 5 === 4 ? meta.projects[1]! : meta.projects[0]!;
    // Most issues are scheduled around today; some have only a due date, some none.
    const start = -12 + i * 2;
    const scheduled = i % 6 !== 5;
    return {
      id,
      project: { id: project.id, name: project.name },
      tracker: i % 3 === 0 ? { id: 1, name: "Bug" } : { id: 2, name: "Feature" },
      status: { id: status.id, name: status.name, is_closed: status.is_closed },
      priority: { id: meta.priorities[i % 5]!.id, name: meta.priorities[i % 5]!.name },
      author: people[(i + 1) % people.length]!,
      assigned_to: i % 4 === 3 ? null : people[i % people.length]!,
      fixed_version:
        project.id === 1 && i % 3 !== 2 ? { id: i % 4 === 0 ? 1 : 2, name: i % 4 === 0 ? "Sprint 1" : "Sprint 2" } : null,
      subject,
      description:
        i % 2 === 0
          ? `## Why\n\nPeople expect this from a native app. See #${(id % subjects.length) + 1} for context.\n\n- [ ] Design\n- [x] Agree on scope\n\n@sam can you review?${id === 3 ? "\n\n![The mockup](mockup.svg)" : ""}`
          : null,
      category: project.id === 1 && i % 4 !== 1 ? meta.projects[0]!.issue_categories[i % 3]! : null,
      estimated_hours: i % 3 === 0 ? [2, 4, 8, 1.5][i % 4]! : null,
      is_private: false,
      done_ratio: [0, 20, 50, 0, 100][i % 5]!,
      start_date: scheduled && i % 8 !== 7 ? day(start) : null,
      due_date: scheduled ? day(start + [4, 9, 6, 13, 3][i % 5]!) : null,
      custom_fields: [
        { id: 1, name: "Area", multiple: true, value: areas[i % areas.length]! },
        { id: 2, name: "Size", value: ["S", "M", "L", null][i % 4] ?? null },
        ...(project.id === 1 ? [{ id: 3, name: "Review by", value: i % 3 === 1 ? day(start + 2) : "" }] : []),
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

/** What the core says when a proxy turns sign-in away. */
const GATEWAY_REFUSAL = {
  code: "refused",
  message:
    "The server didn't let the request through (HTTP 401). If a proxy or gateway sits in front of Redmine, it may need a username or other headers.",
};

export function createDemoBackend(options: { signedIn?: boolean; latencyMs?: number } = {}): Backend {
  const latency = options.latencyMs ?? 0;
  const wait = <T>(value: T) => new Promise<T>((r) => setTimeout(() => r(value), latency));
  let meta = buildMetadata();
  const issues = new Map(buildIssues(meta).map((i) => [i.id, i]));
  let nextRelationId = 1;
  const relate = (from: number, to: number, type: Relation["relation_type"]) => {
    const relation: Relation = { id: nextRelationId++, issue_id: from, issue_to_id: to, relation_type: type, delay: null };
    for (const id of [from, to]) {
      const issue = issues.get(id);
      if (issue) issues.set(id, { ...issue, relations: [...(issue.relations ?? []), relation] });
    }
    return relation;
  };
  // A few connections, so the Related section has something to show.
  relate(3, 2, "blocks");
  relate(1, 13, "relates");
  relate(15, 17, "duplicates");
  relate(2, 9, "precedes");
  for (const child of [11, 12]) {
    const issue = issues.get(child)!;
    issues.set(child, { ...issue, parent: { id: 1 } });
  }
  let connection: ConnectionOptions = NO_CONNECTION;
  let account: Account | null = options.signedIn
    ? { serverUrl: DEMO_SERVER, userId: 1, login: "dev", name: "Dana Developer" }
    : null;
  const syncHandlers = new Set<(s: SyncState) => void>();
  const changeHandlers = new Set<(c: IssuesChanged) => void>();
  const metaHandlers = new Set<() => void>();
  let nextVersion = 100;
  /** Swaps in a new metadata object, so the app sees the change. */
  const setVersions = (versions: Version[]) => {
    meta = { ...meta, versions: versions.sort((a, b) => a.id - b.id) };
    metaHandlers.forEach((h) => h());
  };
  const manageable = (projectId: number) => {
    if (!may(projectId, "manage_versions"))
      throw { code: "forbidden", message: "You don't have permission to do that in Redmine." };
  };
  let nextProject = 100;
  const setProjects = (projects: Project[]) => {
    meta = { ...meta, projects };
    metaHandlers.forEach((h) => h());
  };
  const forbidden = () => ({ code: "forbidden", message: "You don't have permission to do that in Redmine." });
  const tree = (rootId: number) => {
    const ids = new Set([rootId]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const p of meta.projects)
        if (p.parent && ids.has(p.parent.id) && !ids.has(p.id)) {
          ids.add(p.id);
          grew = true;
        }
    }
    return ids;
  };
  let lastSyncedAt = Date.now();

  // Who watches what; the demo user watches what they're assigned.
  const watchers = new Map<number, Named[]>();
  // Comments changed or removed, by journal id.
  const commentEdits = new Map<number, { notes: string; at: string }>();
  // Comments added here, by issue.
  const comments = new Map<number, Journal[]>();
  for (const issue of issues.values()) {
    const list = [issue.author, issue.assigned_to].filter((p): p is Named => !!p);
    watchers.set(
      issue.id,
      list.filter((p, i) => list.findIndex((q) => q.id === p.id) === i),
    );
  }
  // Attachments and their content, by issue.
  const encode = (text: string) => new TextEncoder().encode(text);
  const mockup = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300" viewBox="0 0 480 300"><rect width="480" height="300" rx="16" fill="#eef0fb"/><rect x="24" y="24" width="120" height="252" rx="10" fill="#d9dcf5"/><rect x="164" y="24" width="292" height="36" rx="8" fill="#5e6ad2"/><rect x="164" y="80" width="292" height="24" rx="6" fill="#ffffff"/><rect x="164" y="114" width="292" height="24" rx="6" fill="#ffffff"/><rect x="164" y="148" width="220" height="24" rx="6" fill="#ffffff"/></svg>`;
  let nextAttachment = 100;
  const files = new Map<number, { attachment: Attachment; bytes: Uint8Array }[]>();
  const addFile = (
    issueId: number,
    filename: string,
    contentType: string,
    bytes: Uint8Array,
    author: Named,
    created_on: string,
  ) => {
    const attachment: Attachment = {
      id: nextAttachment++,
      filename,
      filesize: bytes.length,
      content_type: contentType,
      author,
      created_on,
    };
    files.set(issueId, [...(files.get(issueId) ?? []), { attachment, bytes }]);
    return attachment;
  };
  addFile(3, "mockup.svg", "image/svg+xml", encode(mockup), people[1]!, iso(3));
  addFile(3, "profile.txt", "text/plain", encode("Frames: 60\nRows: 5,000\n"), people[0]!, iso(2));
  addFile(1, "notes.txt", "text/plain", encode("Open with Cmd+K, close with Escape.\n"), people[1]!, iso(5));
  const typeOf = (name: string) =>
    ({
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      svg: "image/svg+xml",
      txt: "text/plain",
      pdf: "application/pdf",
    })[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

  // Web's wiki: every version of each page, oldest first.
  const layout = addFile(-1, "layout.svg", "image/svg+xml", encode(mockup), people[1]!, iso(6));
  const wikis = new Map<number, WikiPage[][]>();
  const wikiVersion = (title: string, parent: string | null, text: string, author: Named, comments: string, day: number): WikiPage => ({
    title,
    parent: parent ? { title: parent } : null,
    text,
    version: 0,
    author,
    comments,
    created_on: iso(day),
    updated_on: iso(day),
    attachments: [],
  });
  const history = (...versions: WikiPage[]) =>
    versions.map((v, i) => ({ ...v, version: i + 1, created_on: versions[0]!.created_on }));
  wikis.set(1, [
    history(
      wikiVersion("Wiki", null, "# Web\n\nNotes for the web team.", people[1]!, "", 20),
      wikiVersion(
        "Wiki",
        null,
        "# Web\n\nThe Redline web team's notes. Start with [[Getting started]], and read [[Release checklist]] before shipping.",
        people[0]!,
        "Point at the guides",
        9,
      ),
      wikiVersion(
        "Wiki",
        null,
        "# Web\n\nThe Redline web team's notes. Start with [[Getting started]], and read [[Release checklist]] before shipping.\n\n" +
          "## This cycle\n\n- Board view polish, see #3\n- Sync engine retries\n\nIdeas that aren't issues yet go in [[Roadmap]].",
        people[0]!,
        "Add this cycle",
        1,
      ),
    ),
    history(
      wikiVersion(
        "Getting_started",
        "Wiki",
        "# Getting started\n\n1. Clone the repository.\n2. Run `npm install`.\n3. Start the app:\n\n```sh\nnpm run tauri dev\n```\n\n" +
          "The layout of the main window:\n\n![](layout.svg)",
        people[1]!,
        "",
        6,
      ),
    ),
    history(
      wikiVersion("Release_checklist", "Wiki", "# Release checklist\n\n- Bump the version\n- Tag", people[2]!, "", 12),
      wikiVersion(
        "Release_checklist",
        "Wiki",
        "# Release checklist\n\n- [ ] Bump the version in `package.json` and `Cargo.toml`\n- [ ] Update the changelog\n" +
          "- [ ] Tag and push\n- [ ] Check the signed builds for macOS and Windows",
        people[0]!,
        "Spell out each step",
        3,
      ),
    ),
    history(
      wikiVersion("Code_review", "Getting_started", "# Code review\n\nEvery change gets one review. Keep pull requests small.", people[3]!, "", 8),
    ),
  ]);
  wikis.get(1)![1]![0]!.attachments = [layout];
  const wikiOf = (projectId: number) => {
    const project = meta.projects.find((p) => p.id === projectId);
    if (!project || !project.enabled_modules.some((m) => m.name === "wiki")) throw { code: "not_found", message: "Not found in Redmine." };
    const list = wikis.get(projectId) ?? [];
    wikis.set(projectId, list);
    return list;
  };
  const findWiki = (projectId: number, title: string) =>
    wikiOf(projectId).find((v) => v[0]!.title.toLowerCase() === title.toLowerCase());
  const latest = (versions: WikiPage[]) => versions[versions.length - 1]!;

  // News, newest first, and each team's files.
  let nextNews = 10;
  let news: News[] = [
    {
      id: 3,
      project: { id: 1, name: "Web" },
      author: people[0]!,
      title: "Redline 0.1 is out",
      summary: "The first release, for macOS and Windows.",
      description: "Download it from the releases page and sign in with your Redmine address and API key.\n\nTell us what's missing in the **Web** team.",
      created_on: iso(1, 3),
      comments: [{ id: 1, author: people[1]!, content: "Works great on my Mac." }],
      attachments: [],
    },
    {
      id: 2,
      project: { id: 2, name: "Mobile" },
      author: people[2]!,
      title: "Mobile beta starts Monday",
      summary: "TestFlight invites go out to the team first.",
      description: "We'll test on iOS for two weeks before Android.",
      created_on: iso(4),
      comments: [],
      attachments: [],
    },
    {
      id: 1,
      project: { id: 1, name: "Web" },
      author: people[1]!,
      title: "Board view ships in Sprint 2",
      summary: "Issues as columns you can drag between.",
      description: "The board groups issues by status, assignee or cycle. Drag a card to change it.",
      created_on: iso(9),
      comments: [
        { id: 2, author: people[3]!, content: "Can it group by label too?" },
        { id: 3, author: people[1]!, content: "Yes, by any label field." },
      ],
      attachments: [],
    },
  ];
  const newsOf = (id: number) => {
    const post = news.find((n) => n.id === id);
    if (!post || !newsAccessible(post.project.id)) throw { code: "not_found", message: "Not found in Redmine." };
    return post;
  };
  const newsAccessible = (projectId: number) =>
    meta.projects.find((p) => p.id === projectId)?.enabled_modules.some((m) => m.name === "news") === true;
  const projectFiles = new Map<number, ProjectFile[]>();
  const addProjectFile = (projectId: number, filename: string, text: string, version: Named | null, description: string, author: Named, day: number) => {
    const a = addFile(-100 - projectId, filename, typeOf(filename), filename.endsWith(".svg") ? encode(mockup) : encode(text), author, iso(day));
    const file: ProjectFile = { ...a, version, description, downloads: day, digest: null };
    projectFiles.set(projectId, [file, ...(projectFiles.get(projectId) ?? [])]);
    return file;
  };
  addProjectFile(1, "board-mockup.svg", "", { id: 1, name: "Sprint 1" }, "The first board sketch", people[1]!, 16);
  addProjectFile(1, "brand-colors.txt", "Red #e5484d\nInk #1c2024\n", null, "Colors for the web app", people[3]!, 12);
  addProjectFile(1, "release-notes.txt", "Board view, timeline and keyboard moves.\n", { id: 2, name: "Sprint 2" }, "What's in Sprint 2", people[0]!, 2);
  const filesOf = (projectId: number) => {
    const project = meta.projects.find((p) => p.id === projectId);
    if (!project?.enabled_modules.some((m) => m.name === "files")) throw forbidden();
    return projectFiles.get(projectId) ?? [];
  };

  // Time logged over the last two weeks.
  let nextTimeEntry = 500;
  const timeEntries: TimeEntry[] = [];
  const activityName = (id: number) => meta.time_entry_activities!.find((a) => a.id === id)?.name ?? "Development";
  const spentOn = (issueId: number) => timeEntries.filter((e) => e.issue?.id === issueId).reduce((sum, e) => sum + e.hours, 0);
  const setSpent = (issueId: number) => {
    const issue = issues.get(issueId);
    if (issue) issues.set(issueId, { ...issue, spent_hours: spentOn(issueId), total_spent_hours: spentOn(issueId) });
  };
  for (const [issueId, who, offset, hours, activity, comments] of [
    [1, 0, 0, 1.5, 9, "Palette shortcuts"],
    [1, 1, -1, 0.5, 10, "Review"],
    [2, 1, -1, 3, 9, "Reproduced on a sleeping laptop"],
    [3, 0, -2, 2, 9, ""],
    [4, 2, -3, 1.25, 8, "Theme tokens"],
    [3, 1, -4, 4, 9, "Virtualized rows"],
    [6, 0, -7, 0.75, 9, ""],
    [8, 2, -8, 2.5, 9, "Retry queue"],
    [7, 1, -2, 1, 9, "Offline banner"],
    [7, 0, -5, 0.5, 10, ""],
  ] as const) {
    const issue = issues.get(issueId)!;
    timeEntries.push({
      id: nextTimeEntry++,
      project: issue.project,
      issue: { id: issueId },
      user: people[who]!,
      activity: { id: activity, name: activityName(activity) },
      hours,
      comments,
      spent_on: day(offset),
      created_on: iso(-offset),
    });
  }
  for (const id of new Set(timeEntries.map((e) => e.issue!.id))) setSpent(id);
  const subProjectsOf = (projectId: number) =>
    new Set([projectId, ...meta.projects.filter((p) => p.parent?.id === projectId).map((p) => p.id)]);

  const may = (projectId: number, permission: string) =>
    meta.user!.memberships!.some(
      (m) =>
        m.project.id === projectId &&
        m.roles.some((r) => meta.roles!.find((x) => x.id === r.id)?.permissions.includes(permission)),
    );
  const details = (id: number): IssueDetails => {
    const issue = issues.get(id);
    if (!issue) throw { code: "not_found", message: "Not found in Redmine." };
    const list = watchers.get(id) ?? [];
    return {
      issue: {
        ...(may(issue.project.id, "view_issue_watchers") ? { ...issue, watchers: list } : issue),
        attachments: (files.get(id) ?? []).map((f) => f.attachment),
        ...(may(issue.project.id, "view_changesets") ? { changesets: commits.get(id) ?? [] } : {}),
      },
      journals: [...buildJournals(issue), ...(comments.get(id) ?? [])].flatMap((j) => {
        const edit = commentEdits.get(j.id);
        if (!edit) return [j];
        // Redmine drops an entry left with no comment and no changes.
        if (!edit.notes && !j.details.length) return [];
        return [{ ...j, notes: edit.notes, updated_on: edit.at }];
      }),
      allowedStatuses: meta.statuses.map((s) => ({ id: s.id, name: s.name, is_closed: s.is_closed })),
      watching: list.some((w) => w.id === meta.user!.id),
    };
  };

  const applyChanges = (issue: Issue, c: IssueChanges): Issue => applyEdit(issue, c, meta);
  // Commits that mention issues, as if Web had a Git repository.
  const commits = new Map<number, Changeset[]>([
    [
      2,
      [
        { revision: "4f1c2a9e7d3b8a6c5f0e1d2c3b4a59687f6e5d4c", user: people[0]!, comments: "Resume syncing after sleep, refs #2", committed_on: iso(0, 2) },
        { revision: "9b0d7e1f2a3c4b5d6e7f8091a2b3c4d5e6f70812", user: people[1]!, comments: "Log the wake-up event\n\nHelps with #2.", committed_on: iso(1, 4) },
      ],
    ],
  ]);

  return {
    appInfo: () =>
      wait({ version: "0.1.0-demo", platform: /Mac/.test(navigator.platform) ? "macos" : "windows", material: "none" }),
    getAccount: () => wait(account),
    async signIn(serverUrl, apiKey, options) {
      await wait(null);
      if (!apiKey.trim()) throw { code: "unauthorized", message: "Paste your Redmine API key." };
      if (!serverUrl.trim()) throw { code: "invalid_url", message: "That doesn't look like a web address: the address is empty" };
      const next = normalizeConnection(options ?? NO_CONNECTION);
      const problem = connectionProblem(next);
      if (problem) throw { code: "invalid_header", message: problem };
      // A demo server behind a gateway that wants a username.
      if (/gateway/.test(serverUrl) && !next.username) throw GATEWAY_REFUSAL;
      connection = next;
      account = { serverUrl: DEMO_SERVER, userId: 1, login: "dev", name: "Dana Developer" };
      return account;
    },
    async signOut() {
      account = null;
      connection = NO_CONNECTION;
    },
    getConnection: () => wait(connection),
    async updateConnection(options) {
      await wait(null);
      if (!account) throw { code: "signed_out", message: "You're signed out." };
      const next = normalizeConnection(options);
      const problem = connectionProblem(next);
      if (problem) throw { code: "invalid_header", message: problem };
      connection = next;
      return connection;
    },
    getMetadata: () => wait(meta),
    listIssues: () => wait([...issues.values()].sort((a, b) => b.updated_on.localeCompare(a.updated_on))),
    getIssues: (ids) => wait(ids.flatMap((id) => (issues.has(id) ? [issues.get(id)!] : []))),
    getIssueDetails: (id) => wait(details(id)),
    issueJournals: (ids) =>
      wait(ids.slice(0, 200).flatMap((id) => (issues.has(id) ? [{ issue_id: id, journals: details(id).journals }] : []))),
    getSyncState: () => wait(account ? { state: "idle" as const, lastSyncedAt, message: null } : null),
    async syncNow() {
      lastSyncedAt = Date.now();
      syncHandlers.forEach((h) => h({ state: "idle", lastSyncedAt, message: null }));
    },
    async updateIssue(id, changes) {
      await wait(null);
      const issue = issues.get(id);
      if (!issue) throw { code: "not_found", message: "Not found in Redmine." };
      const next = applyChanges(issue, changes);
      issues.set(id, next);
      if (changes.notes?.trim()) {
        const list = comments.get(id) ?? [];
        const user = people.find((p) => p.id === meta.user?.id) ?? people[0]!;
        const journal = { id: id * 100 + 50 + list.length, user, notes: changes.notes, created_on: next.updated_on, private_notes: false, details: [] };
        comments.set(id, [...list, journal]);
      }
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
    async deleteIssue(id) {
      await wait(null);
      const issue = issues.get(id);
      if (!issue) throw { code: "not_found", message: "Not found in Redmine." };
      if (!may(issue.project.id, "delete_issues")) {
        throw { code: "forbidden", message: "You don't have permission to do that in Redmine." };
      }
      const removed = [id];
      for (let i = 0; i < removed.length; i++)
        for (const c of issues.values()) if (c.parent?.id === removed[i]) removed.push(c.id);
      for (const r of removed) issues.delete(r);
      const changed: number[] = [];
      for (const other of issues.values()) {
        const kept = (other.relations ?? []).filter((r) => !removed.includes(r.issue_id) && !removed.includes(r.issue_to_id));
        if (kept.length !== (other.relations ?? []).length) {
          issues.set(other.id, { ...other, relations: kept });
          changed.push(other.id);
        }
      }
      changeHandlers.forEach((h) => h({ changed, removed }));
    },
    async updateComment(issueId, journalId, notes) {
      await wait(null);
      if (!issues.has(issueId)) throw { code: "not_found", message: "Not found in Redmine." };
      commentEdits.set(journalId, { notes, at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z") });
      return details(issueId);
    },
    async addRelation(issueId, relation) {
      await wait(null);
      const other = relation.issue_to_id;
      if (!issues.has(issueId) || !issues.has(other))
        throw { code: "rejected", message: "Redmine refused the change: Related issue is invalid" };
      if (other === issueId)
        throw { code: "rejected", message: "Redmine refused the change: Related issue cannot be the same issue" };
      // Redmine stores inverse types the other way round, as here.
      const inverse = ["blocked", "duplicated", "follows", "copied_from"].includes(relation.relation_type);
      const created = inverse
        ? relate(other, issueId, INVERSE[relation.relation_type])
        : relate(issueId, other, relation.relation_type);
      changeHandlers.forEach((h) => h({ changed: [issueId, other], removed: [] }));
      return created;
    },
    async removeRelation(relation) {
      await wait(null);
      for (const id of [relation.issue_id, relation.issue_to_id]) {
        const issue = issues.get(id);
        if (issue) issues.set(id, { ...issue, relations: (issue.relations ?? []).filter((r) => r.id !== relation.id) });
      }
      changeHandlers.forEach((h) => h({ changed: [relation.issue_id, relation.issue_to_id], removed: [] }));
    },
    async setWatcher(issueId, userId, watching) {
      await wait(null);
      const issue = issues.get(issueId);
      if (!issue) throw { code: "not_found", message: "Not found in Redmine." };
      if (!may(issue.project.id, watching ? "add_issue_watchers" : "delete_issue_watchers")) {
        throw { code: "forbidden", message: "You don't have permission to do that in Redmine." };
      }
      const list = (watchers.get(issueId) ?? []).filter((w) => w.id !== userId);
      const person = people.find((p) => p.id === userId);
      if (watching && person) list.push(person);
      watchers.set(issueId, list);
      return details(issueId);
    },
    async openInRedmine() {},
    async openHomepage() {},
    async createProject(fields) {
      await wait(null);
      if (fields.parent_id && !may(fields.parent_id, "add_subprojects")) throw forbidden();
      if (!fields.name?.trim()) throw { code: "validation", message: "Name cannot be blank" };
      if (!fields.identifier || !/^[a-z][a-z0-9_-]{0,99}$/.test(fields.identifier))
        throw { code: "validation", message: "Identifier is invalid" };
      if (meta.projects.some((p) => p.identifier === fields.identifier))
        throw { code: "validation", message: "Identifier has already been taken" };
      const parent = meta.projects.find((p) => p.id === fields.parent_id);
      const project: Project = {
        id: nextProject++,
        name: fields.name.trim(),
        identifier: fields.identifier,
        description: fields.description ?? "",
        homepage: fields.homepage ?? "",
        parent: parent ? { id: parent.id, name: parent.name } : null,
        status: 1,
        is_public: fields.is_public ?? true,
        created_on: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
        trackers: parent?.trackers ?? [],
        issue_categories: [],
        enabled_modules: parent?.enabled_modules ?? [{ id: 1, name: "issue_tracking" }],
        issue_custom_fields: [],
      };
      if (parent && fields.inherit_members) {
        const inherited = meta.memberships
          .filter((m) => m.project.id === parent.id)
          .map((m, i) => ({ ...m, id: project.id * 100 + i, project: { id: project.id, name: project.name } }));
        meta = { ...meta, memberships: [...meta.memberships, ...inherited] };
      }
      setProjects([...meta.projects, project]);
      return project;
    },
    async updateProject(id, changes) {
      await wait(null);
      const project = meta.projects.find((p) => p.id === id);
      if (!project) throw { code: "not_found", message: "Not found" };
      if (!may(id, "edit_project")) throw forbidden();
      if (changes.name !== undefined && !changes.name.trim()) throw { code: "validation", message: "Name cannot be blank" };
      setProjects(meta.projects.map((p) => (p.id === id ? { ...p, ...changes, name: changes.name?.trim() ?? p.name } : p)));
    },
    async setProjectClosed(id, closed) {
      await wait(null);
      if (!meta.projects.some((p) => p.id === id)) throw { code: "not_found", message: "Not found" };
      if (!may(id, "close_project")) throw forbidden();
      const ids = tree(id);
      setProjects(meta.projects.map((p) => (ids.has(p.id) ? { ...p, status: closed ? 5 : 1 } : p)));
    },
    async deleteProject(id) {
      await wait(null);
      if (!meta.projects.some((p) => p.id === id)) throw { code: "not_found", message: "Not found" };
      if (!may(id, "delete_project")) throw forbidden();
      const ids = tree(id);
      const removed = [...issues.values()].filter((i) => ids.has(i.project.id)).map((i) => i.id);
      for (const r of removed) issues.delete(r);
      meta = {
        ...meta,
        memberships: meta.memberships.filter((m) => !ids.has(m.project.id)),
        versions: meta.versions.filter((v) => !ids.has(v.project.id)),
      };
      setProjects(meta.projects.filter((p) => !ids.has(p.id)));
      changeHandlers.forEach((h) => h({ changed: [], removed }));
    },
    async getUser(id) {
      await wait(null);
      const user = demoUsers.find((u) => u.id === id);
      if (!user) throw { code: "not_found", message: "Redmine doesn't show you this person." };
      return { ...user, memberships: undefined };
    },
    async attachmentData(id) {
      await wait(null);
      for (const list of files.values()) {
        const hit = list.find((f) => f.attachment.id === id);
        if (hit) return hit.bytes;
      }
      throw { code: "not_found", message: "Not found in Redmine." };
    },
    async saveAttachment() {
      return wait(true);
    },
    async pickFiles() {
      return wait(["/Users/dana/Desktop/screenshot.png"]);
    },
    async attachFiles(issueId, paths, notes) {
      await wait(null);
      if (!issues.has(issueId)) throw { code: "not_found", message: "Not found in Redmine." };
      for (const path of paths) {
        const name = path.split(/[\\/]/).pop()!;
        addFile(
          issueId,
          name,
          typeOf(name),
          name.endsWith(".svg") ? encode(mockup) : encode(name),
          people[0]!,
          new Date().toISOString(),
        );
      }
      if (notes?.trim()) await this.updateIssue(issueId, { notes });
      changeHandlers.forEach((h) => h({ changed: [issueId], removed: [] }));
      return details(issueId);
    },
    async deleteAttachment(issueId, attachmentId) {
      await wait(null);
      files.set(
        issueId,
        (files.get(issueId) ?? []).filter((f) => f.attachment.id !== attachmentId),
      );
      changeHandlers.forEach((h) => h({ changed: [issueId], removed: [] }));
      return details(issueId);
    },
    async wikiIndex(projectId) {
      await wait(null);
      return wikiOf(projectId).map((v) => {
        const p = latest(v);
        return { title: p.title, parent: p.parent, version: p.version, created_on: p.created_on, updated_on: p.updated_on };
      });
    },
    async wikiPage(projectId, title, version) {
      await wait(null);
      const versions = findWiki(projectId, title ?? "Wiki");
      if (!versions) throw { code: "not_found", message: "Not found in Redmine." };
      const page = version ? versions[version - 1] : latest(versions);
      if (!page) throw { code: "not_found", message: "Not found in Redmine." };
      if (version && !may(projectId, "view_wiki_edits")) throw forbidden();
      return { ...page, parent: latest(versions).parent, attachments: latest(versions).attachments };
    },
    async saveWikiPage(projectId, title, changes) {
      await wait(null);
      if (!may(projectId, "edit_wiki_pages")) throw forbidden();
      const versions = findWiki(projectId, title);
      const now = new Date().toISOString();
      if (!versions) {
        const page: WikiPage = {
          title,
          parent: changes.parent_title ? { title: changes.parent_title } : null,
          text: changes.text,
          version: 1,
          author: people[0]!,
          comments: changes.comments ?? "",
          created_on: now,
          updated_on: now,
          attachments: [],
        };
        wikiOf(projectId).push([page]);
        return;
      }
      const current = latest(versions);
      if (changes.version !== undefined && changes.version !== current.version && changes.text !== current.text)
        throw {
          code: "rejected",
          message: "Someone else saved this page while you were editing it. Copy your text, reload the page and edit it again.",
        };
      let parent = current.parent;
      if (changes.parent_title !== undefined && (changes.parent_title || null) !== (current.parent?.title ?? null)) {
        if (!may(projectId, "rename_wiki_pages")) throw forbidden();
        parent = changes.parent_title ? { title: changes.parent_title } : null;
      }
      for (const v of versions) v.parent = parent;
      if (changes.text === current.text) return;
      versions.push({
        ...current,
        parent,
        text: changes.text,
        version: current.version + 1,
        author: people[0]!,
        comments: changes.comments ?? "",
        updated_on: now,
      });
    },
    async deleteWikiPage(projectId, title, withChildren) {
      await wait(null);
      if (!may(projectId, "delete_wiki_pages")) throw forbidden();
      const list = wikiOf(projectId);
      const gone = new Set([title.toLowerCase()]);
      if (withChildren) {
        for (let grew = true; grew; ) {
          grew = false;
          for (const v of list) {
            const p = latest(v);
            if (p.parent && gone.has(p.parent.title.toLowerCase()) && !gone.has(p.title.toLowerCase())) {
              gone.add(p.title.toLowerCase());
              grew = true;
            }
          }
        }
      }
      wikis.set(
        projectId,
        list
          .filter((v) => !gone.has(v[0]!.title.toLowerCase()))
          .map((v) => (latest(v).parent?.title.toLowerCase() === title.toLowerCase() ? v.map((p) => ({ ...p, parent: null })) : v)),
      );
    },
    async news(projectId, offset) {
      await wait(null);
      const list = news
        .filter((n) => (projectId === null ? newsAccessible(n.project.id) : n.project.id === projectId))
        .map((n) => ({ ...n, comments: undefined, attachments: undefined }));
      if (projectId !== null && !newsAccessible(projectId)) throw { code: "not_found", message: "Not found in Redmine." };
      return { items: list.slice(offset, offset + 100), total: list.length };
    },
    async newsItem(id) {
      await wait(null);
      return structuredClone(newsOf(id));
    },
    async createNews(projectId, changes) {
      await wait(null);
      if (!may(projectId, "manage_news")) throw forbidden();
      if (!changes.title?.trim()) throw { code: "rejected", message: "Title cannot be blank" };
      if (!changes.description?.trim()) throw { code: "rejected", message: "Description cannot be blank" };
      const project = meta.projects.find((p) => p.id === projectId)!;
      news = [
        {
          id: nextNews++,
          project: { id: project.id, name: project.name },
          author: people[0]!,
          title: changes.title.trim(),
          summary: changes.summary?.trim() ?? "",
          description: changes.description,
          created_on: new Date().toISOString(),
          comments: [],
          attachments: [],
        },
        ...news,
      ];
    },
    async updateNews(id, changes) {
      await wait(null);
      const post = newsOf(id);
      if (!may(post.project.id, "manage_news")) throw forbidden();
      news = news.map((n) => (n.id === id ? { ...n, ...changes } : n));
    },
    async deleteNews(id) {
      await wait(null);
      const post = newsOf(id);
      if (!may(post.project.id, "manage_news")) throw forbidden();
      news = news.filter((n) => n.id !== id);
    },
    async projectFiles(projectId) {
      await wait(null);
      return filesOf(projectId).map((f) => ({ ...f }));
    },
    async addProjectFiles(projectId, paths, versionId, description) {
      await wait(null);
      filesOf(projectId);
      if (!may(projectId, "manage_files")) throw forbidden();
      const version = versionId ? meta.versions.find((v) => v.id === versionId) : undefined;
      for (const path of paths)
        addProjectFile(projectId, path.split(/[\\/]/).pop()!, "", version ? { id: version.id, name: version.name } : null, description, people[0]!, 0);
    },
    async deleteProjectFile(id) {
      await wait(null);
      for (const [projectId, list] of projectFiles) {
        if (!list.some((f) => f.id === id)) continue;
        if (!may(projectId, "manage_files")) throw forbidden();
        projectFiles.set(projectId, list.filter((f) => f.id !== id));
        files.set(-100 - projectId, (files.get(-100 - projectId) ?? []).filter((f) => f.attachment.id !== id));
        return;
      }
      throw { code: "not_found", message: "Not found in Redmine." };
    },
    async timeEntries(query) {
      await wait(null);
      const projects = query.project_id ? subProjectsOf(query.project_id) : null;
      return timeEntries
        .filter((e) => !projects || projects.has(e.project.id))
        .filter((e) => !query.issue_id || e.issue?.id === query.issue_id)
        .filter((e) => !query.user_id || e.user.id === query.user_id)
        .filter((e) => (!query.from || e.spent_on >= query.from) && (!query.to || e.spent_on <= query.to))
        .sort((a, b) => b.spent_on.localeCompare(a.spent_on) || b.id - a.id);
    },
    async logTime(entry) {
      await wait(null);
      const issue = entry.issue_id ? issues.get(entry.issue_id) : undefined;
      const project = issue?.project ?? meta.projects.find((p) => p.id === entry.project_id);
      if (!project) throw { code: "validation", message: "Issue is invalid" };
      if (!may(project.id, "log_time")) throw { code: "forbidden", message: "You don't have permission to do that in Redmine." };
      if (!entry.hours || entry.hours <= 0) throw { code: "validation", message: "Hours is invalid" };
      const activity = entry.activity_id ?? 9;
      const created: TimeEntry = {
        id: nextTimeEntry++,
        project: { id: project.id, name: project.name },
        issue: issue ? { id: issue.id } : null,
        user: people[0]!,
        activity: { id: activity, name: activityName(activity) },
        hours: entry.hours,
        comments: entry.comments ?? "",
        spent_on: entry.spent_on ?? day(0),
        created_on: new Date().toISOString(),
      };
      timeEntries.push(created);
      if (issue) {
        setSpent(issue.id);
        changeHandlers.forEach((h) => h({ changed: [issue.id], removed: [] }));
      }
      return created;
    },
    async updateTimeEntry(id, changes) {
      await wait(null);
      const i = timeEntries.findIndex((e) => e.id === id);
      if (i < 0) throw { code: "not_found", message: "Not found in Redmine." };
      const entry = timeEntries[i]!;
      const own = entry.user.id === people[0]!.id;
      if (!may(entry.project.id, "edit_time_entries") && !(own && may(entry.project.id, "edit_own_time_entries"))) {
        throw { code: "forbidden", message: "You don't have permission to do that in Redmine." };
      }
      const next: TimeEntry = {
        ...entry,
        hours: changes.hours ?? entry.hours,
        spent_on: changes.spent_on ?? entry.spent_on,
        comments: changes.comments ?? entry.comments,
        activity: changes.activity_id ? { id: changes.activity_id, name: activityName(changes.activity_id) } : entry.activity,
      };
      timeEntries[i] = next;
      if (entry.issue) {
        setSpent(entry.issue.id);
        changeHandlers.forEach((h) => h({ changed: [entry.issue!.id], removed: [] }));
      }
      return next;
    },
    async createVersion(projectId, changes) {
      await wait(null);
      manageable(projectId);
      if (!changes.name?.trim()) throw { code: "validation", message: "Name cannot be blank" };
      const project = meta.projects.find((p) => p.id === projectId)!;
      const version: Version = {
        id: nextVersion++,
        project: { id: project.id, name: project.name },
        name: changes.name.trim(),
        description: changes.description ?? "",
        status: changes.status ?? "open",
        due_date: changes.due_date || null,
        sharing: changes.sharing ?? "none",
        wiki_page_title: changes.wiki_page_title || null,
      };
      setVersions([...meta.versions, version]);
      return version;
    },
    async updateVersion(id, changes) {
      await wait(null);
      const version = meta.versions.find((v) => v.id === id);
      if (!version) throw { code: "not_found", message: "Not found" };
      manageable(version.project.id);
      if (changes.name !== undefined && !changes.name.trim()) throw { code: "validation", message: "Name cannot be blank" };
      const next: Version = {
        ...version,
        ...changes,
        due_date: changes.due_date === undefined ? version.due_date : changes.due_date || null,
        wiki_page_title: changes.wiki_page_title === undefined ? version.wiki_page_title : changes.wiki_page_title || null,
      };
      setVersions(meta.versions.map((v) => (v.id === id ? next : v)));
      return next;
    },
    async getVersion(id) {
      await wait(null);
      const version = meta.versions.find((v) => v.id === id);
      if (!version) throw { code: "not_found", message: "That version is gone from Redmine." };
      const mine = [...issues.values()].filter((i) => i.fixed_version?.id === id);
      const estimated = mine.reduce((sum, i) => sum + (i.estimated_hours ?? 0), 0);
      const spent = timeEntries
        .filter((e) => e.issue && mine.some((i) => i.id === e.issue!.id))
        .reduce((sum, e) => sum + e.hours, 0);
      return { ...version, estimated_hours: estimated, spent_hours: spent };
    },
    async deleteVersion(id) {
      await wait(null);
      const version = meta.versions.find((v) => v.id === id);
      if (!version) return;
      manageable(version.project.id);
      if ([...issues.values()].some((i) => i.fixed_version?.id === id)) {
        throw { code: "validation", message: "This version is used by issues and can't be deleted" };
      }
      setVersions(meta.versions.filter((v) => v.id !== id));
    },
    async deleteTimeEntry(id) {
      await wait(null);
      const i = timeEntries.findIndex((e) => e.id === id);
      if (i < 0) return;
      const entry = timeEntries[i]!;
      const own = entry.user.id === people[0]!.id;
      if (!may(entry.project.id, "edit_time_entries") && !(own && may(entry.project.id, "edit_own_time_entries"))) {
        throw { code: "forbidden", message: "You don't have permission to do that in Redmine." };
      }
      timeEntries.splice(i, 1);
      if (entry.issue) {
        setSpent(entry.issue.id);
        changeHandlers.forEach((h) => h({ changed: [entry.issue!.id], removed: [] }));
      }
    },
    async onFileDrop() {
      return () => {};
    },
    async runQuery(queryId) {
      await wait(null);
      const open = [...issues.values()].filter((i) => !i.status.is_closed);
      const ids =
        queryId === 1
          ? open
              .filter((i) => i.project.id === 1 && i.tracker.id === 1)
              .sort((a, b) => b.priority.id - a.priority.id || a.id - b.id)
          : queryId === 2
            ? open
                .filter((i) => i.assigned_to?.id === people[0]!.id)
                .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") || a.id - b.id)
            : null;
      if (!ids) throw { code: "not_found", message: "Not found in Redmine." };
      return { items: ids.map((i) => i.id), total: ids.length };
    },
    async search(text, offset, scope) {
      await wait(null);
      const words = text.toLowerCase().split(/\s+/).filter(Boolean);
      const hit = (t: string) => words.every((w) => t.toLowerCase().includes(w));
      const wants = (kind: SearchKind) => !scope?.kinds?.length || scope.kinds.includes(kind);
      const inScope = (projectId: number) => scope?.projectId === undefined || scope.projectId === projectId;
      const found = [
        ...[...issues.values()]
          .filter((i) => wants("issues") && inScope(i.project.id))
          .filter((i) => hit(`${i.subject} ${i.description ?? ""}`))
          .sort((a, b) => b.updated_on.localeCompare(a.updated_on))
          .map((i) => ({
            id: i.id,
            title: `${i.tracker.name} #${i.id} (${i.status.name}): ${i.subject}`,
            type: i.status.is_closed ? "issue-closed" : "issue",
            url: `https://redmine.example.com/issues/${i.id}`,
            description: i.description ?? "",
            datetime: i.updated_on,
          })),
        ...DEMO_PAGES.filter((p) => wants(p.kind) && inScope(1) && hit(`${p.title} ${p.description ?? ""}`)).map(
          ({ kind: _kind, ...p }) => ({ ...p, description: p.description ?? "" }),
        ),
      ];
      return { items: found.slice(offset, offset + 25), total: found.length };
    },
    async findMentions(id) {
      await wait(null);
      return [...issues.values()]
        .filter((i) => i.id !== id)
        .filter((i) =>
          [i.description ?? "", ...buildJournals(i).map((j) => j.notes ?? "")].some((t) => mentionedIds(t).includes(id)),
        )
        .map((i) => i.id);
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
    async onMetadataChanged(handler) {
      metaHandlers.add(handler);
      return () => metaHandlers.delete(handler);
    },
    async onMenu() {
      return () => {};
    },
  };
}
