import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../App";
import { createDemoBackend } from "../lib/demoBackend";
import { useApp } from "../state/app";

// The demo user, Dana Developer, is a Manager in Web (#1) and a Developer in
// Mobile (#7); as in Redmine's defaults, only managers handle watchers.
async function openIssue(id: number) {
  const user = userEvent.setup();
  const backend = createDemoBackend({ signedIn: true });
  const opened = vi.spyOn(backend, "openInRedmine");
  render(<App backend={backend} />);
  await screen.findByRole("navigation", { name: "Main" });
  act(() => useApp.getState().openIssue(id));
  await screen.findByRole("region", { name: `Issue ${id}` });
  return { user, opened };
}

const subscribers = () => screen.getByRole("region", { name: "Subscribers" });

describe("subscribers", () => {
  it("lists who's subscribed and subscribes you", async () => {
    const { user } = await openIssue(1);
    const before = await within(subscribers()).findAllByRole("listitem");
    const subscribe = screen.getByRole("button", { name: /^(Subscribe|Unsubscribe)$/ });
    const wasOn = subscribe.getAttribute("aria-pressed") === "true";
    await user.click(subscribe);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: wasOn ? "Subscribe" : "Unsubscribe" })).toHaveAttribute(
        "aria-pressed",
        String(!wasOn),
      ),
    );
    await waitFor(() => expect(within(subscribers()).queryAllByRole("listitem")).toHaveLength(before.length + (wasOn ? -1 : 1)));
    expect(useApp.getState().watching.get(1)).toBe(!wasOn);
  });

  it("adds someone from the picker and removes them again", async () => {
    const { user } = await openIssue(1);
    await within(subscribers()).findAllByRole("listitem");
    await user.click(screen.getByRole("button", { name: "Change subscribers" }));
    const listbox = await screen.findByRole("listbox");
    const option = within(listbox)
      .getAllByRole("option")
      .find((o) => o.getAttribute("aria-selected") !== "true" && !/Dana/.test(o.textContent ?? ""));
    const name = option!.querySelector("[aria-label]")!.getAttribute("aria-label")!;
    await user.click(option!);
    // The picker stays open for more; close it to see the list.
    await waitFor(() => expect(option).toHaveAttribute("aria-selected", "true"));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(within(subscribers()).getByText(name)).toBeInTheDocument());
    await user.click(within(subscribers()).getByRole("button", { name: `Remove ${name}` }));
    await waitFor(() => expect(within(subscribers()).queryByText(name)).not.toBeInTheDocument());
  });

  it("sends you to Redmine when your role can't subscribe through the API", async () => {
    const { user, opened } = await openIssue(7);
    expect(await within(subscribers()).findByText(/can't see who else is subscribed/)).toBeInTheDocument();
    expect(within(subscribers()).queryByRole("button", { name: "Change subscribers" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^(Subscribe|Unsubscribe)$/ }));
    expect(opened).toHaveBeenCalledWith("issues/7");
    expect(useApp.getState().toast).toMatch(/in Redmine/);
  });

  it("opens the issue in Redmine", async () => {
    const { user, opened } = await openIssue(1);
    await user.click(screen.getByRole("button", { name: "Open in Redmine" }));
    expect(opened).toHaveBeenCalledWith("issues/1");
  });
});
