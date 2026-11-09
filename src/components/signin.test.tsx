import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../App";
import { createDemoBackend } from "../lib/demoBackend";
import { useApp } from "../state/app";

describe("a key Redmine stopped accepting", () => {
  it("says so in the sidebar and asks for a new key for the same server", async () => {
    const user = userEvent.setup();
    render(<App backend={createDemoBackend({ signedIn: true })} />);
    await screen.findByRole("heading", { name: "My issues" });
    const server = useApp.getState().account!.serverUrl;

    act(() =>
      useApp.setState({
        sync: { state: "error", lastSyncedAt: null, message: "Redmine didn't accept the API key", code: "unauthorized" },
      }),
    );
    await user.click(screen.getByRole("button", { name: /API key refused/ }));

    await screen.findByRole("heading", { name: "Sign in to Redmine" });
    expect(screen.getByText(/no longer accepts the API key/)).toBeInTheDocument();
    expect(screen.getByLabelText("Server address")).toHaveValue(server);
    expect(screen.getByLabelText("API key")).toHaveFocus();
  });

  it("keeps the usual sync button for other errors", async () => {
    render(<App backend={createDemoBackend({ signedIn: true })} />);
    await screen.findByRole("heading", { name: "My issues" });
    act(() => useApp.setState({ sync: { state: "error", lastSyncedAt: null, message: "Couldn't reach Redmine", code: "network" } }));
    expect(screen.getByRole("button", { name: "Couldn't reach Redmine" })).toHaveAttribute("title", "Sync now");
  });
});
