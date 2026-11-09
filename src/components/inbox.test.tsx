import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../App";
import { createDemoBackend } from "../lib/demoBackend";

describe("inbox view", () => {
  it("collects teammates' changes to my issues and opens them", async () => {
    localStorage.setItem(
      "redline.inbox:https://redmine.example.com/#1",
      JSON.stringify({ since: "2026-10-01T00:00:00Z", items: [] }),
    );
    const user = userEvent.setup();
    const backend = createDemoBackend({ signedIn: true });
    render(<App backend={backend} />);
    const nav = await screen.findByRole("navigation", { name: "Main" });
    await act(async () => {
      await backend.updateIssue(1, { priority_id: 3 });
    });

    expect(await within(nav).findByRole("button", { name: /Inbox\s*2/ })).toBeInTheDocument();
    await user.click(within(nav).getByRole("button", { name: /Inbox/ }));
    const list = screen.getByRole("list", { name: "Notifications" });
    expect(within(list).getAllByText("Sam Teammate")).toHaveLength(2);

    await user.click(within(list).getAllByRole("button", { name: /Command palette opens with Cmd\+K/ })[0]!);
    expect(await screen.findByRole("heading", { level: 1, name: "Command palette opens with Cmd+K" })).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: /Inbox\s*1/ })).toBeInTheDocument();
  });
});
