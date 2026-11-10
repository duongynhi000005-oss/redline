import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../App";
import { boardColumns, canDrop } from "../lib/board";
import { createDemoBackend, demoIssues } from "../lib/demoBackend";
import { fieldEnabled, fieldShape, nextFieldValue } from "../lib/edit";
import { filterOptions, matchesFilters } from "../lib/filters";
import { groupIssues } from "../lib/views";
import { derive } from "../state/derived";
import { useApp } from "../state/app";

// In the demo, #1 is a Web bug in the Frontend category with a 2h estimate.
// Dana is a Manager in Web, so she may make issues private.
async function start() {
  const user = userEvent.setup();
  const backend = createDemoBackend({ signedIn: true });
  render(<App backend={backend} />);
  await screen.findByRole("navigation", { name: "Main" });
  return { user, backend };
}

async function openIssue(id: number) {
  act(() => useApp.getState().openIssue(id));
  return screen.findByRole("region", { name: `Issue ${id}` });
}

const properties = () => screen.getByRole("complementary", { name: "Properties" });

describe("editing every field", () => {
  it("changes the category from the properties panel", async () => {
    const { user, backend } = await start();
    await openIssue(1);
    await user.click(within(properties()).getByRole("button", { name: "Category: change" }));
    const picker = await screen.findByRole("dialog", { name: "Change category…" });
    expect(within(picker).getByRole("option", { name: /Frontend/ })).toHaveTextContent("✓");
    await user.click(within(picker).getByRole("option", { name: /Sync engine/ }));
    await waitFor(() => expect(within(properties()).getByRole("button", { name: "Category: change" })).toHaveTextContent("Sync engine"));
    const [saved] = await backend.getIssues([1]);
    expect(saved?.category?.name).toBe("Sync engine");
  });

  it("types an estimate in place, and clears it", async () => {
    const { user, backend } = await start();
    await openIssue(1);
    await user.click(within(properties()).getByRole("button", { name: "Estimate: change" }));
    const input = within(properties()).getByRole("textbox", { name: "Estimate" });
    await user.clear(input);
    await user.type(input, "3h 30m{Enter}");
    expect(within(properties()).getByRole("button", { name: "Estimate: change" })).toHaveTextContent("3h 30m");
    await waitFor(async () => expect((await backend.getIssues([1]))[0]?.estimated_hours).toBe(3.5));

    await user.click(within(properties()).getByRole("button", { name: "Estimate: change" }));
    await user.clear(within(properties()).getByRole("textbox", { name: "Estimate" }));
    await user.keyboard("{Enter}");
    expect(within(properties()).getByRole("button", { name: "Estimate: change" })).toHaveTextContent("None");
  });

  it("sends a date only once it's finished, and clears it", async () => {
    const { user, backend } = await start();
    await openIssue(1);
    const due = within(properties()).getByLabelText("Due");
    await user.clear(due);
    await user.type(due, "2026-12-01");
    // Nothing is sent while typing.
    expect((await backend.getIssues([1]))[0]?.due_date).not.toBe("2026-12-01");
    await user.keyboard("{Enter}");
    await waitFor(async () => expect((await backend.getIssues([1]))[0]?.due_date).toBe("2026-12-01"));
    await user.click(within(properties()).getByRole("button", { name: "Clear due" }));
    await waitFor(async () => expect((await backend.getIssues([1]))[0]?.due_date).toBeNull());
  });

  it("makes an issue private, changes % done, and moves it to another project", async () => {
    const { user, backend } = await start();
    await openIssue(1);
    await user.click(within(properties()).getByRole("button", { name: "Private: change" }));
    await waitFor(async () => expect((await backend.getIssues([1]))[0]?.is_private).toBe(true));

    await user.click(within(properties()).getByRole("button", { name: "Done: change" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Change % done…" })).getByRole("option", { name: "60%" }));
    await waitFor(async () => expect((await backend.getIssues([1]))[0]?.done_ratio).toBe(60));

    await user.click(within(properties()).getByRole("button", { name: "Project: change" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Move to project…" })).getByRole("option", { name: /Mobile/ }));
    await waitFor(async () => expect((await backend.getIssues([1]))[0]?.project.name).toBe("Mobile"));
    // Categories belong to a project, so the move drops it.
    expect((await backend.getIssues([1]))[0]?.category ?? null).toBeNull();
  });

  it("hides fields the tracker doesn't use", async () => {
    const backend = createDemoBackend({ signedIn: true });
    const meta = await backend.getMetadata();
    const trimmed = {
      ...meta,
      trackers: meta.trackers.map((t) => (t.id === 1 ? { ...t, enabled_standard_fields: ["assigned_to_id", "due_date"] } : t)),
    };
    expect(fieldEnabled(trimmed, 1, "category_id")).toBe(false);
    expect(fieldEnabled(trimmed, 1, "due_date")).toBe(true);
    expect(fieldEnabled(trimmed, 2, "category_id")).toBe(true);
  });
});

describe("custom fields", () => {
  const field = async (backend: Awaited<ReturnType<typeof start>>["backend"], id: number, name: string) =>
    (await backend.getIssues([id]))[0]?.custom_fields.find((f) => f.name === name)?.value;

  it("picks a known value, types a new one, and clears it", async () => {
    const { user, backend } = await start();
    // Values are known from issues Redline has loaded: here, the Web team's.
    const nav = screen.getByRole("navigation", { name: "Main" });
    await user.click(within(nav).getAllByRole("button", { name: "Issues" })[1]!);
    await user.click(await screen.findByRole("tab", { name: "All issues" }));
    await waitFor(() => expect(useApp.getState().lists.size).toBeGreaterThan(1));
    await waitFor(() => expect([...useApp.getState().lists.values()].every((l) => !l.loading)).toBe(true));
    await openIssue(1);
    await user.click(within(properties()).getByRole("button", { name: "Size: change" }));
    let picker = await screen.findByRole("dialog", { name: "Set Size…" });
    expect(within(picker).getByRole("option", { name: /^S/ })).toHaveTextContent("✓");
    await user.click(within(picker).getByRole("option", { name: /^M/ }));
    await waitFor(async () => expect(await field(backend, 1, "Size")).toBe("M"));

    await user.click(within(properties()).getByRole("button", { name: "Size: change" }));
    picker = await screen.findByRole("dialog", { name: "Set Size…" });
    await user.keyboard("XL");
    await user.click(within(picker).getByRole("option", { name: "Set to “XL”" }));
    await waitFor(async () => expect(await field(backend, 1, "Size")).toBe("XL"));

    await user.click(within(properties()).getByRole("button", { name: "Size: change" }));
    picker = await screen.findByRole("dialog", { name: "Set Size…" });
    await user.click(within(picker).getByRole("option", { name: "Clear Size" }));
    await waitFor(async () => expect(await field(backend, 1, "Size")).toBe(""));
    expect(within(properties()).getByRole("button", { name: "Size: change" })).toHaveTextContent("None");
  });

  it("guess a field's shape and the value to send", () => {
    expect(fieldShape(["2026-11-09", "2026-12-01"])).toBe("date");
    expect(fieldShape(["2026-11-09", "soon"])).toBe("value");
    expect(fieldShape([])).toBe("value");
    expect(nextFieldValue(["S"], false, "M")).toBe("M");
    expect(nextFieldValue(["S"], false, "S")).toBe("");
    expect(nextFieldValue(["a"], true, "b")).toEqual(["a", "b"]);
    expect(nextFieldValue(["a"], true, "a")).toEqual([""]);
  });

  it("picks up a field added after the issue was synced", async () => {
    const { backend } = await start();
    const details = await backend.getIssueDetails(1, false);
    const stale = { ...details.issue, custom_fields: details.issue.custom_fields.filter((f) => f.name !== "Review by") };
    act(() => useApp.setState((s) => ({ issues: new Map(s.issues).set(1, stale) })));
    act(() => useApp.getState().takeDetails(details));
    expect(useApp.getState().issues.get(1)?.custom_fields.some((f) => f.name === "Review by")).toBe(true);
  });

  it("edits a field that holds days as a date", async () => {
    const { user, backend } = await start();
    await openIssue(1);
    const review = within(properties()).getByLabelText("Review by");
    await user.type(review, "2026-12-24");
    await user.keyboard("{Enter}");
    await waitFor(async () => expect(await field(backend, 1, "Review by")).toBe("2026-12-24"));
    await user.click(within(properties()).getByRole("button", { name: "Clear review by" }));
    await waitFor(async () => expect(await field(backend, 1, "Review by")).toBe(""));
  });
});

describe("categories", () => {
  it("filter and group issues", async () => {
    const backend = createDemoBackend({ signedIn: true });
    const meta = await backend.getMetadata();
    const issues = demoIssues().filter((i) => i.project.id === 1);
    const d = derive(meta);
    const ctx = { categories: d.categories, priorities: d.priorities, labelFields: d.labelFields };
    const options = filterOptions("category", issues, meta, ctx);
    expect(options.map((o) => o.label)).toEqual(expect.arrayContaining(["Frontend", "Sync engine", "Docs", "No category"]));
    expect(options.at(-1)?.label).toBe("No category");

    const frontend = issues.filter((i) => matchesFilters(i, [{ field: "category", values: ["1"] }], ctx));
    expect(frontend.length).toBeGreaterThan(0);
    expect(frontend.every((i) => i.category?.name === "Frontend")).toBe(true);

    const groups = groupIssues(issues, "category", "priority", d, meta);
    expect(groups.map((g) => g.label)).toEqual(["Docs", "Frontend", "Sync engine", "No category"]);
  });

  it("only take issues from their own project on the board", async () => {
    const backend = createDemoBackend({ signedIn: true });
    const meta = await backend.getMetadata();
    const issues = demoIssues();
    const columns = boardColumns(issues, "category", "priority", derive(meta), meta, { showEmpty: false });
    const frontend = columns.find((c) => c.label === "Frontend")!;
    expect(frontend.drop).toEqual({ category_id: 1 });
    const mobileIssue = issues.find((i) => i.project.id === 2)!;
    const webIssue = issues.find((i) => i.project.id === 1)!;
    expect(canDrop(frontend, null, mobileIssue)).toBe(false);
    expect(canDrop(frontend, null, webIssue)).toBe(true);
  });
});
