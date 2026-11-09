import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../App";
import { createDemoBackend } from "../lib/demoBackend";
import { isMac } from "../lib/platform";
import { useApp } from "../state/app";

const mod = isMac ? "Meta" : "Control";

async function start() {
  const user = userEvent.setup();
  const backend = createDemoBackend({ signedIn: true });
  render(<App backend={backend} />);
  await screen.findByRole("heading", { name: "My issues" });
  return { user, backend };
}

describe("comments", () => {
  it("sends a comment with the platform's Cmd/Ctrl+Enter", async () => {
    const { user, backend } = await start();
    const seen: unknown[] = [];
    const update = backend.updateIssue.bind(backend);
    backend.updateIssue = async (id, changes) => {
      seen.push({ id, changes });
      return update(id, changes);
    };
    useApp.getState().openIssue(3);
    await user.type(await screen.findByLabelText("Comment"), "Shipping this today");
    await user.keyboard(`{${mod}>}{Enter}{/${mod}}`);
    await waitFor(() => expect(seen).toEqual([{ id: 3, changes: { notes: "Shipping this today" } }]));
    await waitFor(() => expect(screen.getByLabelText("Comment")).toHaveValue(""));
  });

  it("shows the comment as soon as Redmine has it, within the same second", async () => {
    const { user, backend } = await start();
    // Redmine stamps changes to the second, as the app does when it shows a
    // change at once; the activity must not wait for the stamp to move.
    const read = backend.getIssueDetails.bind(backend);
    let reads = 0;
    backend.getIssueDetails = async (id, refresh) => {
      reads++;
      return read(id, refresh);
    };
    useApp.getState().openIssue(3);
    await waitFor(() => expect(reads).toBe(1));
    await user.type(await screen.findByLabelText("Comment"), "Posted from Redline");
    await user.keyboard(`{${mod}>}{Enter}{/${mod}}`);
    await waitFor(() => expect(screen.getByLabelText("Comment")).toHaveValue(""));
    expect(await screen.findByText("Posted from Redline")).toBeInTheDocument();
  });
});

describe("new issue", () => {
  it("opens with C in the team on screen and creates the issue", async () => {
    const { user } = await start();
    useApp.getState().navigate({ view: "team", teamId: 2, tab: "all" });
    await screen.findByRole("heading", { name: "Mobile" });
    await user.keyboard("c");
    const dialog = await screen.findByRole("dialog", { name: "New issue" });
    expect(screen.getByLabelText("Project")).toHaveDisplayValue("Mobile");
    await user.type(screen.getByLabelText("Title"), "Crash on launch");
    await user.click(screen.getByRole("button", { name: /Create issue/ }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(await screen.findByText("Crash on launch")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Created #31 Crash on launch");
  });

  it("keeps the form open and explains a refusal", async () => {
    const { user, backend } = await start();
    backend.createIssue = async () => {
      throw { code: "rejected", message: "Tracker is not included in the list" };
    };
    await user.keyboard("c");
    await user.type(await screen.findByLabelText("Title"), "Something");
    await user.keyboard(`{${mod}>}{Enter}{/${mod}}`);
    expect(await screen.findByRole("alert")).toHaveTextContent("Tracker is not included in the list");
    expect(screen.getByRole("dialog", { name: "New issue" })).toBeInTheDocument();
  });
});
