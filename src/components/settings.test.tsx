import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../App";
import { createDemoBackend } from "../lib/demoBackend";
import { loadSettings } from "../lib/settings";
import { useApp } from "../state/app";

async function start() {
  const user = userEvent.setup();
  render(<App backend={createDemoBackend({ signedIn: true })} />);
  await screen.findByRole("heading", { name: "My issues" });
  useApp.getState().navigate({ view: "team", teamId: 1, tab: "all" });
  await screen.findByRole("heading", { name: "Web" });
  return user;
}

describe("settings", () => {
  it("regroups a status and remembers it for this server", async () => {
    const user = await start();
    const list = () => screen.getByRole("listbox", { name: "Issues", hidden: true });
    const resolvedRow = () => within(list()).getByText("Dark mode follows the system setting").closest("[role=option]")!;
    // Issue 4 is Resolved, which starts out as In progress.
    expect(resolvedRow().querySelector("[aria-label=Resolved]")).toBeInTheDocument();

    useApp.getState().setSettingsOpen(true);
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    await user.selectOptions(within(dialog).getByLabelText("Group for Resolved"), "Done");

    expect(loadSettings("https://redmine.example.com/", 1).statusCategories).toEqual({ 3: "completed" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Settings" })).not.toBeInTheDocument());
    const doneHeader = within(list()).getByText("Done").closest("button")!;
    expect(doneHeader).toHaveTextContent(/Done\s*\d+/);
  });

  it("chooses which custom fields show as labels", async () => {
    const user = await start();
    expect(screen.getAllByText("Performance").length).toBeGreaterThan(0);
    useApp.getState().setSettingsOpen(true);
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    await user.click(within(dialog).getByRole("checkbox", { name: /Area/ }));
    await user.click(within(dialog).getByRole("checkbox", { name: /Size/ }));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryAllByText("Performance")).toHaveLength(0));
    expect(loadSettings("https://redmine.example.com/", 1).labelFields).toEqual([2]);
  });
});
