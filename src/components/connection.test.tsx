import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../App";
import { createDemoBackend } from "../lib/demoBackend";
import { useApp } from "../state/app";

describe("server username and custom headers", () => {
  it("explains a gateway's refusal and signs in with a username and header", async () => {
    const user = userEvent.setup();
    const backend = createDemoBackend();
    const signIn = vi.spyOn(backend, "signIn");
    render(<App backend={backend} />);

    await user.type(await screen.findByLabelText("Server address"), "https://gateway.example.com");
    await user.type(screen.getByLabelText("API key"), "0123456789abcdef");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("HTTP 401");
    expect(alert).toHaveTextContent("may need a username or other headers");
    await user.click(within(alert).getByRole("button", { name: "Add a username or headers" }));

    expect(screen.getByRole("button", { name: "Advanced" })).toHaveAttribute("aria-expanded", "true");
    await user.type(screen.getByLabelText("Username"), "dana");
    await user.click(screen.getByRole("button", { name: "Add header" }));
    await user.type(screen.getByLabelText("Header 1 name"), "X-Gateway-Token");
    await user.type(screen.getByLabelText("Header 1 value"), "s3cret");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("heading", { name: "My issues" })).toBeInTheDocument();
    expect(signIn).toHaveBeenLastCalledWith("https://gateway.example.com", "0123456789abcdef", {
      username: "dana",
      headers: [{ name: "X-Gateway-Token", value: "s3cret" }],
    });
  });

  it("won't send a custom header that overrides the API key", async () => {
    const user = userEvent.setup();
    const backend = createDemoBackend();
    const signIn = vi.spyOn(backend, "signIn");
    render(<App backend={backend} />);

    await user.type(await screen.findByLabelText("Server address"), "https://redmine.example.com");
    await user.type(screen.getByLabelText("API key"), "0123456789abcdef");
    await user.click(screen.getByRole("button", { name: "Advanced" }));
    await user.click(screen.getByRole("button", { name: "Add header" }));
    await user.type(screen.getByLabelText("Header 1 name"), "X-Redmine-API-Key");
    await user.type(screen.getByLabelText("Header 1 value"), "other");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Put it in the API key field");
    expect(signIn).not.toHaveBeenCalled();
  });

  it("edits the headers in Settings and checks them with the server", async () => {
    const user = userEvent.setup();
    const backend = createDemoBackend({ signedIn: true });
    const update = vi.spyOn(backend, "updateConnection");
    render(<App backend={backend} />);
    await screen.findByRole("heading", { name: "My issues" });

    useApp.getState().setSettingsOpen(true);
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    const section = within(dialog).getByRole("region", { name: "Connection" });
    const save = await within(section).findByRole("button", { name: "Save" });
    expect(save).toBeDisabled();

    await user.type(within(section).getByLabelText("Username"), "dana");
    await user.click(within(section).getByRole("button", { name: "Add header" }));
    await user.type(within(section).getByLabelText("Header 1 name"), "X-Gateway-Token");
    await user.type(within(section).getByLabelText("Header 1 value"), "tok");
    await user.click(save);

    await waitFor(() => expect(within(section).getByRole("status")).toHaveTextContent("Saved"));
    expect(update).toHaveBeenCalledWith({ username: "dana", headers: [{ name: "X-Gateway-Token", value: "tok" }] });
    expect(await backend.getConnection()).toEqual({ username: "dana", headers: [{ name: "X-Gateway-Token", value: "tok" }] });

    await user.click(within(section).getByRole("button", { name: "Remove header X-Gateway-Token" }));
    await user.click(within(section).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(update).toHaveBeenLastCalledWith({ username: "dana", headers: [] }));
  });
});
