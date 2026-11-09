import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../App";
import { createDemoBackend } from "../lib/demoBackend";
import { useApp } from "../state/app";

async function openIssue(id: number) {
  const user = userEvent.setup();
  const backend = createDemoBackend({ signedIn: true });
  render(<App backend={backend} />);
  await screen.findByRole("heading", { name: "My issues" });
  useApp.getState().openIssue(id);
  await screen.findByRole("complementary", { name: "Properties" });
  return { user, backend, properties: () => screen.getByRole("complementary", { name: "Properties", hidden: true }) };
}

describe("editing an issue", () => {
  it("changes status with S", async () => {
    const { user, properties } = await openIssue(1);
    expect(properties()).toHaveTextContent("New");
    await user.keyboard("s");
    await user.type(await screen.findByPlaceholderText("Change status…"), "resolved");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(properties()).toHaveTextContent("Resolved"));
    expect(screen.queryByPlaceholderText("Change status…")).not.toBeInTheDocument();
  });

  it("assigns to me with I", async () => {
    const { user, properties } = await openIssue(2);
    expect(properties()).toHaveTextContent("Sam Teammate");
    await user.keyboard("i");
    await waitFor(() => expect(properties()).toHaveTextContent("Dana Developer"));
  });

  it("changes priority from the command palette", async () => {
    const { user, properties } = await openIssue(1);
    await user.keyboard("{Control>}k{/Control}");
    if (!screen.queryByPlaceholderText("Type a command or search issues…")) await user.keyboard("{Meta>}k{/Meta}");
    await user.type(await screen.findByPlaceholderText("Type a command or search issues…"), "priority");
    await user.keyboard("{Enter}");
    await user.type(await screen.findByPlaceholderText("Change priority…"), "urgent");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(properties()).toHaveTextContent("Urgent"));
  });

  it("toggles labels and keeps the picker open", async () => {
    const { user, properties } = await openIssue(1);
    await user.keyboard("l");
    await user.type(await screen.findByPlaceholderText("Change labels…"), "docs");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(within(properties()).getByText("Docs")).toBeInTheDocument());
    expect(screen.getByPlaceholderText("Change labels…")).toBeInTheDocument();
  });

  it("puts the issue back and explains when Redmine refuses", async () => {
    const { user, backend, properties } = await openIssue(1);
    backend.updateIssue = async () => {
      throw { code: "rejected", message: "Status is not included in the list" };
    };
    await user.keyboard("s");
    await user.type(await screen.findByPlaceholderText("Change status…"), "closed");
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("status")).toHaveTextContent("Couldn't update #1: Status is not included in the list");
    expect(properties()).toHaveTextContent("New");
  });
});
