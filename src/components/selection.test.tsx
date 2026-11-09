import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../App";
import { createDemoBackend } from "../lib/demoBackend";
import { clickSelection, rangeOf } from "../lib/selection";
import { useApp } from "../state/app";

// Tests run as Windows or Linux would, so Ctrl is the main modifier.
async function start() {
  const user = userEvent.setup();
  const backend = createDemoBackend({ signedIn: true });
  render(<App backend={backend} />);
  const nav = await screen.findByRole("navigation", { name: "Main" });
  await user.click(within(nav).getAllByRole("button", { name: "Issues" })[1]!);
  await user.click(await screen.findByRole("tab", { name: "All issues" }));
  const list = await screen.findByRole("listbox", { name: "Issues" });
  const rows = () => within(list).getAllByRole("option");
  const idOf = (row: HTMLElement) => Number(row.id.replace("issue-row-", ""));
  return { user, backend, list, rows, idOf };
}

describe("picking several issues", () => {
  it("works out clicks like a file list", () => {
    const order = [1, 2, 3, 4, 5];
    const plain = { shiftKey: false, metaKey: false, ctrlKey: false };
    expect(clickSelection(order, [], null, 3, plain)).toBeNull();
    expect(clickSelection(order, [1], 1, 3, { ...plain, ctrlKey: true })).toEqual([1, 3]);
    expect(clickSelection(order, [1, 3], 3, 3, { ...plain, ctrlKey: true })).toEqual([1]);
    expect(clickSelection(order, [1], 1, 4, { ...plain, shiftKey: true })).toEqual([1, 2, 3, 4]);
    expect(clickSelection(order, [], 5, 3, { ...plain, shiftKey: true })).toEqual([3, 4, 5]);
    expect(rangeOf(order, 4, 99)).toEqual([99]);
  });

  it("picks with Ctrl+click and Shift+click, and lets go with Escape", async () => {
    const { user, rows } = await start();
    await user.keyboard("{Control>}");
    await user.click(rows()[0]!);
    await user.click(rows()[2]!);
    await user.keyboard("{/Control}");
    expect(useApp.getState().openIssueId).toBeNull();
    const bar = screen.getByRole("toolbar", { name: "2 selected issues" });
    expect(bar).toHaveTextContent("2 selected");
    expect(rows()[0]).toHaveAttribute("aria-selected", "true");
    expect(rows()[1]).toHaveAttribute("aria-selected", "false");

    // Shift+click runs from the last issue picked.
    await user.keyboard("{Shift>}");
    await user.click(rows()[4]!);
    await user.keyboard("{/Shift}");
    expect(screen.getByRole("toolbar")).toHaveTextContent("4 selected");

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("toolbar")).toBeNull();
    expect(useApp.getState().selection).toEqual([]);
  });

  it("picks every issue with Ctrl+A and the highlighted one with X", async () => {
    const { user, rows, idOf } = await start();
    await user.keyboard("{Control>}a{/Control}");
    expect(useApp.getState().selection).toHaveLength(rows().length);
    await user.click(screen.getByRole("button", { name: "Clear selection" }));
    await user.keyboard("jx");
    expect(useApp.getState().selection).toEqual([idOf(rows()[0]!)]);
    await user.keyboard("{Shift>}{ArrowDown}{/Shift}");
    expect(useApp.getState().selection).toEqual([idOf(rows()[0]!), idOf(rows()[1]!)]);
  });

  it("lets go of picked issues that leave the list", async () => {
    const { user, rows, idOf } = await start();
    await user.keyboard("{Control>}a{/Control}");
    const all = rows().map(idOf);
    const [gone, ...kept] = all;
    act(() => {
      const issues = new Map(useApp.getState().issues);
      issues.delete(gone!);
      useApp.setState({ issues });
    });
    await waitFor(() => expect(useApp.getState().selection).toEqual(kept));
  });

  it("changes the status of every picked issue at once", async () => {
    const { user, backend, rows, idOf } = await start();
    const issues = useApp.getState().issues;
    const ids = rows()
      .map(idOf)
      .filter((id) => issues.get(id)!.status.name !== "Resolved")
      .slice(0, 2);
    act(() => useApp.getState().setSelection(ids));
    await user.click(screen.getByRole("button", { name: "Status" }));
    expect(screen.getByText("2 issues")).toBeInTheDocument();
    await user.type(await screen.findByPlaceholderText("Change status…"), "resolved");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Changed 2 issues"));
    const changed = await backend.getIssues(ids);
    expect(changed.map((i) => i.status.name)).toEqual(["Resolved", "Resolved"]);
  });

  it("assigns every picked issue to you with I", async () => {
    const { user, backend, rows, idOf } = await start();
    const ids = rows()
      .slice(0, 3)
      .map((r) => idOf(r));
    act(() => useApp.getState().setSelection(ids));
    await user.keyboard("i");
    await waitFor(async () =>
      expect((await backend.getIssues(ids)).every((i) => i.assigned_to?.name === "Dana Developer")).toBe(true),
    );
  });

  it("puts back the issues Redmine refuses and says which", async () => {
    const { user, backend, rows, idOf } = await start();
    const issues = useApp.getState().issues;
    const ids = rows()
      .map(idOf)
      .filter((id) => issues.get(id)!.priority.name !== "Urgent")
      .slice(0, 2);
    const update = backend.updateIssue.bind(backend);
    backend.updateIssue = async (id, changes) => {
      if (id === ids[1]) throw { code: "rejected", message: "Priority is not included in the list" };
      return update(id, changes);
    };
    const before = useApp.getState().issues.get(ids[1]!)!.priority.name;
    act(() => useApp.getState().setSelection(ids));
    await user.keyboard("p");
    await user.type(await screen.findByPlaceholderText("Change priority…"), "urgent");
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        `Changed 1 of 2 issues. Redmine refused #${ids[1]}: Priority is not included in the list`,
      ),
    );
    expect(useApp.getState().issues.get(ids[0]!)!.priority.name).toBe("Urgent");
    expect(useApp.getState().issues.get(ids[1]!)!.priority.name).toBe(before);
  });

  it("says how many already had the change", async () => {
    const { user, rows, idOf } = await start();
    const issues = useApp.getState().issues;
    const urgent = rows().map(idOf).find((id) => issues.get(id)!.priority.name === "Urgent")!;
    const other = rows().map(idOf).find((id) => issues.get(id)!.priority.name !== "Urgent")!;
    act(() => useApp.getState().setSelection([urgent, other]));
    await user.keyboard("p");
    await user.type(await screen.findByPlaceholderText("Change priority…"), "urgent");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Changed 1 issue, and 1 already had that"));
  });

  it("adds a label to every picked issue, then takes it off them all", async () => {
    const { user, backend } = await start();
    const area = (id: number) => {
      const v = useApp.getState().issues.get(id)!.custom_fields.find((f) => f.id === 1)?.value;
      return Array.isArray(v) ? v : [];
    };
    const all = [...useApp.getState().issues.values()];
    const withUi = all.find((i) => area(i.id).includes("UI") && i.project.id === 1)!.id;
    const without = all.find((i) => !area(i.id).includes("UI") && i.project.id === 1)!.id;
    act(() => useApp.getState().setSelection([withUi, without]));
    await user.keyboard("l");
    const input = await screen.findByPlaceholderText("Change labels…");
    await user.type(input, "UI");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(area(without)).toContain("UI"));
    expect(area(withUi)).toContain("UI");
    // Now every picked issue has it, so picking it again takes it off.
    await user.keyboard("{Enter}");
    await waitFor(async () => {
      const [a, b] = await backend.getIssues([withUi, without]);
      for (const i of [a!, b!]) expect(i.custom_fields.find((f) => f.id === 1)?.value).not.toContain("UI");
    });
  });

  it("offers only the commands that work on several issues", async () => {
    const { user, rows, idOf } = await start();
    act(() => useApp.getState().setSelection([idOf(rows()[0]!), idOf(rows()[1]!)]));
    await user.keyboard("{Control>}k{/Control}");
    const palette = await screen.findByRole("dialog");
    expect(within(palette).getByText("2 selected issues")).toBeInTheDocument();
    expect(within(palette).queryByText("Log time…")).toBeNull();
    expect(within(palette).getByText("Clear selection")).toBeInTheDocument();
  });

  it("picks cards on the board with Ctrl+click", async () => {
    const { user } = await start();
    await user.click(screen.getByRole("radio", { name: "Board" }));
    const board = await screen.findByRole("listbox", { name: "Issues board" });
    const cards = within(board).getAllByRole("option");
    await user.keyboard("{Control>}");
    await user.click(cards[0]!);
    await user.click(cards[1]!);
    await user.keyboard("{/Control}");
    expect(useApp.getState().openIssueId).toBeNull();
    expect(useApp.getState().selection).toHaveLength(2);
    expect(cards[0]).toHaveAttribute("aria-selected", "true");
  });
});
