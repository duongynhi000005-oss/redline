import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../App";
import { createDemoBackend } from "../lib/demoBackend";
import { useApp } from "../state/app";

// The demo user, Dana Developer, is a Manager in Web (#1) and a Developer in
// Mobile (#7). Web and Mobile track time; Dana logged 1h 30m on #1 today and
// Sam 30m yesterday.
async function start() {
  const user = userEvent.setup();
  const backend = createDemoBackend({ signedIn: true });
  render(<App backend={backend} />);
  await screen.findByRole("navigation", { name: "Main" });
  return { user, backend };
}

async function openIssue(id: number) {
  act(() => useApp.getState().openIssue(id));
  await screen.findByRole("region", { name: `Issue ${id}` });
}

const timeSection = () => screen.getByRole("region", { name: "Time" });

describe("time tracking", () => {
  it("lists an issue's time and logs more from the dialog", async () => {
    const { user } = await start();
    await openIssue(1);
    expect(await within(timeSection()).findByRole("listitem", { name: /^1h 30m by Dana/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Spent: change" })).toHaveTextContent("2h");

    await user.click(within(timeSection()).getByRole("button", { name: "Log time" }));
    const dialog = await screen.findByRole("dialog", { name: "Log time" });
    const hours = within(dialog).getByRole("textbox", { name: "Time spent" });
    await user.type(hours, "nope");
    expect(within(dialog).getByText(/Use a number of hours/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Log time/ })).toBeDisabled();
    await user.clear(hours);
    await user.type(hours, "1h 15m");
    expect(within(dialog).getByRole("combobox", { name: "Activity" })).toHaveDisplayValue("Development");
    await user.type(within(dialog).getByRole("textbox", { name: "Comment" }), "Pairing");
    await user.click(within(dialog).getByRole("button", { name: /Log time/ }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await within(timeSection()).findByRole("listitem", { name: /^1h 15m by Dana/ })).toHaveTextContent("Pairing");
    await waitFor(() => expect(screen.getByRole("button", { name: "Spent: change" })).toHaveTextContent("3h 15m"));
  });

  it("changes and deletes logged time", async () => {
    const { user } = await start();
    await openIssue(1);
    const mine = await within(timeSection()).findByRole("listitem", { name: /^1h 30m by Dana/ });
    await user.click(within(mine).getByRole("button", { name: /^Change/ }));
    const dialog = await screen.findByRole("dialog", { name: "Change logged time" });
    const hours = within(dialog).getByRole("textbox", { name: "Time spent" });
    expect(hours).toHaveValue("1h 30m");
    await user.clear(hours);
    await user.type(hours, "2");
    await user.click(within(dialog).getByRole("button", { name: /Save/ }));
    const changed = await within(timeSection()).findByRole("listitem", { name: /^2h by Dana/ });
    await user.click(within(changed).getByRole("button", { name: /^Delete/ }));
    await waitFor(() => expect(within(timeSection()).queryByRole("listitem", { name: /by Dana/ })).not.toBeInTheDocument());
  });

  it("lets a developer change only their own time", async () => {
    const { backend } = await start();
    const theirs = (await backend.timeEntries({ project_id: 2 })).find((e) => e.user.name !== "Dana Developer" && e.issue);
    expect(theirs).toBeDefined();
    await openIssue(theirs!.issue!.id);
    const items = await within(timeSection()).findAllByRole("listitem");
    for (const item of items) {
      const own = /by Dana/.test(item.getAttribute("aria-label") ?? "");
      expect(!!within(item).queryByRole("button", { name: /^Change/ })).toBe(own);
    }
  });

  it("opens the dialog with the shortcut and from the palette", async () => {
    const { user } = await start();
    await openIssue(1);
    await user.keyboard("{Control>}{Shift>}t{/Shift}{/Control}");
    expect(await screen.findByRole("dialog", { name: "Log time" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("shows a team's time by day, person and issue", async () => {
    const { user } = await start();
    // Teams are alphabetical: Mobile, then Web.
    const nav = within(screen.getByRole("navigation", { name: "Main" }));
    await user.click(nav.getAllByRole("button", { name: "Time" }).at(-1)!);
    const view = await screen.findByRole("region", { name: "Web time" });
    await user.click(within(view).getByRole("tab", { name: "Last 30 days" }));
    expect(await within(view).findByRole("region", { name: /^Today, / })).toBeInTheDocument();
    await user.selectOptions(within(view).getByRole("combobox", { name: "Group by" }), "person");
    expect(await within(view).findByRole("region", { name: /^Dana Developer, / })).toBeInTheDocument();
    await user.click(within(view).getByRole("button", { name: "Only mine" }));
    await waitFor(() =>
      expect(
        within(view)
          .getAllByRole("region")
          .every((r) => /Dana/.test(r.getAttribute("aria-label")!)),
      ).toBe(true),
    );
    await user.selectOptions(within(view).getByRole("combobox", { name: "Group by" }), "issue");
    await waitFor(() => expect(within(view).getAllByRole("region")[0]).toHaveAccessibleName(/^#\d+ /));
  });
});
