import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../App";
import { createDemoBackend } from "../lib/demoBackend";

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
    expect(count()).toBeGreaterThan(0);
    expect(count()).toBeLessThan(before);
    expect(within(bar).getByText(`${count()} of ${before}`)).toBeInTheDocument();

    await user.click(within(bar).getByRole("button", { name: "Remove Status filter" }));
    expect(screen.queryByLabelText("Filters")).not.toBeInTheDocument();
    expect(count()).toBe(before);
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
});
