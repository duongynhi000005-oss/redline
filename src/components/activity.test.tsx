import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, vi } from "vitest";
import { App } from "../App";
import { createDemoBackend } from "../lib/demoBackend";
import { useApp } from "../state/app";
import { plainExcerpt } from "./ActivityView";
import { shortRevision } from "./IssueDetail";

// The demo's dates sit around Monday, Nov 9 2026.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 10, 9, 15));
});
afterEach(() => vi.useRealTimers());

async function openActivity() {
  const user = userEvent.setup();
  const backend = createDemoBackend({ signedIn: true });
  render(<App backend={backend} />);
  const nav = await screen.findByRole("navigation", { name: "Main" });
  // Teams are listed by name: Mobile, then Web.
  await user.click(within(nav).getAllByRole("button", { name: "Activity" })[1]!);
  const view = await screen.findByRole("region", { name: "Web activity" });
  await within(view).findByRole("region", { name: "Today" });
  return { user, backend, view };
}

describe("team activity", () => {
  it("shows what happened in a team and its sub-teams, by day, and opens each thing", async () => {
    const { user, view } = await openActivity();
    expect(useApp.getState().route).toEqual({ view: "activity", projectId: 1 });
    const days = within(view)
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent);
    expect(days.slice(0, 2)).toEqual(["Today", "Yesterday"]);

    const yesterday = within(view).getByRole("region", { name: "Yesterday" });
    expect(within(yesterday).getByRole("button", { name: "Dana Developer posted Redline 0.1 is out" })).toBeInTheDocument();
    expect(within(yesterday).getByRole("button", { name: "Dana Developer edited the page Wiki" })).toBeInTheDocument();
    const change = within(yesterday).getByRole("button", { name: /Sam Teammate updated #30/ });
    expect(change).toHaveTextContent("changed status from New to In Progress");

    await user.click(within(yesterday).getByRole("button", { name: "Dana Developer posted Redline 0.1 is out" }));
    expect(useApp.getState().route).toEqual({ view: "news", projectId: 1, newsId: 3 });

    await user.click(screen.getAllByRole("button", { name: "Activity" })[1]!);
    const again = await screen.findByRole("region", { name: "Web activity" });
    const today = await within(again).findByRole("region", { name: "Today" });
    await user.click(within(today).getByRole("button", { name: /commented on #2 Sync stops/ }));
    expect(useApp.getState().openIssueId).toBe(2);
  });

  it("filters by kind and by who did it", async () => {
    const { user, view } = await openActivity();
    const kinds = within(view).getByRole("group", { name: "Show" });
    expect(within(kinds).getAllByRole("button").map((b) => b.textContent)).toEqual(["Issues", "Time", "Wiki", "News", "Files"]);

    await user.click(within(kinds).getByRole("button", { name: "Issues" }));
    expect(within(kinds).getByRole("button", { name: "Issues" })).toHaveAttribute("aria-pressed", "false");
    expect(within(view).queryByRole("button", { name: /commented on #2 Sync stops/ })).not.toBeInTheDocument();
    expect(within(view).getByRole("button", { name: "Dana Developer posted Redline 0.1 is out" })).toBeInTheDocument();

    await user.click(within(view).getByRole("button", { name: "Only mine" }));
    expect(within(view).queryByRole("button", { name: /^Sam Teammate/ })).not.toBeInTheDocument();
    expect(within(view).getByRole("button", { name: /^Dana Developer logged 1h 30m on #1/ })).toBeInTheDocument();
  });

  it("reads earlier days on request", async () => {
    const { user, view } = await openActivity();
    expect(within(view).queryByRole("region", { name: /Oct 20/ })).not.toBeInTheDocument();
    await user.click(await within(view).findByRole("button", { name: "Show earlier" }));
    await waitFor(() => expect(within(view).getAllByRole("heading", { level: 2 }).length).toBeGreaterThan(14));
  });

  it("is under every team's overview and in the command palette", async () => {
    const user = userEvent.setup();
    render(<App backend={createDemoBackend({ signedIn: true })} />);
    await screen.findByRole("navigation", { name: "Main" });
    useApp.getState().navigate({ view: "overview", projectId: 3 });
    const areas = await screen.findByRole("region", { name: "Areas" });
    await user.click(within(areas).getByRole("button", { name: "Activity" }));
    expect(useApp.getState().route).toEqual({ view: "activity", projectId: 3 });
    expect(await screen.findByRole("region", { name: "Design activity" })).toBeInTheDocument();
  });
});

describe("commits", () => {
  it("lists an issue's commits and opens one in Redmine", async () => {
    const user = userEvent.setup();
    const backend = createDemoBackend({ signedIn: true });
    const opened: string[] = [];
    backend.openInRedmine = async (path) => void opened.push(path);
    render(<App backend={backend} />);
    await screen.findByRole("navigation", { name: "Main" });
    useApp.getState().openIssue(2);
    const commits = await screen.findByRole("region", { name: "Commits" });
    const rows = within(commits).getAllByRole("button");
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("4f1c2a9eResume syncing after sleep, refs #2Dana Developer"),
      expect.stringContaining("9b0d7e1fLog the wake-up eventSam Teammate"),
    ]);
    await user.click(rows[0]!);
    expect(opened).toEqual(["projects/web/repository/revisions/4f1c2a9e7d3b8a6c5f0e1d2c3b4a59687f6e5d4c"]);

    // Issues without commits have no section.
    useApp.getState().openIssue(3);
    await screen.findByRole("region", { name: "Issue 3" });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Commits" })).not.toBeInTheDocument());
  });

  it("writes revisions the way each system does", () => {
    expect(shortRevision("4f1c2a9e7d3b8a6c")).toBe("4f1c2a9e");
    expect(shortRevision("1234")).toBe("r1234");
  });
});

describe("excerpts", () => {
  it("drops Markdown and shortens long text", () => {
    expect(plainExcerpt("## Why\n\n- [See this](https://x.test) and **that** `code`")).toBe("Why See this and that code");
    expect(plainExcerpt("a ".repeat(200), 20)).toHaveLength(20);
  });
});
