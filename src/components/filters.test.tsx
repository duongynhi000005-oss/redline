import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../App";
import { createDemoBackend } from "../lib/demoBackend";
import { loadViews } from "../lib/views";

describe("filtering a list", () => {
  it("narrows a team's issues with F and shows the filter as a chip", async () => {
    const user = userEvent.setup();
    const { container } = render(<App backend={createDemoBackend({ signedIn: true })} />);
    const nav = await screen.findByRole("navigation", { name: "Main" });
    await user.click(within(nav).getAllByRole("button", { name: "Issues" })[1]!);
    await user.click(await screen.findByRole("tab", { name: "All issues" }));
    const count = () => Number(container.querySelector(".main-header .count")?.textContent);
    const before = count();
    expect(before).toBeGreaterThan(1);

    await user.keyboard("f");
    const menu = await screen.findByRole("dialog", { name: "Filter" });
    await user.click(within(menu).getByRole("option", { name: /Status/ }));
    await user.click(
      await within(screen.getByRole("dialog", { name: "Filter" })).findByRole("option", { name: /Done/ }),
    );
    await user.keyboard("{Escape}");

    const bar = screen.getByLabelText("Filters");
    expect(within(bar).getByRole("button", { name: /Status is Done/ })).toBeInTheDocument();
    // Redmine filters the list, the way its own issue list does.
    await waitFor(() => expect(count()).toBeLessThan(before));
    expect(count()).toBeGreaterThan(0);
    expect(within(bar).getByText(String(count()))).toBeInTheDocument();

    await user.click(within(bar).getByRole("button", { name: "Remove Status filter" }));
    expect(screen.queryByLabelText("Filters")).not.toBeInTheDocument();
    await waitFor(() => expect(count()).toBe(before));
  });

  it("offers Filter in the command menu", async () => {
    const user = userEvent.setup();
    render(<App backend={createDemoBackend({ signedIn: true })} />);
    await screen.findByRole("navigation", { name: "Main" });
    await user.keyboard("{Control>}k{/Control}");
    if (!screen.queryByPlaceholderText("Type a command or search issues…")) await user.keyboard("{Meta>}k{/Meta}");
    await user.type(screen.getByPlaceholderText("Type a command or search issues…"), "filter");
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("dialog", { name: "Filter" })).toBeInTheDocument();
  });

  it("works from the keyboard alone, with Backspace back to the fields", async () => {
    const user = userEvent.setup();
    render(<App backend={createDemoBackend({ signedIn: true })} />);
    await screen.findByRole("heading", { name: "My issues" });
    await user.keyboard("f");
    await user.keyboard("status{Enter}");
    expect(await screen.findByPlaceholderText("Status is…")).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(within(screen.getByLabelText("Filters")).getByRole("button", { name: /^Status is/, hidden: true })).toBeInTheDocument();
    await user.keyboard("{Backspace}");
    expect(await screen.findByPlaceholderText("Filter by…")).toHaveFocus();
  });

  it("groups and orders from the Display menu and remembers it for this server", async () => {
    const user = userEvent.setup();
    render(<App backend={createDemoBackend({ signedIn: true })} />);
    await screen.findByRole("heading", { name: "My issues" });

    await user.click(screen.getByRole("button", { name: "Display" }));
    const panel = screen.getByRole("dialog", { name: "Display options" });
    expect(within(panel).getByLabelText("Grouping")).toHaveFocus();
    await user.selectOptions(within(panel).getByLabelText("Grouping"), "priority");
    await user.selectOptions(within(panel).getByLabelText("Ordering"), "created");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Display options" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Display" })).toHaveFocus();

    const list = screen.getByRole("listbox", { name: "Issues" });
    expect(within(list).queryByText("In progress")).not.toBeInTheDocument();
    const headings = [...list.querySelectorAll(".group-header")].map((h) => h.textContent);
    expect(headings.length).toBeGreaterThan(0);
    expect(headings.some((h) => /High|Normal|Urgent|Low/.test(h ?? ""))).toBe(true);
    expect(loadViews("https://redmine.example.com/", 1)["my-issues"]).toMatchObject({
      grouping: "priority",
      ordering: "created",
    });
  });
});
