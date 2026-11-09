import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../App";
import { createDemoBackend } from "../lib/demoBackend";
import { loadViews } from "../lib/views";
import { useApp } from "../state/app";

async function openTimeline() {
  const user = userEvent.setup();
  const backend = createDemoBackend({ signedIn: true });
  render(<App backend={backend} />);
  const nav = await screen.findByRole("navigation", { name: "Main" });
  await user.click(within(nav).getAllByRole("button", { name: "Issues" })[1]!);
  await user.click(await screen.findByRole("tab", { name: "All issues" }));
  await user.click(screen.getByRole("radio", { name: "Timeline" }));
  const timeline = await screen.findByRole("listbox", { name: "Issues timeline" });
  return { user, backend, timeline };
}

const dates = (id: number) => {
  const issue = useApp.getState().issues.get(id)!;
  return [issue.start_date ?? null, issue.due_date ?? null];
};

describe("the timeline", () => {
  it("shows issues with their dates and remembers the layout", async () => {
    const { timeline } = await openTimeline();
    const options = within(timeline).getAllByRole("option");
    expect(options.length).toBeGreaterThan(0);
    expect(options.some((o) => / to /.test(o.getAttribute("aria-label")!))).toBe(true);
    const saved = Object.values(loadViews("https://redmine.example.com/", 1));
    expect(saved.some((v) => v.layout === "timeline")).toBe(true);
  });

  it("moves the focused issue a day with Shift+→", async () => {
    const { user } = await openTimeline();
    await user.keyboard("{ArrowDown}");
    let id = useApp.getState().focusedIssueId!;
    // Find an issue that has both dates.
    for (let i = 0; i < 10 && dates(id).includes(null); i++) {
      await user.keyboard("{ArrowDown}");
      id = useApp.getState().focusedIssueId!;
    }
    const [start, due] = dates(id) as [string, string];
    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
    const next = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    await waitFor(() => expect(dates(id)).toEqual([next(start), next(due)]));
  });

  it("drags a bar to new dates", async () => {
    const { timeline } = await openTimeline();
    const option = within(timeline)
      .getAllByRole("option")
      .find((o) => o.querySelector(".timeline-bar"))!;
    const id = Number(option.id.replace("issue-bar-", ""));
    const [start] = dates(id) as [string];
    const bar = option.querySelector(".timeline-bar")!;
    fireEvent.pointerDown(bar, { button: 0, clientX: 100 });
    // Three days at the month zoom, 14 pixels a day.
    fireEvent.pointerMove(window, { clientX: 142 });
    fireEvent.pointerUp(window, { clientX: 142 });
    const later = new Date(Date.parse(`${start}T00:00:00Z`) + 3 * 86_400_000).toISOString().slice(0, 10);
    await waitFor(() => expect(dates(id)[0]).toBe(later));
  });

  it("schedules an undated issue by dragging across its row", async () => {
    const { timeline } = await openTimeline();
    const option = within(timeline)
      .getAllByRole("option")
      .find((o) => o.querySelector(".timeline-track.undated"))!;
    const id = Number(option.id.replace("issue-bar-", ""));
    const track = option.querySelector(".timeline-track")!;
    fireEvent.pointerDown(track, { button: 0, clientX: 140 });
    fireEvent.pointerMove(window, { clientX: 196 });
    fireEvent.pointerUp(window, { clientX: 196 });
    await waitFor(() => expect(dates(id).every(Boolean)).toBe(true));
    const [start, due] = dates(id) as [string, string];
    expect((Date.parse(due) - Date.parse(start)) / 86_400_000).toBe(4);
  });

  it("changes the zoom from the display options", async () => {
    const { user } = await openTimeline();
    await user.click(screen.getByRole("button", { name: /Display/ }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Zoom" }), "Weeks");
    const saved = Object.values(loadViews("https://redmine.example.com/", 1));
    expect(saved.some((v) => v.zoom === "week")).toBe(true);
  });
});
