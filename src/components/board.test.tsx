import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../App";
import { createDemoBackend } from "../lib/demoBackend";
import { loadViews } from "../lib/views";
import { useApp } from "../state/app";

async function openBoard() {
  const user = userEvent.setup();
  const backend = createDemoBackend({ signedIn: true });
  render(<App backend={backend} />);
  const nav = await screen.findByRole("navigation", { name: "Main" });
  await user.click(within(nav).getAllByRole("button", { name: "Issues" })[1]!);
  await user.click(await screen.findByRole("tab", { name: "All issues" }));
  await user.click(screen.getByRole("radio", { name: "Board" }));
  const board = await screen.findByRole("listbox", { name: "Issues board" });
  return { user, backend, board };
}

const column = (name: RegExp) => screen.getByRole("group", { name });

describe("the board", () => {
  it("shows a column per status and remembers the layout", async () => {
    const { board } = await openBoard();
    const names = within(board)
      .getAllByRole("group")
      .map((g) => g.getAttribute("aria-label")!.split(",")[0]);
    expect(names).toEqual(["New", "In Progress", "Resolved", "Feedback", "Closed", "Rejected"]);
    expect(within(column(/^New,/)).getAllByRole("option").length).toBeGreaterThan(0);
    const saved = Object.values(loadViews("https://redmine.example.com/", 1));
    expect(saved.some((v) => v.layout === "board")).toBe(true);
  });

  it("moves a card to the next status with Shift+→", async () => {
    const { user } = await openBoard();
    await user.keyboard("{ArrowDown}");
    const id = useApp.getState().focusedIssueId!;
    expect(useApp.getState().issues.get(id)!.status.name).toBe("New");
    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
    await waitFor(() => expect(useApp.getState().issues.get(id)!.status.name).toBe("In Progress"));
    expect(within(column(/^In Progress,/)).getByRole("option", { name: new RegExp(`#${id}\\b`) })).toBeInTheDocument();
  });

  it("refuses a move Redmine's workflow doesn't allow", async () => {
    const { user, backend } = await openBoard();
    const original = backend.getIssueDetails;
    backend.getIssueDetails = async (id, refresh) => ({
      ...(await original(id, refresh)),
      allowedStatuses: [{ id: 1, name: "New" }],
    });
    await user.keyboard("{ArrowDown}");
    const id = useApp.getState().focusedIssueId!;
    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
    expect(await screen.findByRole("status")).toHaveTextContent(
      `Redmine's workflow doesn't allow moving #${id} from New to In Progress.`,
    );
    expect(useApp.getState().issues.get(id)!.status.name).toBe("New");
  });

  it("drags a card onto another column", async () => {
    const { board } = await openBoard();
    const groups = within(board).getAllByRole("group");
    // jsdom has no layout: lay the columns out side by side.
    groups.forEach((g, i) => {
      g.getBoundingClientRect = () => ({ left: i * 300, right: i * 300 + 288, top: 0, bottom: 800, width: 288, height: 800, x: i * 300, y: 0, toJSON() {} });
    });
    const card = within(groups[0]!).getAllByRole("option")[0]!;
    const id = Number(card.id.replace("issue-card-", ""));
    fireEvent.pointerDown(card, { button: 0, clientX: 20, clientY: 20 });
    await act(async () => {
      fireEvent.pointerMove(window, { clientX: 40, clientY: 30 });
    });
    await act(async () => {
      fireEvent.pointerMove(window, { clientX: 920, clientY: 40 });
    });
    expect(column(/^Feedback,/)).toHaveClass("drop-over");
    await act(async () => {
      fireEvent.pointerUp(window, { clientX: 920, clientY: 40 });
    });
    await waitFor(() => expect(useApp.getState().issues.get(id)!.status.name).toBe("Feedback"));
    expect(useApp.getState().openIssueId).toBeNull();
  });

  it("switches back to the list with the keyboard", async () => {
    const { user } = await openBoard();
    await user.keyboard("{Control>}1{/Control}");
    if (screen.queryByRole("listbox", { name: "Issues board" })) await user.keyboard("{Meta>}1{/Meta}");
    expect(await screen.findByRole("listbox", { name: "Issues" })).toBeInTheDocument();
  });
});
