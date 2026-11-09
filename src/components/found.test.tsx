import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../App";
import { createDemoBackend } from "../lib/demoBackend";
import { encodePart, redminePathOf } from "../lib/redmineLinks";
import type { Metadata } from "../lib/types";
import { useApp } from "../state/app";
import { foundTitle } from "./FoundView";

async function start() {
  const user = userEvent.setup();
  const backend = createDemoBackend({ signedIn: true });
  const opened: string[] = [];
  backend.openInRedmine = async (path) => void opened.push(path);
  render(<App backend={backend} />);
  await screen.findByRole("navigation", { name: "Main" });
  return { user, backend, opened };
}

describe("documents and forums", () => {
  it("finds a team's documents and opens them in Redmine", async () => {
    const { user, backend, opened } = await start();
    const search = vi.spyOn(backend, "search");
    useApp.getState().navigate({ view: "overview", projectId: 1 });
    const areas = await screen.findByRole("region", { name: "Areas" });
    await user.click(within(areas).getByRole("button", { name: "Documents" }));
    expect(useApp.getState().route).toEqual({ view: "documents", projectId: 1 });

    const view = await screen.findByRole("region", { name: "Web documents" });
    const box = within(view).getByRole("textbox", { name: "Find documents in Web" });
    expect(box).toHaveFocus();
    await user.click(within(view).getByRole("button", { name: "Browse in Redmine" }));
    expect(opened).toEqual(["projects/web/documents"]);
    // One letter is too short for Redmine.
    await user.type(box, "b");
    await new Promise((r) => setTimeout(r, 400));
    expect(search).not.toHaveBeenCalled();

    await user.type(box, "oard");
    const list = await within(view).findByRole("list", { name: "Documents matching board" });
    const rows = within(list).getAllByRole("button");
    expect(rows.map((r) => r.getAttribute("aria-label"))).toEqual(["Board view spec", "Keyboard shortcuts"]);
    // Only Web's documents: no issues, news or wiki pages.
    expect(search).toHaveBeenLastCalledWith("board", 0, { projectId: 1, kinds: ["documents"] });
    expect(rows[1]).toHaveTextContent("Every shortcut on the board and in lists");
    await user.click(rows[0]!);
    expect(opened).toEqual(["projects/web/documents", "documents/3"]);

    await user.clear(box);
    await user.type(box, "zebra");
    expect(await within(view).findByText("No documents in Web match “zebra”.")).toBeInTheDocument();
  });

  it("finds forum posts and their replies", async () => {
    const { user, opened } = await start();
    useApp.getState().navigate({ view: "forums", projectId: 1 });
    const view = await screen.findByRole("region", { name: "Web forums" });
    await user.type(within(view).getByRole("textbox", { name: "Find forum posts in Web" }), "slow{Enter}");
    const list = await within(view).findByRole("list", { name: "Forums matching slow" });
    const rows = within(list).getAllByRole("button");
    expect(rows.map((r) => r.getAttribute("aria-label"))).toEqual([
      "Reply in Syncing on a slow connection, in General",
      "Syncing on a slow connection, in General",
    ]);
    await user.click(rows[0]!);
    expect(opened).toEqual(["boards/1/topics/1?r=2#message-2"]);
  });

  it("is offered only where the module is on", async () => {
    const { user } = await start();
    const d = useApp.getState().meta!;
    expect(d.projects.find((p) => p.id === 2)!.enabled_modules.some((m) => m.name === "documents")).toBe(false);
    useApp.getState().navigate({ view: "overview", projectId: 2 });
    const areas = await screen.findByRole("region", { name: "Areas" });
    expect(within(areas).queryByRole("button", { name: "Documents" })).not.toBeInTheDocument();

    await user.keyboard("{Control>}k{/Control}");
    const palette = await screen.findByPlaceholderText("Type a command or search issues…");
    await user.type(palette, "web documents");
    expect(await screen.findByRole("option", { name: /Go to Web documents/ })).toBeInTheDocument();
    await user.clear(palette);
    await user.type(palette, "mobile documents");
    await waitFor(() => expect(screen.queryByRole("option", { name: /Go to Mobile documents/ })).not.toBeInTheDocument());
  });

  it("reads titles without Redmine's labels", () => {
    expect(foundTitle({ id: 1, type: "document", title: "Document: Spec: v2" })).toEqual({ title: "Spec: v2", forum: null, reply: false });
    expect(foundTitle({ id: 2, type: "reply", title: "General: RE: Sync" })).toEqual({ title: "Sync", forum: "General", reply: true });
    expect(foundTitle({ id: 3, type: "message", title: "Ideas: Dark mode" })).toEqual({ title: "Dark mode", forum: "Ideas", reply: false });
  });
});

describe("open in Redmine", () => {
  it("opens every view's page in Redmine with Mod+Shift+O and from the palette", async () => {
    const { user, opened } = await start();
    useApp.getState().navigate({ view: "cycles", teamId: 1 });
    await screen.findByRole("region", { name: "Web cycles" });
    await user.keyboard("{Control>}{Shift>}o{/Shift}{/Control}");
    expect(opened).toEqual(["projects/web/roadmap"]);

    await user.click(screen.getByRole("button", { name: "Open in Redmine" }));
    expect(opened).toEqual(["projects/web/roadmap", "projects/web/roadmap"]);

    // While typing too.
    useApp.getState().navigate({ view: "documents", projectId: 1 });
    const box = await screen.findByRole("textbox", { name: "Find documents in Web" });
    await user.type(box, "x{Control>}{Shift>}o{/Shift}{/Control}");
    expect(opened.at(-1)).toBe("projects/web/documents");

    useApp.getState().navigate({ view: "time", teamId: 1 });
    await screen.findByRole("region", { name: "Web time" });
    await user.keyboard("{Control>}k{/Control}");
    await user.type(await screen.findByPlaceholderText("Type a command or search issues…"), "open in redmine{Enter}");
    expect(opened.at(-1)).toBe("projects/web/time_entries");
  });

  it("knows the Redmine page for each view", () => {
    const meta = {
      projects: [
        { id: 1, identifier: "web" },
        { id: 3, identifier: "web-design" },
      ],
      queries: [
        { id: 1, name: "Open bugs", is_public: true, project_id: 1 },
        { id: 2, name: "Mine", is_public: false, project_id: null },
      ],
    } as unknown as Metadata;
    const paths = [
      redminePathOf({ view: "inbox" }, meta),
      redminePathOf({ view: "my-issues", tab: "assigned" }, meta),
      redminePathOf({ view: "team", teamId: 1, tab: "active" }, meta),
      redminePathOf({ view: "project", projectId: 3 }, meta),
      redminePathOf({ view: "overview", projectId: 3 }, meta),
      redminePathOf({ view: "cycle", teamId: 1, versionId: 4 }, meta),
      redminePathOf({ view: "wiki", projectId: 1, title: "Release_checklist" }, meta),
      redminePathOf({ view: "wiki", projectId: 1, title: null }, meta),
      redminePathOf({ view: "news", projectId: null, newsId: null }, meta),
      redminePathOf({ view: "news", projectId: 1, newsId: 7 }, meta),
      redminePathOf({ view: "files", projectId: 1 }, meta),
      redminePathOf({ view: "activity", projectId: 3 }, meta),
      redminePathOf({ view: "forums", projectId: 1 }, meta),
      redminePathOf({ view: "query", queryId: 1 }, meta),
      redminePathOf({ view: "query", queryId: 2 }, meta),
      redminePathOf({ view: "search", text: "board view's (new)" }, meta),
      redminePathOf({ view: "activity", projectId: 9 }, meta),
    ];
    expect(paths).toEqual([
      "my/page",
      "issues?set_filter=1&assigned_to_id=me&status_id=o",
      "projects/web/issues",
      "projects/web-design/issues",
      "projects/web-design",
      "versions/4",
      "projects/web/wiki/Release_checklist",
      "projects/web/wiki",
      "news",
      "news/7",
      "projects/web/files",
      "projects/web-design/activity",
      "projects/web/boards",
      "projects/web/issues?query_id=1",
      "issues?query_id=2",
      "search?q=board%20view%27s%20%28new%29",
      null,
    ]);
    // Only characters the desktop app lets through to the browser.
    expect(encodePart("a!'()*~ é")).toMatch(/^[A-Za-z0-9%._-]+$/);
  });
});
