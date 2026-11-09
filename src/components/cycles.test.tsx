import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../App";
import { createDemoBackend } from "../lib/demoBackend";
import { derive, teamCycles } from "../state/derived";

describe("cycles", () => {
  it("summarises each version's progress and marks the current one", async () => {
    const backend = createDemoBackend({ signedIn: true });
    const meta = await backend.getMetadata();
    const cycles = teamCycles(1, await backend.listIssues(), derive(meta), meta, new Date("2026-11-09T12:00:00Z"));
    expect(cycles.map((c) => [c.version.name, c.current])).toEqual([
      ["Sprint 1", false],
      ["Sprint 2", true],
      ["Sprint 3", false],
    ]);
    const sprint2 = cycles[1]!;
    expect(sprint2.total).toBeGreaterThan(0);
    expect(sprint2.done).toBeLessThanOrEqual(sprint2.total);
  });

  it("opens a cycle's issues from the team's Cycles page", async () => {
    const user = userEvent.setup();
    render(<App backend={createDemoBackend({ signedIn: true })} />);
    const nav = await screen.findByRole("navigation", { name: "Main" });
    await user.click(within(nav).getByRole("button", { name: "Cycles" }));
    expect(await screen.findByRole("heading", { name: "Web cycles" })).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Sprint 2 progress" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Past cycles" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Sprint 2/ }));
    expect(await screen.findByRole("heading", { name: "Sprint 2" })).toBeInTheDocument();
    expect(screen.getByRole("listbox", { name: "Issues" })).toBeInTheDocument();
    // The Cycles item stays selected while inside a cycle.
    expect(within(nav).getByRole("button", { name: "Cycles" })).toHaveAttribute("aria-current", "page");
  });
});

describe("cycle editing", () => {
  async function openCycles() {
    const user = userEvent.setup();
    const backend = createDemoBackend({ signedIn: true });
    render(<App backend={backend} />);
    const nav = await screen.findByRole("navigation", { name: "Main" });
    await user.click(within(nav).getByRole("button", { name: "Cycles" }));
    await screen.findByRole("heading", { name: "Web cycles" });
    return { user, backend };
  }

  it("creates a cycle and opens it", async () => {
    const { user, backend } = await openCycles();
    await user.click(screen.getByRole("button", { name: "New cycle" }));
    const dialog = await screen.findByRole("dialog", { name: "New cycle" });
    await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "Sprint 4");
    await user.type(within(dialog).getByRole("textbox", { name: "Description" }), "Polish before the release");
    await user.click(within(dialog).getByRole("button", { name: /Create cycle/ }));

    expect(await screen.findByRole("heading", { name: "Sprint 4" })).toBeInTheDocument();
    const about = screen.getByRole("region", { name: "About this cycle" });
    expect(within(about).getByText("Polish before the release")).toBeInTheDocument();
    expect(within(about).getByText("Open")).toBeInTheDocument();
    const meta = await backend.getMetadata();
    expect(meta.versions.find((v) => v.name === "Sprint 4")?.project.id).toBe(1);
  });

  it("closes a cycle from its page and moves it to past cycles", async () => {
    const { user } = await openCycles();
    await user.click(screen.getByRole("button", { name: /^Sprint 3/ }));
    const about = await screen.findByRole("region", { name: "About this cycle" });
    await user.click(within(about).getByRole("button", { name: "Close cycle" }));
    expect(await within(about).findByRole("button", { name: "Reopen" })).toBeInTheDocument();
    expect(within(about).getByText("Closed")).toBeInTheDocument();
  });

  it("shows the time spent on a cycle's issues", async () => {
    const { user } = await openCycles();
    await user.click(screen.getByRole("button", { name: /^Sprint 2/ }));
    const about = await screen.findByRole("region", { name: "About this cycle" });
    expect(await within(about).findByText(/spent/)).toBeInTheDocument();
  });

  it("won't delete a cycle that issues still use", async () => {
    const { user } = await openCycles();
    await user.click(screen.getByRole("button", { name: "Edit Sprint 2" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Sprint 2" });
    await user.click(within(dialog).getByRole("button", { name: "Delete…" }));
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    // Redmine refuses while issues use the version, so the dialog stays with the reason.
    expect(await screen.findByText(/issues/i, { selector: ".toast" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Edit Sprint 2" })).toBeInTheDocument();
  });
});
