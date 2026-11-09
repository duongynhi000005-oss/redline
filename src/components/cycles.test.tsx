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

    await user.click(screen.getByRole("button", { name: /Sprint 2/ }));
    expect(await screen.findByRole("heading", { name: "Sprint 2" })).toBeInTheDocument();
    expect(screen.getByRole("listbox", { name: "Issues" })).toBeInTheDocument();
    // The Cycles item stays selected while inside a cycle.
    expect(within(nav).getByRole("button", { name: "Cycles" })).toHaveAttribute("aria-current", "page");
  });
});
