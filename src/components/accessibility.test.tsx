import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../App";
import { createDemoBackend } from "../lib/demoBackend";
import { useApp } from "../state/app";

async function start() {
  const user = userEvent.setup();
  render(<App backend={createDemoBackend({ signedIn: true })} />);
  await screen.findByRole("heading", { name: "My issues" });
  return user;
}

describe("accessibility", () => {
  it("reads each issue row as one sentence", async () => {
    await start();
    const list = screen.getByRole("listbox", { name: "Issues" });
    const row = within(list).getAllByRole("option")[0]!;
    expect(row).toHaveAccessibleName(/^.+, #\d+, .+, .+ priority, (assigned to .+|unassigned)/);
  });

  it("moves focus to the list when navigating with j, so screen readers follow", async () => {
    const user = await start();
    await user.keyboard("j");
    const list = screen.getByRole("listbox", { name: "Issues" });
    expect(list).toHaveFocus();
    expect(list).toHaveAttribute("aria-activedescendant", screen.getByRole("option", { selected: true }).id);
  });

  it("jumps to the first and last issue with Home and End, and by a page with Page Up and Page Down", async () => {
    const user = await start();
    const list = screen.getByRole("listbox", { name: "Issues" });
    const focused = () => within(list).getByRole("option", { selected: true }).id;
    const ids = within(list).getAllByRole("option").map((o) => o.id);

    await user.keyboard("{End}");
    expect(list).toHaveFocus();
    expect(focused()).toBe(ids[ids.length - 1]);
    await user.keyboard("{Home}");
    expect(focused()).toBe(ids[0]);
    // The test setup makes the list 800px tall: 22 rows of 36px, less one.
    await user.keyboard("{PageDown}");
    expect(focused()).toBe(ids[Math.min(ids.length - 1, 21)]);
    await user.keyboard("{PageUp}");
    expect(focused()).toBe(ids[0]);
  });

  it("keeps focus inside Settings and gives it back on close", async () => {
    const user = await start();
    const search = screen.getByRole("button", { name: /Search/ });
    search.focus();
    useApp.getState().setSettingsOpen(true);
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

    // Tab from the last control wraps to the first.
    within(dialog).getByRole("button", { name: "Sign out" }).focus();
    await user.tab();
    expect(within(dialog).getByRole("button", { name: "Close settings" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(within(dialog).getByRole("button", { name: "Sign out" })).toHaveFocus();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(search).toHaveFocus());
  });

  it("announces messages through a live region that is always present", async () => {
    await start();
    const region = screen.getByRole("status");
    expect(region).toBeEmptyDOMElement();
    useApp.getState().showToast("Couldn't update #4: offline");
    expect(await within(region).findByText("Couldn't update #4: offline")).toBeInTheDocument();
  });
});
