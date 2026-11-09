import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../App";
import { createDemoBackend } from "../lib/demoBackend";
import { copyFields } from "../lib/edit";
import { canEditComment } from "../lib/permissions";
import { useApp } from "../state/app";

// In the demo, Dana is a Manager in Web, who may delete issues and edit
// anyone's comments, and a Developer in Mobile, who may only edit her own.
// #1 is a Web issue with sub-issues #11 and #12, and a comment by Dana.
// #7 is a Mobile issue.
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

describe("comments", () => {
  it("edits your own comment", async () => {
    const { user, backend } = await start();
    const region = await openIssue(1);
    const comment = await within(region).findByRole("article", { name: "Comment by Dana Developer" });
    await user.click(within(comment).getByRole("button", { name: "Edit comment" }));
    const box = within(comment).getByRole("textbox", { name: "Edit comment" });
    await user.clear(box);
    await user.type(box, "Picked this up today.");
    await user.click(within(comment).getByRole("button", { name: /Save/ }));
    await waitFor(() => expect(within(comment).getByText("Picked this up today.")).toBeInTheDocument());
    expect(within(comment).getByText("edited")).toBeInTheDocument();
    const details = await backend.getIssueDetails(1);
    expect(details.journals.find((j) => j.notes === "Picked this up today.")).toBeTruthy();
  });

  it("cancels an edit with Escape", async () => {
    const { user } = await start();
    const region = await openIssue(1);
    const comment = await within(region).findByRole("article", { name: "Comment by Dana Developer" });
    await user.click(within(comment).getByRole("button", { name: "Edit comment" }));
    await user.type(within(comment).getByRole("textbox", { name: "Edit comment" }), " and more");
    await user.keyboard("{Escape}");
    expect(within(comment).queryByRole("textbox")).toBeNull();
    // Escape left the issue open.
    expect(screen.getByRole("region", { name: "Issue 1" })).toBeInTheDocument();
  });

  it("deletes a comment after asking", async () => {
    const { user } = await start();
    const region = await openIssue(1);
    const comment = await within(region).findByRole("article", { name: "Comment by Dana Developer" });
    await user.click(within(comment).getByRole("button", { name: "Delete comment" }));
    await user.click(within(comment).getByRole("button", { name: "Keep" }));
    await user.click(within(comment).getByRole("button", { name: "Delete comment" }));
    await user.click(within(comment).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(within(region).queryByRole("article", { name: "Comment by Dana Developer" })).toBeNull());
  });

  it("lets developers change only their own", async () => {
    const meta = await createDemoBackend({ signedIn: true }).getMetadata();
    expect(canEditComment(meta, 2, 1, 1)).toBe(true);
    expect(canEditComment(meta, 2, 2, 1)).toBe(false);
    expect(canEditComment(meta, 1, 2, 1)).toBe(true);
  });
});

describe("duplicating and deleting issues", () => {
  it("duplicates an issue, links the copy and opens it", async () => {
    const { user, backend } = await start();
    const region = await openIssue(1);
    await user.click(within(region).getByRole("button", { name: "More actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    const source = useApp.getState().issues.get(1)!;
    await waitFor(() => expect(useApp.getState().openIssueId).not.toBe(1));
    const copyId = useApp.getState().openIssueId!;
    const [copy] = await backend.getIssues([copyId]);
    expect(copy?.subject).toBe(source.subject);
    expect(copy?.category?.id).toBe(source.category?.id);
    expect(copy?.relations?.some((r) => r.issue_id === 1 && r.issue_to_id === copyId && r.relation_type === "copied_to")).toBe(
      true,
    );
    expect(await screen.findByRole("region", { name: `Issue ${copyId}` })).toBeInTheDocument();
  });

  it("copies fields but not status, history or sub-issues", () => {
    const fields = copyFields({
      id: 5,
      project: { id: 1, name: "Web" },
      tracker: { id: 2, name: "Feature" },
      status: { id: 3, name: "Done", is_closed: true },
      priority: { id: 2, name: "Normal" },
      subject: "Ship it",
      assigned_to: null,
      is_private: false,
      custom_fields: [
        { id: 1, name: "Area", multiple: true, value: ["UI", "API"] },
        { id: 2, name: "Size", value: "" },
      ],
      created_on: "2026-11-01T00:00:00Z",
      updated_on: "2026-11-02T00:00:00Z",
    });
    expect(fields).toEqual({
      project_id: 1,
      tracker_id: 2,
      subject: "Ship it",
      priority_id: 2,
      custom_fields: [{ id: 1, value: ["UI", "API"] }],
    });
  });

  it("deletes an issue with its sub-issues after asking", async () => {
    const { user, backend } = await start();
    const region = await openIssue(1);
    await user.click(within(region).getByRole("button", { name: "More actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete issue…" }));
    const dialog = await screen.findByRole("alertdialog", { name: /Delete #1/ });
    expect(dialog).toHaveTextContent("with its 2 sub-issues");
    // Cancel is the safe default.
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.click(within(dialog).getByRole("button", { name: "Delete issue" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.queryByRole("region", { name: "Issue 1" })).toBeNull();
    expect(await backend.getIssues([1, 11, 12])).toEqual([]);
    for (const id of [1, 11, 12]) expect(useApp.getState().issues.has(id)).toBe(false);
  });

  it("offers Delete only where the role may delete", async () => {
    const { user } = await start();
    const region = await openIssue(7);
    await user.click(within(region).getByRole("button", { name: "More actions" }));
    expect(screen.getByRole("menuitem", { name: "Duplicate" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Delete issue…" })).toBeNull();
  });
});
