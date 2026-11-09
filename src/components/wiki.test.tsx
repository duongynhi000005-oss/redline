import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../App";
import { createDemoBackend } from "../lib/demoBackend";
import { wikiAccess } from "../lib/permissions";
import { useApp } from "../state/app";
import { wikiTarget } from "./SearchView";

// In the demo, Web's wiki has a start page (three versions) with Getting
// started and Release checklist under it, and Code review under Getting
// started. Dana manages Web, so she can edit, move and delete pages.
async function start() {
  const user = userEvent.setup();
  const backend = createDemoBackend({ signedIn: true });
  render(<App backend={backend} />);
  const nav = await screen.findByRole("navigation", { name: "Main" });
  return { user, backend, nav };
}

async function openWiki(title: string | null = null) {
  act(() => useApp.getState().navigate({ view: "wiki", projectId: 1, title }));
  const view = await screen.findByRole("region", { name: "Web wiki" });
  await within(view).findByRole("tree", { name: "Pages" });
  return view;
}

describe("wiki", () => {
  it("opens the start page from the sidebar, with the page tree and sub-pages", async () => {
    const { user, nav } = await start();
    await user.click(within(nav).getByRole("button", { name: "Wiki" }));
    const view = await screen.findByRole("region", { name: "Web wiki" });
    const page = await within(view).findByRole("article", { name: "Wiki" });
    expect(within(page).getByRole("heading", { name: "This cycle" })).toBeInTheDocument();
    expect(page).toHaveTextContent("Dana Developer edited this");
    expect(page).toHaveTextContent("“Add this cycle”");

    const tree = within(view).getByRole("tree", { name: "Pages" });
    const items = within(tree).getAllByRole("button").map((b) => b.textContent);
    expect(items).toEqual(["Wiki", "Getting started", "Code review", "Release checklist"]);
    expect(within(tree).getByRole("button", { name: "Wiki" })).toHaveAttribute("aria-current", "page");

    const subPages = within(page).getByRole("region", { name: "Sub-pages" });
    const subjects = [...subPages.querySelectorAll(".linked-issue-subject")].map((s) => s.textContent);
    expect(subjects).toEqual(["Getting started", "Release checklist"]);
  });

  it("follows wiki links, and offers to write a page that doesn't exist yet", async () => {
    const { user } = await start();
    const view = await openWiki();
    const page = await within(view).findByRole("article", { name: "Wiki" });
    const missing = within(page).getByRole("link", { name: "Roadmap" });
    expect(missing).toHaveClass("wiki-link-new");

    await user.click(within(page).getByRole("link", { name: "Getting started" }));
    expect(useApp.getState().route).toEqual({ view: "wiki", projectId: 1, title: "Getting_started" });
    const guide = await within(view).findByRole("article", { name: "Getting started" });
    expect(within(guide).getByRole("img", { name: "layout.svg" })).toBeInTheDocument();
    // The breadcrumb and the tree both lead back to the start page.
    expect(within(view).getAllByRole("button", { name: "Wiki" })).toHaveLength(2);

    act(() => useApp.getState().navigate({ view: "wiki", projectId: 1, title: "Roadmap" }));
    expect(await within(view).findByText("There's no page called “Roadmap” yet.")).toBeInTheDocument();
    await user.click(within(view).getByRole("button", { name: "Create it" }));
    const editor = within(view).getByRole("form", { name: "New page" });
    expect(within(editor).getByRole("textbox", { name: "Title" })).toHaveValue("Roadmap");
    await user.type(within(editor).getByRole("textbox", { name: "Text" }), "Offline mode.");
    await user.click(within(editor).getByRole("button", { name: /Create page/ }));
    const made = await within(view).findByRole("article", { name: "Roadmap" });
    expect(made).toHaveTextContent("Offline mode.");
  });

  it("edits a page with a comment, then shows and restores an older version", async () => {
    const { user, backend } = await start();
    const view = await openWiki("Release_checklist");
    await within(view).findByRole("article", { name: "Release checklist" });
    await user.keyboard("e");
    const editor = within(view).getByRole("form", { name: "Edit Release checklist" });
    const text = within(editor).getByRole("textbox", { name: "Text" });
    await user.clear(text);
    await user.type(text, "# Release checklist{Enter}{Enter}Ask [[[[Code review]] first.");
    await user.type(within(editor).getByRole("textbox", { name: "Comment" }), "Shorter");
    await user.click(within(editor).getByRole("tab", { name: "Preview" }));
    expect(within(editor).getByRole("link", { name: "Code review" })).not.toHaveClass("wiki-link-new");
    await user.keyboard("{Control>}{Enter}{/Control}");

    const page = await within(view).findByRole("article", { name: "Release checklist" });
    await waitFor(() => expect(page).toHaveTextContent("Ask Code review first."));
    expect(page).toHaveTextContent("“Shorter”");
    expect((await backend.wikiPage(1, "Release_checklist")).version).toBe(3);

    await user.click(within(view).getByRole("button", { name: "History" }));
    const history = await within(view).findByRole("complementary", { name: "History" });
    const versions = await within(history).findAllByRole("button");
    expect(versions.map((v) => v.textContent?.match(/Version \d/)?.[0])).toEqual(["Version 3", "Version 2", "Version 1"]);
    await user.click(versions[2]!);
    expect(await within(view).findByRole("status")).toHaveTextContent("You're reading version 1 of 3");
    expect(within(view).getByRole("article", { name: "Release checklist" })).toHaveTextContent("Tag");
    await user.click(within(view).getByRole("button", { name: "Restore this version" }));
    await waitFor(async () => expect((await backend.wikiPage(1, "Release_checklist")).version).toBe(4));
    const restored = await backend.wikiPage(1, "Release_checklist");
    expect(restored.comments).toBe("Restored version 1");
    expect(restored.text).toContain("- Tag");
  });

  it("says when someone else saved the page first", async () => {
    const { user, backend } = await start();
    const view = await openWiki("Release_checklist");
    await within(view).findByRole("article", { name: "Release checklist" });
    await user.click(within(view).getByRole("button", { name: /^Edit/ }));
    // Someone else saves while the editor is open.
    await backend.saveWikiPage(1, "Release_checklist", { text: "Theirs", version: 2 });
    const editor = within(view).getByRole("form", { name: "Edit Release checklist" });
    await user.type(within(editor).getByRole("textbox", { name: "Text" }), " and mine");
    await user.click(within(editor).getByRole("button", { name: /^Save/ }));
    expect(await within(editor).findByRole("alert")).toHaveTextContent("Someone else saved this page while you were editing it.");
  });

  it("makes a sub-page, refusing a title that's taken", async () => {
    const { user } = await start();
    const view = await openWiki("Getting_started");
    await within(view).findByRole("article", { name: "Getting started" });
    await user.click(within(view).getByRole("button", { name: "Page actions" }));
    await user.click(screen.getByRole("menuitem", { name: "New sub-page…" }));
    const editor = within(view).getByRole("form", { name: "New page" });
    expect(within(editor).getByRole("combobox", { name: "Parent page" })).toHaveValue("Getting_started");
    const title = within(editor).getByRole("textbox", { name: "Title" });
    await user.type(title, "code review");
    expect(within(editor).getByRole("button", { name: /Create page/ })).toBeDisabled();
    await user.clear(title);
    await user.type(title, "Testing: the basics");
    expect(within(editor).getByText("Saved as Testing_the_basics")).toBeInTheDocument();
    await user.click(within(editor).getByRole("button", { name: /Create page/ }));
    await within(view).findByRole("article", { name: "Testing the basics" });
    expect(useApp.getState().route).toEqual({ view: "wiki", projectId: 1, title: "Testing_the_basics" });
    const crumbs = within(view).getAllByRole("button", { name: "Getting started" });
    expect(crumbs.length).toBeGreaterThan(0);
  });

  it("deletes a page, moving its sub-pages to the top unless asked to delete them too", async () => {
    const { user, backend } = await start();
    const view = await openWiki("Getting_started");
    await within(view).findByRole("article", { name: "Getting started" });
    await user.click(within(view).getByRole("button", { name: "Page actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete page…" }));
    const dialog = screen.getByRole("alertdialog", { name: "Delete Getting started?" });
    expect(dialog).toHaveTextContent("Its sub-page moves up to the top of the wiki.");
    await user.click(within(dialog).getByRole("button", { name: "Delete page" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(useApp.getState().toast).toBe("Deleted Getting started");
    expect(useApp.getState().route).toEqual({ view: "wiki", projectId: 1, title: "Wiki" });
    const index = await backend.wikiIndex(1);
    expect(index.map((p) => p.title)).not.toContain("Getting_started");
    expect(index.find((p) => p.title === "Code_review")?.parent).toBeNull();
  });

  it("offers editing, moving and deleting only where the role allows them", async () => {
    const { backend } = await start();
    const meta = await backend.getMetadata();
    const mobile = meta.projects.find((p) => p.id === 2)!;
    expect(wikiAccess(meta, 2).view).toBe(false);
    mobile.enabled_modules = [...mobile.enabled_modules, { id: 9, name: "wiki" }];
    // Dana is a Developer in Mobile.
    expect(wikiAccess(meta, 2)).toEqual({ view: true, history: true, edit: true, move: false, delete: false });
    expect(wikiAccess(meta, 1)).toEqual({ view: true, history: true, edit: true, move: true, delete: true });
    meta.projects.find((p) => p.id === 1)!.status = 5;
    expect(wikiAccess(meta, 1)).toEqual({ view: true, history: true, edit: false, move: false, delete: false });
  });

  it("opens wiki search results in Redline", async () => {
    const { user } = await start();
    expect(wikiTarget("projects/web/wiki/Release_checklist")).toEqual({ project: "web", title: "Release_checklist" });
    expect(wikiTarget("projects/web/wiki")).toEqual({ project: "web", title: null });
    expect(wikiTarget("projects/web/news")).toBeNull();
    useApp.getState().navigate({ view: "search", text: "release checklist" });
    const results = await screen.findByRole("list", { name: "Results for release checklist" });
    await user.click(within(results).getByRole("button", { name: /Release checklist/ }));
    expect(useApp.getState().route).toEqual({ view: "wiki", projectId: 1, title: "Release_checklist" });
  });
});
