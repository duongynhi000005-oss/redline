import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../App";
import { createDemoBackend } from "../lib/demoBackend";
import { filesAccess, newsAccess } from "../lib/permissions";
import { useApp } from "../state/app";
import { fileGroups } from "./FilesView";

// In the demo, Web (where Dana is a Manager) has news and files; Mobile
// (where she's a Developer) has news she can read but not post.
async function start() {
  const user = userEvent.setup();
  const backend = createDemoBackend({ signedIn: true });
  render(<App backend={backend} />);
  const nav = await screen.findByRole("navigation", { name: "Main" });
  return { user, backend, nav };
}

describe("news", () => {
  it("lists every team's news under Updates, and opens a post with its comments", async () => {
    const { user, nav } = await start();
    await user.click(within(nav).getByRole("button", { name: "Updates" }));
    const view = await screen.findByRole("region", { name: "Updates" });
    const list = await within(view).findByRole("list", { name: "Updates" });
    const titles = [...list.querySelectorAll(".news-item-title")].map((t) => t.textContent);
    expect(titles).toEqual(["Redline 0.1 is out", "Mobile beta starts Monday", "Board view ships in Sprint 2"]);
    expect(list).toHaveTextContent("Riley Chen in Mobile");

    await user.click(within(list).getByRole("button", { name: /Board view ships/ }));
    expect(useApp.getState().route).toEqual({ view: "news", projectId: null, newsId: 1 });
    const post = await within(view).findByRole("article", { name: "Board view ships in Sprint 2" });
    expect(post).toHaveTextContent("Sam Teammate posted this in Web");
    const comments = within(post).getByRole("region", { name: "Comments" });
    expect(comments).toHaveTextContent("Can it group by label too?");
    expect(comments).toHaveTextContent("Yes, by any label field.");
    expect(within(comments).getByRole("button", { name: "Comment in Redmine" })).toBeInTheDocument();

    // Back to the list from the breadcrumb.
    await user.click(within(view).getByRole("button", { name: "Updates" }));
    expect(useApp.getState().route).toEqual({ view: "news", projectId: null, newsId: null });
  });

  it("shows only a team's own news in its News item", async () => {
    const { user, nav } = await start();
    // Teams are in name order: Mobile, then Web.
    const items = within(nav).getAllByRole("button", { name: "News" });
    expect(items).toHaveLength(2);
    await user.click(items[1]!);
    const view = await screen.findByRole("region", { name: "Web news" });
    const list = await within(view).findByRole("list", { name: "Web news" });
    expect(within(list).getAllByRole("button")).toHaveLength(2);
    expect(list).not.toHaveTextContent("Mobile");
  });

  it("posts news, refusing a post without text, then edits and deletes it", async () => {
    const { user, backend } = await start();
    act(() => useApp.getState().navigate({ view: "news", projectId: 1, newsId: null }));
    const view = await screen.findByRole("region", { name: "Web news" });
    await within(view).findByRole("list", { name: "Web news" });
    await user.click(within(view).getByRole("button", { name: "New post" }));
    const form = within(view).getByRole("form", { name: "New post" });
    await user.type(within(form).getByRole("textbox", { name: "Title" }), "Sprint 3 planning");
    expect(within(form).getByRole("button", { name: /^Post/ })).toBeDisabled();
    await user.type(within(form).getByRole("textbox", { name: "Summary" }), "Thursday at 10");
    await user.type(within(form).getByRole("textbox", { name: "Text" }), "Bring **ideas**.");
    await user.click(within(form).getByRole("tab", { name: "Preview" }));
    expect(within(form).getByText("ideas").tagName).toBe("STRONG");
    await user.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() => expect(useApp.getState().toast).toBe("Posted"));
    const list = await within(view).findByRole("list", { name: "Web news" });
    await waitFor(() => expect(list.querySelector(".news-item-title")).toHaveTextContent("Sprint 3 planning"));
    const created = (await backend.news(1, 0)).items[0]!;
    expect(created).toMatchObject({ title: "Sprint 3 planning", summary: "Thursday at 10", description: "Bring **ideas**." });

    await user.click(within(list).getByRole("button", { name: /Sprint 3 planning/ }));
    await within(view).findByRole("article", { name: "Sprint 3 planning" });
    await user.keyboard("e");
    const edit = within(view).getByRole("form", { name: "Edit Sprint 3 planning" });
    const title = within(edit).getByRole("textbox", { name: "Title" });
    await user.clear(title);
    await user.type(title, "Sprint 3 planning moved");
    await user.click(within(edit).getByRole("button", { name: /^Save/ }));
    await within(view).findByRole("article", { name: "Sprint 3 planning moved" });

    await user.click(within(view).getByRole("button", { name: "Post actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete post…" }));
    const dialog = screen.getByRole("alertdialog", { name: "Delete “Sprint 3 planning moved”?" });
    await user.click(within(dialog).getByRole("button", { name: "Delete post" }));
    await waitFor(() => expect(useApp.getState().route).toEqual({ view: "news", projectId: 1, newsId: null }));
    expect((await backend.news(1, 0)).items.map((n) => n.title)).not.toContain("Sprint 3 planning moved");
  });

  it("offers posting and editing only where the role allows them", async () => {
    const { user, backend } = await start();
    const meta = await backend.getMetadata();
    expect(newsAccess(meta, 1)).toEqual({ view: true, manage: true });
    expect(newsAccess(meta, 2)).toEqual({ view: true, manage: false });
    expect(newsAccess(meta, 3)).toEqual({ view: false, manage: false });

    act(() => useApp.getState().navigate({ view: "news", projectId: 2, newsId: 2 }));
    const view = await screen.findByRole("region", { name: "Mobile news" });
    await within(view).findByRole("article", { name: "Mobile beta starts Monday" });
    expect(within(view).queryByRole("button", { name: /Edit/ })).not.toBeInTheDocument();
    expect(within(view).queryByRole("button", { name: "Post actions" })).not.toBeInTheDocument();
    await user.click(within(view).getByRole("button", { name: "News" }));
    await within(view).findByRole("list", { name: "Mobile news" });
    expect(within(view).queryByRole("button", { name: "New post" })).not.toBeInTheDocument();
  });

  it("opens news search results in Redline", async () => {
    const { user } = await start();
    useApp.getState().navigate({ view: "search", text: "board view ships" });
    const results = await screen.findByRole("list", { name: "Results for board view ships" });
    await user.click(within(results).getByRole("button", { name: /News/ }));
    expect(useApp.getState().route).toEqual({ view: "news", projectId: null, newsId: 1 });
    await screen.findByRole("article", { name: "Board view ships in Sprint 2" });
  });
});

describe("files", () => {
  it("groups files as Redmine does: the team's own first, then each version's", () => {
    const f = (id: number, filename: string, version: { id: number; name: string } | null) => ({ id, filename, filesize: 1, downloads: 0, version });
    const versions = [
      { id: 1, name: "Sprint 1" },
      { id: 2, name: "Sprint 2" },
    ] as never[];
    const groups = fileGroups([f(1, "b.txt", { id: 2, name: "Sprint 2" }), f(2, "z.txt", null), f(3, "a.txt", { id: 2, name: "Sprint 2" }), f(4, "c.txt", { id: 1, name: "Sprint 1" })], versions);
    expect(groups.map((g) => [g.name, g.files.map((x) => x.filename)])).toEqual([
      ["", ["z.txt"]],
      ["Sprint 1", ["c.txt"]],
      ["Sprint 2", ["a.txt", "b.txt"]],
    ]);
  });

  it("lists a team's files by version, uploads more and deletes one", async () => {
    const { user, nav, backend } = await start();
    await user.click(within(nav).getByRole("button", { name: "Files" }));
    const view = await screen.findByRole("region", { name: "Web files" });
    const all = await within(view).findByRole("region", { name: "Web" });
    expect(all).toHaveTextContent("All of Web");
    expect(all).toHaveTextContent("brand-colors.txt");
    expect(all).toHaveTextContent("Colors for the web app");
    expect(within(view).getByRole("region", { name: "Sprint 1" })).toHaveTextContent("board-mockup.svg");
    expect(within(view).getByRole("region", { name: "Sprint 2" })).toHaveTextContent("release-notes.txt");

    await user.click(within(view).getByRole("button", { name: "Add files" }));
    const dialog = await screen.findByRole("dialog", { name: "Add screenshot.png" });
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Version" }), "Sprint 2");
    await user.type(within(dialog).getByRole("textbox", { name: "Description" }), "The new board");
    await user.click(within(dialog).getByRole("button", { name: "Upload" }));
    await waitFor(() => expect(useApp.getState().toast).toBe("Added 1 file"));
    const sprint2 = await within(view).findByRole("region", { name: "Sprint 2" });
    await waitFor(() => expect(sprint2).toHaveTextContent("screenshot.png"));
    expect(sprint2).toHaveTextContent("The new board");

    await user.click(within(view).getByRole("button", { name: "Delete brand-colors.txt" }));
    const confirm = screen.getByRole("alertdialog", { name: "Delete brand-colors.txt?" });
    await user.click(within(confirm).getByRole("button", { name: "Delete file" }));
    await waitFor(() => expect(useApp.getState().toast).toBe("Deleted brand-colors.txt"));
    expect((await backend.projectFiles(1)).map((x) => x.filename)).not.toContain("brand-colors.txt");
  });

  it("shows Files only where the module is on, and upload only to those who manage files", async () => {
    const { backend } = await start();
    const meta = await backend.getMetadata();
    expect(filesAccess(meta, 1)).toEqual({ view: true, manage: true });
    expect(filesAccess(meta, 2)).toEqual({ view: false, manage: false });
    meta.projects.find((p) => p.id === 1)!.status = 5;
    expect(filesAccess(meta, 1)).toEqual({ view: true, manage: false });
  });
});
