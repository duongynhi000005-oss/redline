import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../App";
import { createDemoBackend } from "../lib/demoBackend";
import { useApp } from "../state/app";
import { redminePath, searchKind } from "./SearchView";

async function start() {
  const user = userEvent.setup();
  const backend = createDemoBackend({ signedIn: true });
  render(<App backend={backend} />);
  const nav = await screen.findByRole("navigation", { name: "Main" });
  return { user, backend, nav };
}

describe("saved queries", () => {
  it("lists Redmine's views in the sidebar and runs one in its own order", async () => {
    const { user, backend, nav } = await start();
    expect(within(nav).getByText("Views")).toBeInTheDocument();
    await user.click(within(nav).getByRole("button", { name: "Open bugs" }));
    expect(await screen.findByRole("heading", { name: "Open bugs" })).toBeInTheDocument();
    const list = await screen.findByRole("listbox", { name: "Issues" });
    const ids = within(list)
      .getAllByRole("option")
      .map((r) => Number(r.id.replace("issue-row-", "")));
    const expected = (await backend.runQuery(1)).items;
    expect(ids).toEqual(expected);
    expect(ids.length).toBeGreaterThan(0);
    expect(within(nav).getByRole("button", { name: "Open bugs" })).toHaveAttribute("aria-current", "page");
  });

  it("says why when Redmine can't run a view", async () => {
    const { user, backend, nav } = await start();
    backend.runQuery = async () => {
      throw { code: "forbidden", message: "You don't have permission to do that in Redmine." };
    };
    await user.click(within(nav).getByRole("button", { name: "Open bugs" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You don't have permission to do that in Redmine.");
  });

  it("says when a view finds more than Redline shows", async () => {
    const { user, backend, nav } = await start();
    const run = backend.runQuery.bind(backend);
    backend.runQuery = async (id, project) => ({ ...(await run(id, project)), total: 812 });
    await user.click(within(nav).getByRole("button", { name: "Open bugs" }));
    expect(await screen.findByText(/Showing the first \d+ of 812 issues/)).toBeInTheDocument();
  });

  it("offers the view's own order only on views", async () => {
    const { user, nav } = await start();
    await user.click(within(nav).getByRole("button", { name: "Open bugs" }));
    await user.click(await screen.findByRole("button", { name: /Display/ }));
    const ordering = screen.getByRole("combobox", { name: "Ordering" });
    expect(ordering).toHaveValue("query");
    await user.keyboard("{Escape}");
    await user.click(within(nav).getByRole("button", { name: "My issues" }));
    await user.click(await screen.findByRole("button", { name: /Display/ }));
    expect(within(screen.getByRole("combobox", { name: "Ordering" })).queryByText("As the view sorts")).toBeNull();
  });
});

describe("Redmine search", () => {
  it("searches everything from the command menu and opens an issue in Redline", async () => {
    const { user } = await start();
    await user.keyboard("{Control>}k{/Control}");
    await user.type(await screen.findByPlaceholderText("Type a command or search issues…"), "board");
    await user.click(screen.getByText("Search Redmine for “board”"));
    const results = await screen.findByRole("list", { name: "Results for board" });
    const items = within(results).getAllByRole("button");
    expect(items.length).toBeGreaterThan(1);
    expect(within(results).getByText("News")).toBeInTheDocument();
    const issueButton = items.find((b) => b.textContent?.startsWith("Issue"))!;
    await user.click(issueButton);
    await waitFor(() => expect(useApp.getState().openIssueId).not.toBeNull());
  });

  it("opens wiki pages, news and documents in the browser", async () => {
    const { user, backend } = await start();
    const opened: string[] = [];
    backend.openInRedmine = async (path) => void opened.push(path);
    useApp.getState().navigate({ view: "search", text: "board view" });
    const results = await screen.findByRole("list", { name: "Results for board view" });
    await user.click(within(results).getByRole("button", { name: /Document/ }));
    expect(opened).toEqual(["documents/3"]);
  });

  it("searches again from its own box, and says when nothing matches", async () => {
    const { user } = await start();
    useApp.getState().navigate({ view: "search", text: "board" });
    const box = await screen.findByRole("textbox", { name: "Search Redmine" });
    await user.clear(box);
    await user.type(box, "zebra crossing{Enter}");
    expect(await screen.findByText("Nothing in Redmine matches “zebra crossing”.")).toBeInTheDocument();
  });

  it("pages through long results", async () => {
    const { user, backend } = await start();
    const search = backend.search.bind(backend);
    let calls = 0;
    backend.search = async (text, offset) => {
      calls++;
      const items = Array.from({ length: offset === 0 ? 25 : 5 }, (_, i) => ({
        id: offset + i + 1,
        title: `Wiki: Page ${offset + i + 1}`,
        type: "wiki-page",
        url: `https://redmine.example.com/projects/web/wiki/Page_${offset + i + 1}`,
      }));
      return text === "page" ? { items, total: 30 } : search(text, offset);
    };
    useApp.getState().navigate({ view: "search", text: "page" });
    const results = await screen.findByRole("list", { name: "Results for page" });
    expect(within(results).getAllByRole("button")).toHaveLength(25);
    await user.click(screen.getByRole("button", { name: "Show more (5 left)" }));
    await waitFor(() => expect(within(results).getAllByRole("button")).toHaveLength(30));
    expect(calls).toBe(2);
    expect(screen.queryByRole("button", { name: /Show more/ })).toBeNull();
  });

  it("keeps only the path of a result's link", () => {
    expect(redminePath("http://localhost:3000/projects/web/wiki/Release", "https://redmine.example.com/")).toBe(
      "projects/web/wiki/Release",
    );
    expect(redminePath("https://pm.example.com/redmine/boards/1/topics/5?r=7#message-7", "https://pm.example.com/redmine/")).toBe(
      "boards/1/topics/5?r=7#message-7",
    );
    expect(redminePath(null, "https://pm.example.com/")).toBeNull();
    expect(searchKind("wiki-page")).toBe("Wiki");
    expect(searchKind("changeset")).toBe("Commit");
    expect(searchKind("something-new")).toBe("Something new");
  });
});
