import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../App";
import { createDemoBackend } from "../lib/demoBackend";
import { useApp } from "../state/app";

// In the demo, #3 has mockup.svg (shown in its description too) and profile.txt.
async function openIssue(id: number) {
  const user = userEvent.setup();
  const backend = createDemoBackend({ signedIn: true });
  render(<App backend={backend} />);
  await screen.findByRole("navigation", { name: "Main" });
  act(() => useApp.getState().openIssue(id));
  await screen.findByRole("region", { name: `Issue ${id}` });
  return { user, backend };
}

const attachments = () => screen.findByRole("region", { name: "Attachments" });

beforeAll(() => {
  // jsdom has no object URLs.
  URL.createObjectURL ??= () => "blob:test";
});

describe("attachments", () => {
  it("lists files and shows inline images from the attachment", async () => {
    await openIssue(3);
    const section = await attachments();
    expect(within(section).getByRole("button", { name: "Preview mockup.svg" })).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "Download profile.txt" })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("img", { name: "The mockup" })).toHaveAttribute("src", expect.stringMatching(/^blob:/)),
    );
  });

  it("previews an image and closes with Escape, leaving the issue open", async () => {
    const { user } = await openIssue(3);
    await user.click(within(await attachments()).getByRole("button", { name: "Preview mockup.svg" }));
    expect(screen.getByRole("dialog", { name: "mockup.svg" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "mockup.svg" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Issue 3" })).toBeInTheDocument();
  });

  it("attaches picked files and deletes one", async () => {
    const { user } = await openIssue(1);
    await user.click(screen.getByRole("button", { name: "Attach files" }));
    const section = await attachments();
    await waitFor(() => expect(within(section).getByText("screenshot.png")).toBeInTheDocument());
    await user.click(within(section).getByRole("button", { name: "Delete notes.txt" }));
    await waitFor(() => expect(within(section).queryByText("notes.txt")).not.toBeInTheDocument());
    expect(
      useApp
        .getState()
        .issues.get(1)!
        .attachments!.map((a) => a.filename),
    ).toEqual(["screenshot.png"]);
  });

  it("sends files with a comment", async () => {
    const { user, backend } = await openIssue(2);
    const attach = vi.spyOn(backend, "attachFiles");
    await user.click(screen.getByRole("button", { name: "Attach files to the comment" }));
    expect(await screen.findByRole("list", { name: "Files to attach" })).toHaveTextContent("screenshot.png");
    await user.type(screen.getByRole("textbox", { name: "Comment" }), "Here's what I see");
    await user.click(screen.getByRole("button", { name: /^Comment/ }));
    await waitFor(() => expect(attach).toHaveBeenCalledWith(2, ["/Users/dana/Desktop/screenshot.png"], "Here's what I see"));
    await waitFor(() => expect(screen.queryByRole("list", { name: "Files to attach" })).not.toBeInTheDocument());
  });
});
