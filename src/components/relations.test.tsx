import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../App";
import { createDemoBackend } from "../lib/demoBackend";
import { useApp } from "../state/app";

// The demo data: #3 blocks #2, #1 relates to #13, #11 and #12 are
// sub-issues of #1, and #1's description mentions #2.
async function openIssue(id: number) {
  const user = userEvent.setup();
  render(<App backend={createDemoBackend({ signedIn: true })} />);
  await screen.findByRole("navigation", { name: "Main" });
  act(() => useApp.getState().openIssue(id));
  await screen.findByRole("region", { name: `Issue ${id}` });
  return { user };
}

const section = (name: string) => screen.getByRole("region", { name });

describe("related issues", () => {
  it("shows sub-issues, relations and mentions", async () => {
    await openIssue(1);
    expect(within(section("Sub-issues")).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      expect.stringContaining("#11"),
      expect.stringContaining("#12"),
    ]);
    const related = section("Related issues");
    expect(within(related).getByRole("heading", { name: "Related to" })).toBeInTheDocument();
    expect(within(related).getByRole("button", { name: /^#13/ })).toBeInTheDocument();
    expect(within(related).getByRole("heading", { name: "Mentions" })).toBeInTheDocument();
    expect(within(related).getByRole("button", { name: /^#2(?!\d)/ })).toBeInTheDocument();
  });

  it("shows what blocks an issue and where it's mentioned", async () => {
    await openIssue(2);
    expect(screen.getByText(/Blocked by #3/)).toBeInTheDocument();
    const related = section("Related issues");
    expect(within(related).getByRole("heading", { name: "Blocked by" })).toBeInTheDocument();
    expect(await within(related).findByRole("heading", { name: "Mentioned in" })).toBeInTheDocument();
    expect(within(related).getByRole("button", { name: /^#1(?!\d)/ })).toBeInTheDocument();
  });

  it("adds a relation from the picker", async () => {
    const { user } = await openIssue(2);
    await user.click(screen.getByRole("button", { name: "Add relation" }));
    await user.click(await screen.findByRole("option", { name: /Mark as related to/ }));
    await user.keyboard("#5");
    await user.click(await screen.findByRole("option", { name: /^#5(?!\d)/ }));
    await waitFor(() =>
      expect(within(section("Related issues")).getByRole("button", { name: /^#5(?!\d)/ })).toBeInTheDocument(),
    );
    expect(useApp.getState().issues.get(5)!.relations?.some((r) => r.issue_id === 2 || r.issue_to_id === 2)).toBe(true);
  });

  it("removes a relation, which unblocks the issue", async () => {
    const { user } = await openIssue(2);
    await user.click(screen.getByRole("button", { name: "Remove relation to #3" }));
    await waitFor(() => expect(screen.queryByText(/Blocked by #3/)).not.toBeInTheDocument());
    expect(useApp.getState().issues.get(3)!.relations).toEqual([]);
  });

  it("adds a sub-issue by number", async () => {
    const { user } = await openIssue(1);
    await user.click(screen.getByRole("button", { name: "Add sub-issue" }));
    await user.keyboard("20");
    await user.click(await screen.findByRole("option", { name: /^#20(?!\d)/ }));
    await waitFor(() => expect(useApp.getState().issues.get(20)!.parent?.id).toBe(1));
    expect(within(section("Sub-issues")).getByRole("button", { name: /^#20(?!\d)/ })).toBeInTheDocument();
  });

  it("marks blocked issues in the list", async () => {
    await openIssue(2);
    act(() => useApp.getState().openIssue(null));
    act(() => useApp.getState().navigate({ view: "team", teamId: 1, tab: "all" }));
    expect(await screen.findByRole("img", { name: "Blocked by #3" })).toBeInTheDocument();
  });
});
