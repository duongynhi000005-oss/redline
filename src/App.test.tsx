import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { createDemoBackend } from "./lib/demoBackend";
import { isMac } from "./lib/platform";

const mod = isMac ? "Meta" : "Control";

describe("App", () => {
  it("asks a new user to sign in, then shows their issues", async () => {
    const user = userEvent.setup();
    render(<App backend={createDemoBackend()} />);

    expect(await screen.findByRole("heading", { name: "Sign in to Redmine" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Server address"), "https://redmine.example.com");
    await user.type(screen.getByLabelText("API key"), "0123456789abcdef");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("heading", { name: "My issues" })).toBeInTheDocument();
    // Issues assigned to Dana in the demo data.
    expect(screen.getByText("Command palette opens with Cmd+K")).toBeInTheDocument();
    expect(screen.queryByText("Sync stops after the laptop sleeps")).not.toBeInTheDocument();
  });

  it("shows why sign-in failed", async () => {
    const user = userEvent.setup();
    const backend = createDemoBackend();
    backend.signIn = async () => {
      throw { code: "unauthorized", message: "Redmine didn't accept that API key." };
    };
    render(<App backend={backend} />);
    await user.type(await screen.findByLabelText("Server address"), "https://redmine.example.com");
    await user.type(screen.getByLabelText("API key"), "wrong");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Redmine didn't accept that API key.");
  });

  it("lists a team's issues grouped by status category", async () => {
    const user = userEvent.setup();
    render(<App backend={createDemoBackend({ signedIn: true })} />);
    const nav = await screen.findByRole("navigation", { name: "Main" });
    // Teams are alphabetical: Mobile, then Web.
    await user.click(within(nav).getAllByRole("button", { name: "Issues" })[1]!);

    expect(await screen.findByRole("heading", { name: "Web" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Active", selected: true })).toBeInTheDocument();
    const list = screen.getByRole("listbox", { name: "Issues" });
    expect(within(list).getByText("In progress")).toBeInTheDocument();
    expect(within(list).getByText("Todo")).toBeInTheDocument();
    expect(within(list).queryByText("Done")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "All issues" }));
    expect(within(screen.getByRole("listbox", { name: "Issues" })).getByText("Done")).toBeInTheDocument();
  });

  it("moves through the list with the keyboard and opens an issue", async () => {
    const user = userEvent.setup();
    render(<App backend={createDemoBackend({ signedIn: true })} />);
    await screen.findByRole("heading", { name: "My issues" });

    await user.keyboard("j");
    const focused = screen.getByRole("option", { selected: true });
    const subject = focused.querySelector(".issue-subject")!.textContent!;
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("heading", { level: 1, name: subject })).toBeInTheDocument();
    expect(await screen.findByText("Looks good. I'll pick this up after the sync work lands.")).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Properties" })).toHaveTextContent("Dana Developer");

    await user.keyboard("{Escape}");
    expect(await screen.findByRole("heading", { name: "My issues" })).toBeInTheDocument();
  });

  it("opens an issue by number from the command palette", async () => {
    const user = userEvent.setup();
    render(<App backend={createDemoBackend({ signedIn: true })} />);
    await screen.findByRole("heading", { name: "My issues" });

    await user.keyboard(`{${mod}>}k{/${mod}}`);
    const input = await screen.findByPlaceholderText("Type a command or search issues…");
    await user.type(input, "#2");
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("heading", { level: 1, name: "Sync stops after the laptop sleeps" })).toBeInTheDocument();
  });

  it("navigates to a team from the command palette", async () => {
    const user = userEvent.setup();
    render(<App backend={createDemoBackend({ signedIn: true })} />);
    await screen.findByRole("heading", { name: "My issues" });

    await act(async () => screen.getByRole("button", { name: /Search or run a command/ }).click());
    await user.type(await screen.findByPlaceholderText("Type a command or search issues…"), "go mobile");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Mobile" })).toBeInTheDocument());
  });

  it("follows issue changes from sync", async () => {
    const backend = createDemoBackend({ signedIn: true });
    render(<App backend={backend} />);
    await screen.findByRole("heading", { name: "My issues" });
    await act(async () => {
      await backend.updateIssue(1, { subject: "Command palette opens instantly" });
    });
    expect(await screen.findByText("Command palette opens instantly")).toBeInTheDocument();
  });
});
