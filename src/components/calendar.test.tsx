import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../App";
import { createDemoBackend } from "../lib/demoBackend";
import { loadViews } from "../lib/views";
import { useApp } from "../state/app";

async function openCalendar() {
  const user = userEvent.setup();
  const backend = createDemoBackend({ signedIn: true });
  render(<App backend={backend} />);
  const nav = await screen.findByRole("navigation", { name: "Main" });
  await user.click(within(nav).getAllByRole("button", { name: "Issues" })[1]!);
  await user.click(await screen.findByRole("tab", { name: "All issues" }));
  await user.click(screen.getByRole("radio", { name: "Calendar" }));
  const calendar = await screen.findByRole("listbox", { name: "Issues calendar" });
  return { user, backend, calendar };
}

const dates = (id: number) => {
  const issue = useApp.getState().issues.get(id)!;
  return [issue.start_date ?? null, issue.due_date ?? null];
};
const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

describe("the calendar", () => {
  // The demo's issues sit around November 9, 2026.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 9, 12));
  });
  afterEach(() => vi.useRealTimers());

  it("shows this month's issues and the undated ones, and remembers the layout", async () => {
    const { calendar } = await openCalendar();
    const title = new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" });
    expect(within(calendar).getByRole("heading", { name: title })).toBeInTheDocument();
    expect(within(calendar).getAllByRole("option").length).toBeGreaterThan(0);
    expect(within(calendar).getByRole("complementary", { name: "Issues without dates" })).toBeInTheDocument();
    const saved = Object.values(loadViews("https://redmine.example.com/", 1));
    expect(saved.some((v) => v.layout === "calendar")).toBe(true);
  });

  it("pages between months", async () => {
    const { user, calendar } = await openCalendar();
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
    await user.click(screen.getByRole("button", { name: "Next month" }));
    expect(within(calendar).getByRole("heading", { name: next })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Today" }));
    expect(within(calendar).getByRole("heading", { name: now.toLocaleDateString(undefined, { month: "long", year: "numeric" }) })).toBeInTheDocument();
  });

  it("moves the focused issue a week with Shift+↓", async () => {
    const { user } = await openCalendar();
    await user.keyboard("{ArrowDown}");
    let id = useApp.getState().focusedIssueId!;
    for (let i = 0; i < 10 && dates(id).includes(null); i++) {
      await user.keyboard("{ArrowDown}");
      id = useApp.getState().focusedIssueId!;
    }
    const [start, due] = dates(id) as [string, string];
    await user.keyboard("{Shift>}{ArrowDown}{/Shift}");
    await waitFor(() => expect(dates(id)).toEqual([shift(start, 7), shift(due, 7)]));
  });

  it("schedules an undated issue by dropping it on a day", async () => {
    const { calendar } = await openCalendar();
    const undated = within(within(calendar).getByRole("complementary")).getAllByRole("option")[0]!;
    const id = Number(undated.id.replace("issue-cal-", ""));
    const day = calendar.querySelector<HTMLElement>(".calendar-day.today")!;
    const original = document.elementFromPoint;
    document.elementFromPoint = (x: number) => (x > 500 ? day : undated);
    try {
      fireEvent.pointerDown(undated, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerMove(window, { clientX: 600, clientY: 10 });
      fireEvent.pointerUp(window, { clientX: 600, clientY: 10 });
    } finally {
      document.elementFromPoint = original;
    }
    const today = new Date(Number(day.dataset.day) * 86_400_000).toISOString().slice(0, 10);
    await waitFor(() => expect(dates(id)).toEqual([null, today]));
  });

  it("drags an issue to another day, keeping its length", async () => {
    const { calendar } = await openCalendar();
    const bar = within(calendar)
      .getAllByRole("option")
      .find((o) => o.classList.contains("calendar-bar"))!;
    const id = Number(bar.id.replace("issue-cal-", ""));
    const [start, due] = dates(id);
    const days = [...calendar.querySelectorAll<HTMLElement>(".calendar-day")];
    const from = days[10]!;
    const to = days[12]!;
    const original = document.elementFromPoint;
    document.elementFromPoint = (x: number) => (x > 500 ? to : from);
    try {
      fireEvent.pointerDown(bar, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerMove(window, { clientX: 600, clientY: 10 });
      fireEvent.pointerUp(window, { clientX: 600, clientY: 10 });
    } finally {
      document.elementFromPoint = original;
    }
    await waitFor(() => expect(dates(id)).toEqual([start && shift(start, 2), due && shift(due, 2)]));
  });
});
