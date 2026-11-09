import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../App";
import { createDemoBackend } from "../lib/demoBackend";
import { useApp } from "../state/app";
import { suggestIdentifier, validIdentifier } from "./TeamDialogs";
import { areasOf, membersByRole } from "./TeamOverview";

// In the demo, Web has a sub-team, Design, and four members: Dana manages
// it, the others are developers. Riley hides their email.
async function start() {
  const user = userEvent.setup();
  const backend = createDemoBackend({ signedIn: true });
  render(<App backend={backend} />);
  const nav = await screen.findByRole("navigation", { name: "Main" });
  return { user, backend, nav };
}

async function openOverview(projectId: number) {
  act(() => useApp.getState().navigate({ view: "overview", projectId }));
  const name = useApp.getState().meta!.projects.find((p) => p.id === projectId)!.name;
  return screen.findByRole("region", { name: `${name} overview` });
}

describe("team overview", () => {
  it("opens from the sidebar", async () => {
    const { user, nav } = await start();
    const first = within(nav).getAllByRole("button", { name: "Overview" })[0]!;
    await user.click(first);
    expect(await screen.findByRole("region", { name: /overview$/ })).toBeInTheDocument();
    expect(first).toHaveAttribute("aria-current", "page");
  });

  it("shows what the team is, its sub-teams, members by role and issue counts", async () => {
    const { user } = await start();
    const page = await openOverview(1);
    expect(within(page).getByRole("heading", { name: "Web" })).toBeInTheDocument();
    expect(within(page).getByText("Redline", { selector: "strong" })).toBeInTheDocument();

    const subTeams = within(page).getByRole("region", { name: "Sub-teams" });
    expect(within(subTeams).getByRole("button", { name: /Design/ })).toBeInTheDocument();

    const members = within(page).getByRole("region", { name: "Members" });
    const groups = within(members)
      .getAllByRole("heading", { level: 3 })
      .map((h) => h.textContent);
    expect(groups).toEqual(["Manager", "Developer"]);
    expect(within(members).getAllByRole("button", { name: /^About / })).toHaveLength(4);

    const props = within(page).getByRole("complementary", { name: "Properties" });
    expect(props).toHaveTextContent("Public");
    expect(props).toHaveTextContent("web");
    const { issues, meta } = useApp.getState();
    const closed = new Set(meta!.statuses.filter((s) => s.is_closed).map((s) => s.id));
    const open = [...issues.values()].filter((i) => [1, 3].includes(i.project.id) && !closed.has(i.status.id)).length;
    await user.click(within(props).getByRole("button", { name: "Show issues" }));
    expect(useApp.getState().route).toEqual({ view: "team", teamId: 1, tab: "all" });
    expect(open).toBeGreaterThan(0);
  });

  it("counts open issues across sub-teams", async () => {
    await start();
    const page = await openOverview(1);
    const { issues, meta } = useApp.getState();
    const closed = new Set(meta!.statuses.filter((s) => s.is_closed).map((s) => s.id));
    const open = [...issues.values()].filter((i) => [1, 3].includes(i.project.id) && !closed.has(i.status.id)).length;
    const props = within(page).getByRole("complementary", { name: "Properties" });
    expect(props).toHaveTextContent(`${open} issues`);
  });

  it("opens Redmine areas that Redline has no view for in the browser", async () => {
    const { user, backend } = await start();
    const opened: string[] = [];
    backend.openInRedmine = async (path) => void opened.push(path);
    const page = await openOverview(1);
    const areas = within(page).getByRole("region", { name: "Areas" });
    await user.click(within(areas).getByRole("button", { name: "Forums" }));
    expect(opened).toEqual(["projects/web/boards"]);
    await user.click(within(areas).getByRole("button", { name: "Wiki" }));
    expect(useApp.getState().route).toEqual({ view: "wiki", projectId: 1, title: null });
    const again = within(await openOverview(1)).getByRole("region", { name: "Areas" });
    await user.click(within(again).getByRole("button", { name: "Time" }));
    expect(useApp.getState().route).toEqual({ view: "time", teamId: 1 });
  });

  it("opens the homepage through the backend", async () => {
    const { user, backend } = await start();
    const asked: number[] = [];
    backend.openHomepage = async (id) => void asked.push(id);
    const page = await openOverview(1);
    await user.click(within(page).getByRole("button", { name: "Open homepage" }));
    expect(asked).toEqual([1]);
  });

  it("shows a sub-team under its parent", async () => {
    const { user } = await start();
    const page = await openOverview(3);
    expect(within(page).getByRole("heading", { name: "Design" })).toBeInTheDocument();
    expect(within(page).getByRole("complementary", { name: "Properties" })).toHaveTextContent("Private");
    await user.click(within(page).getByRole("button", { name: "Web" }));
    expect(useApp.getState().route).toEqual({ view: "overview", projectId: 1 });
  });
});

describe("person cards", () => {
  it("shows who someone is and the teams you share", async () => {
    const { user } = await start();
    const page = await openOverview(1);
    const button = within(page).getByRole("button", { name: "About Sam Teammate" });
    await user.click(button);
    const card = await screen.findByRole("dialog", { name: "Sam Teammate" });
    await waitFor(() => expect(card).toHaveTextContent("sam@example.com"));
    expect(card).toHaveTextContent("@sam");
    const teams = within(card).getByRole("list", { name: "Teams" });
    expect(within(teams).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["MobileDeveloper", "WebDeveloper"]);
    expect(card).toHaveTextContent(/\d+ open issues? assigned/);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(button).toHaveFocus();
    // Escape closed only the card.
    expect(screen.getByRole("region", { name: "Web overview" })).toBeInTheDocument();
  });

  it("leaves out an email the person hides", async () => {
    const { user } = await start();
    const page = await openOverview(1);
    await user.click(within(page).getByRole("button", { name: "About Riley Chen" }));
    const card = await screen.findByRole("dialog", { name: "Riley Chen" });
    await waitFor(() => expect(card).toHaveTextContent("Joined"));
    expect(card).not.toHaveTextContent("Email");
  });

  it("says when Redmine won't show someone", async () => {
    const { user, backend } = await start();
    backend.getUser = async () => {
      throw { code: "not_found", message: "Redmine doesn't show you this person." };
    };
    const page = await openOverview(1);
    await user.click(within(page).getByRole("button", { name: "About Jordan Patel" }));
    const card = await screen.findByRole("dialog", { name: "Jordan Patel" });
    await waitFor(() => expect(card).toHaveTextContent("Redmine doesn't show you this person."));
  });

  it("opens from an avatar on an issue", async () => {
    const { user } = await start();
    act(() => useApp.getState().openIssue(1));
    const region = await screen.findByRole("region", { name: "Issue 1" });
    const author = useApp.getState().issues.get(1)!.author!;
    const avatar = within(region).getAllByRole("button", { name: `About ${author.name}` })[0]!;
    await user.click(avatar);
    expect(await screen.findByRole("dialog", { name: author.name })).toBeInTheDocument();
    await user.click(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("areas and roles", () => {
  it("maps modules to Redline views and Redmine pages", async () => {
    const meta = await createDemoBackend({ signedIn: true }).getMetadata();
    const web = { ...meta.projects.find((p) => p.id === 1)!, enabled_modules: [
      { id: 1, name: "issue_tracking" },
      { id: 2, name: "calendar" },
      { id: 3, name: "repository" },
      { id: 4, name: "contacts" },
    ] };
    const areas = areasOf(web, meta);
    expect(areas.map((a) => a.label)).toEqual(["Issues", "Cycles", "Calendar", "Repository", "Contacts"]);
    expect(areas[2]!).toMatchObject({ layout: "calendar", route: { view: "team", teamId: 1, tab: "all" } });
    expect(areas[3]!.path).toBe("projects/web/repository");
    expect(areas[4]!.path).toBe("projects/web");
  });

  it("lists someone with two roles under both", async () => {
    const meta = await createDemoBackend({ signedIn: true }).getMetadata();
    const groups = membersByRole(
      [
        { id: 1, project: { id: 1, name: "Web" }, user: { id: 2, name: "Sam" }, roles: [{ id: 3, name: "Manager" }, { id: 4, name: "Developer" }] },
        { id: 2, project: { id: 1, name: "Web" }, group: { id: 9, name: "QA" }, roles: [{ id: 4, name: "Developer" }] },
      ],
      meta,
    );
    expect(groups.map((g) => [g.role, g.members.map((m) => m.user?.name ?? m.group?.name)])).toEqual([
      ["Manager", ["Sam"]],
      ["Developer", ["QA", "Sam"]],
    ]);
  });
});

describe("team actions", () => {
  it("creates a sub-team with an identifier under its parent's and opens it", async () => {
    const { user } = await start();
    const page = await openOverview(1);
    await user.click(within(page).getByRole("button", { name: "Team actions" }));
    await user.click(screen.getByRole("menuitem", { name: "New sub-team…" }));
    const dialog = await screen.findByRole("dialog", { name: "New sub-team in Web" });
    await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "Docs Site");
    expect(within(dialog).getByRole("textbox", { name: "Identifier" })).toHaveValue("web-docs-site");
    await user.click(within(dialog).getByRole("button", { name: /Create sub-team/ }));
    const made = await screen.findByRole("region", { name: "Docs Site overview" });
    const project = useApp.getState().meta!.projects.find((p) => p.identifier === "web-docs-site")!;
    expect(project.parent?.id).toBe(1);
    expect(useApp.getState().route).toEqual({ view: "overview", projectId: project.id });
    // It took Web's members.
    expect(within(within(made).getByRole("region", { name: "Members" })).getAllByRole("button", { name: /^About / })).toHaveLength(4);
  });

  it("won't take an identifier Redmine would refuse", async () => {
    const { user } = await start();
    const page = await openOverview(1);
    await user.click(within(page).getByRole("button", { name: "Team actions" }));
    await user.click(screen.getByRole("menuitem", { name: "New sub-team…" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "QA");
    const id = within(dialog).getByRole("textbox", { name: "Identifier" });
    await user.clear(id);
    await user.type(id, "9lives");
    expect(within(dialog).getByRole("alert")).toHaveTextContent("lowercase letter");
    expect(within(dialog).getByRole("button", { name: /Create sub-team/ })).toBeDisabled();
  });

  it("edits a team's details, sending only what changed", async () => {
    const { user, backend } = await start();
    const sent: unknown[] = [];
    const update = backend.updateProject.bind(backend);
    backend.updateProject = async (id, changes) => {
      sent.push(changes);
      return update(id, changes);
    };
    const page = await openOverview(1);
    await user.click(within(page).getByRole("button", { name: "Team actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Edit team…" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Web" });
    const name = within(dialog).getByRole("textbox", { name: "Name" });
    await user.clear(name);
    await user.type(name, "Web app");
    await user.click(within(dialog).getByRole("button", { name: /Save/ }));
    expect(await screen.findByRole("heading", { name: "Web app" })).toBeInTheDocument();
    expect(sent).toEqual([{ name: "Web app" }]);
  });

  it("closes and reopens a team with its sub-teams", async () => {
    const { user } = await start();
    const page = await openOverview(1);
    await user.click(within(page).getByRole("button", { name: "Team actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Close team" }));
    const props = within(page).getByRole("complementary", { name: "Properties" });
    await waitFor(() => expect(props).toHaveTextContent("StatusClosed"));
    expect(useApp.getState().meta!.projects.find((p) => p.id === 3)?.status).toBe(5);
    // A closed team can only be reopened or deleted.
    await user.click(within(page).getByRole("button", { name: "Team actions" }));
    expect(screen.queryByRole("menuitem", { name: "Edit team…" })).toBeNull();
    await user.click(screen.getByRole("menuitem", { name: "Reopen team" }));
    await waitFor(() => expect(useApp.getState().meta!.projects.find((p) => p.id === 1)?.status).toBe(1));
  });

  it("deletes a team and its sub-teams only once its identifier is typed", async () => {
    const { user } = await start();
    const page = await openOverview(1);
    await user.click(within(page).getByRole("button", { name: "Team actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete team…" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Delete Web?" });
    expect(dialog).toHaveTextContent(/with its sub-team, \d+ issues and its wiki, files and logged time/);
    const button = within(dialog).getByRole("button", { name: "Delete team" });
    const box = within(dialog).getByRole("textbox", { name: "Identifier to confirm" });
    await user.type(box, "Web");
    expect(button).toBeDisabled();
    await user.clear(box);
    await user.type(box, "web");
    await user.click(button);
    await waitFor(() => expect(useApp.getState().meta!.projects.map((p) => p.id)).toEqual([2]));
    expect(useApp.getState().route).toEqual({ view: "my-issues", tab: "assigned" });
    expect([...useApp.getState().issues.values()].every((i) => i.project.id === 2)).toBe(true);
  });

  it("offers only what the role allows", async () => {
    const { user } = await start();
    // Dana is a Developer in Mobile.
    const page = await openOverview(2);
    expect(within(page).queryByRole("button", { name: "Team actions" })).toBeNull();
    await user.click(within(page).getByRole("button", { name: "Open in Redmine" }));
  });
});

describe("identifiers", () => {
  it("suggests one from the name, under the parent's", () => {
    expect(suggestIdentifier("Docs Site", "web")).toBe("web-docs-site");
    expect(suggestIdentifier("Café & Crème")).toBe("cafe-creme");
    expect(suggestIdentifier("2027 plan")).toBe("team-2027-plan");
    expect(suggestIdentifier("!!!")).toBe("");
  });

  it("follows Redmine's rule", () => {
    expect(validIdentifier("web-design_2")).toBe(true);
    expect(validIdentifier("Web")).toBe(false);
    expect(validIdentifier("9lives")).toBe(false);
    expect(validIdentifier("new")).toBe(false);
    expect(validIdentifier("a".repeat(101))).toBe(false);
  });
});
